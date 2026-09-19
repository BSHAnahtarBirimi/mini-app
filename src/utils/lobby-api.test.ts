import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { DiscordRestApiError, DiscordRestClient } from "@minesa-org/mini-interaction";

import {
	LOBBY_CALL_TIMEOUT_MS,
	LobbyCallTimeoutError,
	describeLobbyError,
	linkChannelToLobby,
	setLobbyCallTimeoutMs,
	setLobbyFetchImplementation,
	withTimeout,
} from "./lobby-api.ts";

/**
 * Regression guard for the "«bot» is thinking…" forever state.
 *
 * `DiscordRestClient` keeps rate-limit buckets on the instance and
 * `waitForBucket()` sleeps until a bucket resets *before* the next call is even
 * attempted. A shared client (the module singleton this app used to have) is
 * therefore poisoned by its own previous response: the channel-linking bucket is
 * the application-wide cap (20 calls / 2 h while the app is unapproved), so one
 * `404 Unknown Lobby` makes the next link attempt sleep for up to two hours. In
 * a serverless function the invocation dies at `maxDuration` long before that —
 * nothing linked, nothing reported.
 *
 * The first test reproduces that trap with the library's own client; the rest
 * pin the behaviour of this module, which uses one client per call and bounds
 * every call with `withTimeout`.
 */

type FetchImpl = ConstructorParameters<typeof DiscordRestClient>[0]["fetchImplementation"];

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});

/** Discord's "Unknown Lobby" 404, with the route's bucket reported as exhausted. */
const unknownLobbyResponse = () =>
	jsonResponse(
		404,
		{ message: "Unknown Lobby", code: 10039 },
		{
			"x-ratelimit-bucket": "lobby-channel-linking",
			"x-ratelimit-remaining": "0",
			// One second instead of the real 7200 so the test stays fast: the
			// client sleeps for exactly what Discord reports.
			"x-ratelimit-reset-after": "1",
		},
	);

test("a reused client sleeps out the next call once a bucket reports remaining: 0", async () => {
	let fetches = 0;
	const client = new DiscordRestClient({
		token: "bot-token",
		applicationId: "app-id",
		maxRetries: 0,
		fetchImplementation: (async () => {
			fetches += 1;
			return unknownLobbyResponse();
		}) as FetchImpl,
	});

	// First call: nothing learned yet, so it goes straight to Discord.
	await assert.rejects(() => client.linkChannelToLobby("1", "2", "user-token"));
	assert.equal(fetches, 1);

	// Second call on the SAME client: held back by the learned bucket.
	const started = Date.now();
	let settled = false;
	const second = client.linkChannelToLobby("1", "2", "user-token").then(
		() => {
			settled = true;
		},
		() => {
			settled = true;
		},
	);

	await sleep(250);
	assert.equal(settled, false, "the second call must not have reached Discord yet");

	await second;
	assert.ok(
		Date.now() - started >= 900,
		"it only proceeds once the learned bucket resets — 2 hours for the real channel-linking bucket",
	);
	assert.equal(fetches, 2);
});

test("linkChannelToLobby carries no rate-limit state between calls", async () => {
	let fetches = 0;
	setLobbyFetchImplementation((async () => {
		fetches += 1;
		return unknownLobbyResponse();
	}) as FetchImpl);

	try {
		await assert.rejects(() => linkChannelToLobby("1", "2", "user-token"), /404/);

		const started = Date.now();
		await assert.rejects(() => linkChannelToLobby("1", "2", "user-token"), /404/);
		assert.ok(
			Date.now() - started < 500,
			"the second call must go straight to Discord instead of sleeping out the bucket",
		);
		assert.equal(fetches, 2);
	} finally {
		setLobbyFetchImplementation(undefined);
	}
});

test("withTimeout gives up on a stalled call", async () => {
	await assert.rejects(
		() => withTimeout("link the channel", new Promise<never>(() => {}), 30),
		(error: unknown) => {
			assert.ok(error instanceof LobbyCallTimeoutError);
			assert.equal(error.operation, "link the channel");
			assert.match(error.message, /did not answer/);
			return true;
		},
	);

	assert.equal(await withTimeout("anything", Promise.resolve(41), 30), 41);
	await assert.rejects(() => withTimeout("anything", Promise.reject(new Error("nope")), 30), /nope/);
});

test("a stalled transport surfaces as LobbyCallTimeoutError, not a hang", async () => {
	setLobbyFetchImplementation((() => new Promise<never>(() => {})) as FetchImpl);
	setLobbyCallTimeoutMs(30);
	try {
		await assert.rejects(
			() => linkChannelToLobby("1", "2", "user-token"),
			(error: unknown) => error instanceof LobbyCallTimeoutError,
		);
	} finally {
		setLobbyCallTimeoutMs(LOBBY_CALL_TIMEOUT_MS);
		setLobbyFetchImplementation(undefined);
	}
});

test("describeLobbyError explains timeouts and Discord's own errors", () => {
	assert.match(
		describeLobbyError(new LobbyCallTimeoutError("link the channel", 5_000)),
		/5s.*not retried/s,
	);
	assert.equal(
		describeLobbyError(
			new DiscordRestApiError(
				404,
				"PATCH",
				"/lobbies/1/channel-linking",
				JSON.stringify({ message: "Unknown Lobby", code: 10039 }),
			),
		),
		"404 — Unknown Lobby",
	);
});
