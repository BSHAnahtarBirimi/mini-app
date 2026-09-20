import assert from "node:assert/strict";
import { generateKeyPairSync, sign as signWithKey, type KeyObject } from "node:crypto";
import test from "node:test";

import {
	WebhookEventEndpoint,
	WebhookEventRouter,
	WebhookEventType,
} from "@minesa-org/mini-interaction";
import type { WebhookEventPayload } from "@minesa-org/mini-interaction";

import {
	LINKED_CHANNEL_TARGET_LIMIT,
	candidateGuilds,
	deauthorizationMessage,
	deliveryKeyOf,
	describeDeauthorizationOutcome,
	linkedChannelTargets,
	notifyLinkedChannelsOfDeauthorization,
	summarizeEvent,
} from "./webhook-events.ts";
import type { DeauthorizeDeps } from "./webhook-events.ts";
import { setLobbyFetchImplementation } from "./lobby-api.ts";
import { unionGuilds } from "./lobby-store.ts";

/**
 * `APPLICATION_DEAUTHORIZED` is the only out-of-game signal that a Social SDK
 * user's link state changed, and every revocation invalidates their tokens. The
 * handler therefore has to (1) drop the stored connection and (2) tell the
 * linked channel of the lobby that user owns — and it has to survive the
 * redeliveries Discord sends when an ack is lost.
 */

const deauthorizedPayload = (userId = "285118390031351809"): WebhookEventPayload =>
	({
		version: 1,
		application_id: "1530890351101874277",
		type: 1,
		event: {
			type: WebhookEventType.ApplicationDeauthorized,
			timestamp: "2026-09-19T20:30:00.000000",
			data: { user: { id: userId, username: "tester" } },
		},
	}) as WebhookEventPayload;

function recordingDeps(overrides: Partial<DeauthorizeDeps> = {}) {
	const sent: { channelId: string; content: string }[] = [];
	const deleted: string[] = [];
	const remembered: [string, string][] = [];
	const deps: DeauthorizeDeps = {
		listGuilds: async () => ["1525905980422885406", "999999999999999999"],
		getLobbyRecord: async (guildId) =>
			guildId === "1525905980422885406"
				? { lobbyId: "1550964030342959254", creatorId: "285118390031351809" }
				: { lobbyId: "1", creatorId: "someone-else" },
		readLinkedChannelId: async () => "1525905982000070780",
		rememberChannel: async (guildId, channelId) => {
			remembered.push([guildId, channelId]);
		},
		sendChannelMessage: async (channelId, content) => {
			sent.push({ channelId, content });
			return { id: "1" };
		},
		deleteUserToken: async (userId) => {
			deleted.push(userId);
		},
		...overrides,
	};
	return { deps, sent, deleted, remembered };
}

test("every linked channel is told, not only the one that user linked", async () => {
	const { deps, sent, deleted } = recordingDeps({
		listGuilds: async () => [
			"1525905980422885406",
			"1550970322860384317",
			"111111111111111111",
		],
		getLobbyRecord: async (guildId) =>
			guildId === "111111111111111111"
				? null
				: { lobbyId: `lobby-${guildId}`, creatorId: "285118390031351809" },
		sendChannelMessage: async (channelId, content) => {
			sent.push({ channelId, content });
			return { id: "1" };
		},
	});

	const outcome = await notifyLinkedChannelsOfDeauthorization(
		{ id: "285118390031351809", username: "tester" },
		deps,
	);

	assert.deepEqual(deleted, ["285118390031351809"], "the dead connection must be forgotten");
	assert.deepEqual(
		outcome.notified.map((entry) => entry.guildId),
		["1525905980422885406", "1550970322860384317"],
		"a second server with a linked channel must be told as well",
	);
	assert.equal(sent.length, 2);
	assert.match(sent[0]?.content ?? "", /tester/);
	assert.match(sent[0]?.content ?? "", /Reconnect Discord/);
	assert.deepEqual(
		outcome.considered,
		["1525905980422885406", "1550970322860384317", "111111111111111111"],
		"every candidate is examined even when it has no lobby",
	);
});

test("guild candidates come from Discord, so an unindexed lobby still counts", async () => {
	// The event payload has a user id and nothing else, and a write-time index
	// cannot see lobbies created before it existed — Discord's own answer can.
	setLobbyFetchImplementation((async (url: string) =>
		String(url).endsWith("/users/@me/guilds")
			? new Response(JSON.stringify([{ id: "1550970322860384317", name: "second" }]), {
					status: 200,
					headers: { "content-type": "application/json" },
				})
			: new Response("{}", { status: 404 })) as never);
	try {
		assert.deepEqual(await candidateGuilds(), ["1550970322860384317"]);
	} finally {
		setLobbyFetchImplementation(undefined);
	}
});

test("candidates are merged without duplicates", () => {
	assert.deepEqual(unionGuilds(["a", "b"], ["b", "c", ""]), ["a", "b", "c"]);
});

test("linkedChannelTargets reports what a deauthorization would notify, without sending", async () => {
	const many = Array.from({ length: 30 }, (_, index) => `guild-${index}`);
	const { deps, sent } = recordingDeps({
		listGuilds: async () => many,
		getLobbyRecord: async () => ({ lobbyId: "1", creatorId: "someone-else" }),
	});

	const targets = await linkedChannelTargets(deps);

	assert.equal(sent.length, 0, "a diagnostic must not post anything");
	assert.equal(
		targets.length,
		LINKED_CHANNEL_TARGET_LIMIT,
		"the diagnostic is bounded so a large deployment cannot fan out",
	);
});

test("a channel linked by someone else is still told (the notice is not user-scoped)", async () => {
	const { deps, sent } = recordingDeps({
		getLobbyRecord: async (guildId) => ({ lobbyId: `lobby-${guildId}`, creatorId: "someone-else" }),
	});

	const outcome = await notifyLinkedChannelsOfDeauthorization({ id: "285118390031351809" }, deps);

	assert.equal(sent.length, 2, "both servers have a linked channel to post into");
	assert.deepEqual(outcome.ownedByUser, [], "this user owns neither link");
});

test("the connection is dropped even when there is nothing to notify", async () => {
	for (const overrides of [
		{ listGuilds: async () => [] },
		{ readLinkedChannelId: async () => null },
		{ getLobbyRecord: async () => null },
	]) {
		const { deps, sent, deleted } = recordingDeps(overrides);
		const outcome = await notifyLinkedChannelsOfDeauthorization({ id: "285118390031351809" }, deps);
		assert.equal(sent.length, 0, "nothing to post to");
		assert.deepEqual(deleted, ["285118390031351809"]);
		assert.ok(outcome.connectionDeleted);
	}
});

test("a lobby without a linked channel is reported, not treated as a failure", async () => {
	const bothGuilds = ["1525905980422885406", "999999999999999999"];
	const { deps, sent } = recordingDeps({ readLinkedChannelId: async () => null });
	const outcome = await notifyLinkedChannelsOfDeauthorization({ id: "285118390031351809" }, deps);
	assert.deepEqual(outcome.withoutLinkedChannel, bothGuilds, "every lobby is checked, even without a link");
	assert.equal(sent.length, 0);
	// A lobby whose id was reaped must not stop the notification either.
	const reaped = recordingDeps({
		readLinkedChannelId: async () => {
			throw new Error("Unknown Lobby");
		},
	});
	const reapedOutcome = await notifyLinkedChannelsOfDeauthorization(
		{ id: "285118390031351809" },
		reaped.deps,
	);
	assert.deepEqual(reapedOutcome.withoutLinkedChannel, bothGuilds);
});

test("a reaped lobby does not hide its channel — the remembered channel is used", async () => {
	// The bug this covers: the target list used to come from a *live* lobby read,
	// and lobbies are sessions Discord reaps when idle. A guild whose lobby
	// happened to be idle was dropped from the broadcast in silence, which is
	// exactly what "it only reached one channel" looks like from Discord.
	const { deps, sent } = recordingDeps({
		getLobbyRecord: async (guildId) => ({
			lobbyId: `lobby-${guildId}`,
			creatorId: "285118390031351809",
			channelId: `channel-${guildId}`,
		}),
		readLinkedChannelId: async () => {
			throw new Error("404 — Unknown Lobby");
		},
	});

	const outcome = await notifyLinkedChannelsOfDeauthorization(
		{ id: "285118390031351809", username: "tester" },
		deps,
	);

	assert.deepEqual(
		sent.map((entry) => entry.channelId),
		["channel-1525905980422885406", "channel-999999999999999999"],
		"every remembered channel is posted into even though no lobby could be read",
	);
	assert.deepEqual(outcome.withoutLinkedChannel, [], "nothing was skipped");
});

test("the live channel is remembered, so the next notice needs no live lobby at all", async () => {
	const learned = recordingDeps({
		getLobbyRecord: async (guildId) => ({
			lobbyId: `lobby-${guildId}`,
			creatorId: "285118390031351809",
		}),
	});
	await notifyLinkedChannelsOfDeauthorization({ id: "285118390031351809" }, learned.deps);
	assert.deepEqual(
		learned.remembered,
		[
			["1525905980422885406", "1525905982000070780"],
			["999999999999999999", "1525905982000070780"],
		],
		"what Discord reported is written to the guild's record",
	);

	const alreadyStored = recordingDeps({
		getLobbyRecord: async (guildId) => ({
			lobbyId: `lobby-${guildId}`,
			creatorId: "285118390031351809",
			channelId: "1525905982000070780",
		}),
	});
	await notifyLinkedChannelsOfDeauthorization({ id: "285118390031351809" }, alreadyStored.deps);
	assert.deepEqual(alreadyStored.remembered, [], "an unchanged value is not rewritten");
});

test("one unreachable channel neither mutes the others nor disappears", async () => {
	const { deps, sent } = recordingDeps({
		listGuilds: async () => ["a", "b", "c"],
		getLobbyRecord: async (guildId) => ({
			lobbyId: guildId,
			creatorId: "u",
			channelId: `ch-${guildId}`,
		}),
		readLinkedChannelId: async () => null,
		sendChannelMessage: async (channelId) => {
			if (channelId === "ch-b") throw new Error("Missing Permissions");
			sent.push({ channelId, content: "" });
			return { id: "1" };
		},
	});

	const outcome = await notifyLinkedChannelsOfDeauthorization({ id: "u", username: "t" }, deps);

	assert.deepEqual(
		outcome.notified.map((entry) => entry.channelId),
		["ch-a", "ch-c"],
		"a channel the bot cannot post in must not stop the ones after it",
	);
	assert.equal(outcome.failed.length, 1);
	assert.match(outcome.failed[0]?.error ?? "", /Missing Permissions/);
	assert.match(
		describeDeauthorizationOutcome(outcome),
		/connection dropped; notified <#ch-a>, <#ch-c>; failed <#ch-b>/,
		"the log names which channels were reached and which were not",
	);
});

test("the notice names the user and explains that linking stops working", () => {
	const message = deauthorizationMessage({ id: "1", username: "tester" });
	assert.match(message, /tester/);
	assert.match(message, /Reconnect Discord/);
	assert.match(message, /still read and post/, "members keep the channel");
	assert.doesNotMatch(message, /<@1>/, "a notification must not ping the user");
	assert.match(deauthorizationMessage({ id: "1" }), /A member/);
});

test("event summaries describe what arrived, for /api/diag", () => {
	assert.match(
		summarizeEvent({
			version: 1,
			application_id: "1",
			type: 1,
			event: {
				type: WebhookEventType.LobbyMessageCreate,
				timestamp: "t",
				data: {
					id: "5",
					type: 0,
					content: "hello from the game",
					lobby_id: "9",
					channel_id: "1525905982000070780",
					author: { id: "7", username: "player" },
					flags: 0,
				},
			},
		} as WebhookEventPayload),
		/hello from the game.*player|player.*hello from the game/s,
	);
	assert.match(summarizeEvent(deauthorizedPayload()), /tester/);
	assert.equal(
		summarizeEvent({
			version: 1,
			application_id: "1",
			type: 1,
			event: { type: "SOMETHING_NEW", timestamp: "t" },
		} as unknown as WebhookEventPayload),
		"",
	);
});

test("a redelivered event has the same delivery key, a different event does not", () => {
	const first = deliveryKeyOf(deauthorizedPayload());
	assert.equal(first, deliveryKeyOf(deauthorizedPayload()), "retries repeat the payload");
	assert.notEqual(first, deliveryKeyOf(deauthorizedPayload("999")));
	assert.equal(deliveryKeyOf({ version: 1, application_id: "1", type: 0 }), undefined, "PINGs are not deduped");
});

test("the endpoint verifies Discord's signature and answers 204 — or 401", async () => {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const publicKeyHex = Buffer.from(
		(publicKey.export({ format: "jwk" }) as { x: string }).x,
		"base64url",
	).toString("hex");

	const seen: string[] = [];
	const endpoint = new WebhookEventEndpoint({
		publicKey: publicKeyHex,
		router: new WebhookEventRouter()
			.onPing(() => {
				seen.push("PING");
			})
			.on(WebhookEventType.ApplicationDeauthorized, (payload) => {
				seen.push(`deauthorized:${payload.event.data?.user.id}`);
			}),
	});

	const deliver = (body: string, key: KeyObject = privateKey, timestamp = "1700000000") => ({
		body,
		timestamp,
		signature: signWithKey(null, Buffer.from(timestamp + body), key).toString("hex"),
	});

	// Discord validates the URL with a PING and requires an empty 204.
	const ping = JSON.stringify({ version: 1, application_id: "1", type: 0 });
	assert.deepEqual(await endpoint.handle(deliver(ping)), { status: 204, body: "" });
	assert.deepEqual(seen, ["PING"], "the PING handler ran");

	const event = JSON.stringify(deauthorizedPayload());
	assert.deepEqual(await endpoint.handle(deliver(event)), { status: 204, body: "" });
	assert.deepEqual(seen, ["PING", "deauthorized:285118390031351809"]);

	// Discord routinely re-checks the endpoint with invalid signatures and
	// removes the URL when they are not rejected.
	const { privateKey: otherKey } = generateKeyPairSync("ed25519");
	assert.equal((await endpoint.handle(deliver(event, otherKey))).status, 401);
	// A signature over the old timestamp must not be replayable with a new one.
	const signed = deliver(event);
	assert.equal(
		(await endpoint.handle({ ...signed, timestamp: "1800000000" })).status,
		401,
		"the timestamp is covered by the signature",
	);
	assert.equal((await endpoint.handle({ body: event })).status, 401, "missing headers are refused");
	assert.deepEqual(seen, ["PING", "deauthorized:285118390031351809"], "rejected requests run nothing");
});
