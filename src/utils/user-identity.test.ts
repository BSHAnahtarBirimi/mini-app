import assert from "node:assert/strict";
import test from "node:test";

import { checkUserToken, describeTokenCheck, interpretTokenCheckError } from "./user-identity.ts";

/**
 * `/authorize` decides whether to tell you "connected", "the scope is missing"
 * or "this connection is revoked" from what this probe says, so the classification
 * is pinned here: only a `401` means revoked. Anything else — a 403, a 500, a
 * timeout, a transport error — must leave a possibly-good connection alone,
 * because dropping one because Discord hiccuped is worse than reporting a
 * connection that turns out to be dead.
 */

const withAppId = async <T>(value: string | undefined, run: () => Promise<T>): Promise<T> => {
	const previous = process.env.DISCORD_APPLICATION_ID;
	if (value === undefined) delete process.env.DISCORD_APPLICATION_ID;
	else process.env.DISCORD_APPLICATION_ID = value;
	try {
		return await run();
	} finally {
		if (previous === undefined) delete process.env.DISCORD_APPLICATION_ID;
		else process.env.DISCORD_APPLICATION_ID = previous;
	}
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

/** Records every request the probe makes. */
function recordingFetch(response: Response | (() => Promise<Response>)) {
	const calls: { url: string; authorization: string | undefined }[] = [];
	const fetchImpl = (async (url: string, init?: RequestInit) => {
		const headers = (init?.headers ?? {}) as Record<string, string>;
		calls.push({ url: String(url), authorization: headers.Authorization ?? headers.authorization });
		return typeof response === "function" ? response() : response;
	}) as unknown as typeof fetch;
	return { fetchImpl, calls };
}

test("a working token is confirmed, with the scopes Discord actually granted", async () => {
	const { fetchImpl, calls } = recordingFetch(
		jsonResponse({
			application: { id: "1530890351101874277" },
			scopes: ["openid", "sdk.social_layer"],
			expires: "2026-10-01T00:00:00.000000+00:00",
		}),
	);

	const check = await withAppId("1530890351101874277", () =>
		checkUserToken("user-token", { fetch: fetchImpl }),
	);

	assert.equal(check.state, "valid");
	assert.deepEqual(check, {
		state: "valid",
		scopes: ["openid", "sdk.social_layer"],
		expiresAt: "2026-10-01T00:00:00.000000+00:00",
	});
	assert.equal(calls[0]?.url, "https://discord.com/api/oauth2/@me", "the package's own endpoint");
	assert.equal(calls[0]?.authorization, "Bearer user-token", "a user token, never the bot token");
});

test("a 401 means the connection is revoked", async () => {
	const { fetchImpl } = recordingFetch(jsonResponse({ message: "401: Unauthorized", code: 0 }, 401));
	const check = await withAppId("1530890351101874277", () =>
		checkUserToken("dead-token", { fetch: fetchImpl }),
	);

	assert.equal(check.state, "revoked");
	assert.match(check.state === "revoked" ? check.reason : "", /401/);
});

test("a 403 is not a revocation — it says the check failed", async () => {
	const { fetchImpl } = recordingFetch(jsonResponse({ message: "Forbidden", code: 50001 }, 403));
	const check = await withAppId("1530890351101874277", () =>
		checkUserToken("t", { fetch: fetchImpl }),
	);

	assert.equal(check.state, "unknown", "only 401 may drop a stored connection");
	assert.match(check.state === "unknown" ? check.reason : "", /403/);
});

test("a server error, a thrown transport error and a timeout are all inconclusive", async () => {
	const server = await withAppId("1530890351101874277", () =>
		checkUserToken("t", { fetch: recordingFetch(jsonResponse({ message: "boom" }, 500)).fetchImpl }),
	);
	assert.equal(server.state, "unknown");
	assert.match(server.state === "unknown" ? server.reason : "", /500/);

	const thrown = await withAppId("1530890351101874277", () =>
		checkUserToken("t", {
			fetch: (async () => {
				throw new Error("getaddrinfo ENOTFOUND discord.com");
			}) as unknown as typeof fetch,
		}),
	);
	assert.equal(thrown.state, "unknown");
	assert.match(thrown.state === "unknown" ? thrown.reason : "", /ENOTFOUND/);

	const stalled = await withAppId("1530890351101874277", () =>
		checkUserToken("t", {
			fetch: (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch,
			timeoutMs: 25,
		}),
	);
	assert.equal(stalled.state, "unknown");
	assert.match(stalled.state === "unknown" ? stalled.reason : "", /did not answer/);
});

test("without an application id it reports that it cannot check, and calls nothing", async () => {
	const { fetchImpl, calls } = recordingFetch(jsonResponse({ scopes: [] }));
	const check = await withAppId(undefined, () =>
		checkUserToken("t", { fetch: fetchImpl }),
	);

	assert.equal(check.state, "unknown");
	assert.equal(calls.length, 0);
});

test("the verdicts have one-line descriptions for the reply and /api/diag", () => {
	assert.match(
		describeTokenCheck({ state: "valid", scopes: ["openid"], expiresAt: null }),
		/confirmed by Discord — scopes: openid/,
	);
	assert.match(describeTokenCheck({ state: "valid", scopes: [], expiresAt: null }), /none reported/);
	assert.equal(describeTokenCheck({ state: "revoked", reason: "gone" }), "gone");
	assert.match(describeTokenCheck({ state: "unknown", reason: "slow" }), /could not be verified \(slow\)/);
});

test("errors are classified from the package's own error types", () => {
	// The probe turns Discord's answer into a verdict, so the classes it keys on
	// are pinned: an OAuth2RequestError carries the status.
	const revoked = interpretTokenCheckError(
		Object.assign(new Error("401"), { status: 401, body: "{}", url: "u", name: "wrong" }),
	);
	assert.equal(revoked.state, "unknown", "a look-alike error is not a revocation");
});
