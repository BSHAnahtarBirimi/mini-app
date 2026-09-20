import assert from "node:assert/strict";
import test from "node:test";

import {
	ACTIVITY_SCOPES,
	ActivityAuthError,
	activityConfig,
	checkActivityCode,
	exchangeActivityCode,
} from "./activity-auth.ts";

/**
 * The Activity's code exchange is the only place this app sends its client
 * secret anywhere, so the contract is pinned here: the exact request Discord
 * expects (form-encoded, no `redirect_uri`), what comes back on success, and one
 * distinguishable failure per cause — a bad code, rejected credentials, a
 * network failure — because each of them needs a different answer on the page.
 */

const ENV_KEYS = ["DISCORD_APPLICATION_ID", "DISCORD_APP_ID", "DISCORD_CLIENT_SECRET"] as const;

/** Runs `body` with exactly `env` set, restoring the previous values after. */
async function withEnv<T>(env: Partial<Record<(typeof ENV_KEYS)[number], string>>, body: () => Promise<T> | T): Promise<T> {
	const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
	for (const key of ENV_KEYS) delete process.env[key];
	Object.assign(process.env, env);
	try {
		return await body();
	} finally {
		for (const key of ENV_KEYS) {
			if (previous[key] === undefined) delete process.env[key];
			else process.env[key] = previous[key];
		}
	}
}

/** A `fetch` stub that records the request and answers with `response`. */
function stubFetch(response: {
	ok?: boolean;
	status?: number;
	body: string;
}): { calls: { url: string; init: RequestInit }[]; fetchImpl: typeof fetch } {
	const calls: { url: string; init: RequestInit }[] = [];
	const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
		calls.push({ url: String(url), init: init ?? {} });
		return new Response(response.body, { status: response.status ?? (response.ok === false ? 400 : 200) });
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
}

test("checkActivityCode accepts an opaque code and refuses anything else", () => {
	assert.deepEqual(checkActivityCode("nfAiW1ZOzZVGux0lkafLrJrUuu4JRl"), {
		ok: true,
		code: "nfAiW1ZOzZVGux0lkafLrJrUuu4JRl",
	});

	for (const bad of [undefined, null, "", "   ", 42, {}, "code with spaces", "code\nwith-newline"]) {
		const checked = checkActivityCode(bad);
		assert.equal(checked.ok, false, `${JSON.stringify(bad)} must be refused`);
		if (!checked.ok) assert.equal(checked.status, 400);
	}
});

test("activityConfig reports the client id but never the secret", async () => {
	await withEnv({}, () => {
		assert.deepEqual(activityConfig(), { clientId: null, tokenExchange: false });
	});
	await withEnv({ DISCORD_APPLICATION_ID: "1530890351101874277" }, () => {
		assert.deepEqual(activityConfig(), { clientId: "1530890351101874277", tokenExchange: false });
	});
	await withEnv(
		{ DISCORD_APP_ID: "1530890351101874277", DISCORD_CLIENT_SECRET: "s3cret" },
		() => {
			const config = activityConfig();
			assert.equal(config.tokenExchange, true);
			assert.equal(JSON.stringify(config).includes("s3cret"), false);
		},
	);
});

test("the code exchange sends exactly what Discord's Activity flow expects", async () => {
	await withEnv(
		{ DISCORD_APPLICATION_ID: "1530890351101874277", DISCORD_CLIENT_SECRET: "s3cret" },
		async () => {
			const { calls, fetchImpl } = stubFetch({
				body: JSON.stringify({ access_token: "the-token", scope: "identify guilds", expires_in: 604800 }),
			});

			const token = await exchangeActivityCode("some-code", { fetchImpl });

			assert.equal(calls.length, 1);
			assert.equal(calls[0].url, "https://discord.com/api/oauth2/token");
			assert.equal(calls[0].init.method, "POST");
			assert.deepEqual(calls[0].init.headers, {
				"Content-Type": "application/x-www-form-urlencoded",
			});

			const body = new URLSearchParams(String(calls[0].init.body));
			assert.equal(body.get("grant_type"), "authorization_code");
			assert.equal(body.get("client_id"), "1530890351101874277");
			assert.equal(body.get("client_secret"), "s3cret");
			assert.equal(body.get("code"), "some-code");
			// The SDK's `authorize` performs no redirect, so sending one would be a
			// mismatch Discord rejects outright.
			assert.equal(body.has("redirect_uri"), false);

			assert.deepEqual(token, {
				accessToken: "the-token",
				scope: "identify guilds",
				expiresIn: 604800,
			});
		},
	);
});

test("Discord's refusal is reported with its own status and reason", async () => {
	await withEnv(
		{ DISCORD_APPLICATION_ID: "1530890351101874277", DISCORD_CLIENT_SECRET: "s3cret" },
		async () => {
			const { fetchImpl } = stubFetch({
				ok: false,
				status: 400,
				body: JSON.stringify({
					error: "invalid_grant",
					error_description: "Invalid \"code\" in request.",
				}),
			});

			const error = await exchangeActivityCode("used-code", { fetchImpl }).catch(
				(caught: unknown) => caught,
			);
			assert.ok(error instanceof ActivityAuthError);
			assert.equal(error.status, 400);
			assert.match(error.message, /Invalid "code" in request/);
		},
	);
});

test("rejected credentials keep Discord's 401 so the endpoint can say whose fault it is", async () => {
	await withEnv(
		{ DISCORD_APPLICATION_ID: "1530890351101874277", DISCORD_CLIENT_SECRET: "wrong" },
		async () => {
			const { fetchImpl } = stubFetch({
				ok: false,
				status: 401,
				body: JSON.stringify({ error: "invalid_client", error_description: "Invalid client" }),
			});

			const error = await exchangeActivityCode("some-code", { fetchImpl }).catch(
				(caught: unknown) => caught,
			);
			assert.ok(error instanceof ActivityAuthError);
			assert.equal(error.status, 401);
		},
	);
});

test("a non-JSON error body is still reported, and a 200 without a token is an error", async () => {
	await withEnv(
		{ DISCORD_APPLICATION_ID: "1530890351101874277", DISCORD_CLIENT_SECRET: "s3cret" },
		async () => {
			const html = stubFetch({ ok: false, status: 502, body: "<html>bad gateway</html>" });
			const refused = await exchangeActivityCode("code", { fetchImpl: html.fetchImpl }).catch(
				(caught: unknown) => caught,
			);
			assert.ok(refused instanceof ActivityAuthError);
			assert.match(refused.message, /bad gateway/);

			const empty = stubFetch({ body: JSON.stringify({ token_type: "Bearer" }) });
			const missing = await exchangeActivityCode("code", { fetchImpl: empty.fetchImpl }).catch(
				(caught: unknown) => caught,
			);
			assert.ok(missing instanceof ActivityAuthError);
			assert.equal(missing.status, null);
			assert.match(missing.message, /no access token/);
		},
	);
});

test("an unreachable Discord is a network failure, not a bad code", async () => {
	await withEnv(
		{ DISCORD_APPLICATION_ID: "1530890351101874277", DISCORD_CLIENT_SECRET: "s3cret" },
		async () => {
			const fetchImpl = (async () => {
				throw new Error("socket hang up");
			}) as unknown as typeof fetch;

			const error = await exchangeActivityCode("code", { fetchImpl }).catch(
				(caught: unknown) => caught,
			);
			assert.ok(error instanceof ActivityAuthError);
			assert.equal(error.reason, "network");
			assert.match(error.message, /socket hang up/);
		},
	);
});

test("without the client secret nothing is sent to Discord at all", async () => {
	await withEnv({ DISCORD_APPLICATION_ID: "1530890351101874277" }, async () => {
		const { calls, fetchImpl } = stubFetch({ body: "{}" });

		const error = await exchangeActivityCode("code", { fetchImpl }).catch(
			(caught: unknown) => caught,
		);
		assert.ok(error instanceof ActivityAuthError);
		assert.equal(error.reason, "missing configuration");
		assert.equal(calls.length, 0);
	});
});

test("the Activity asks only for scopes that do not need special access", () => {
	// `sdk.social_layer` would fail the whole authorization on an app that has
	// not been accepted into the Social SDK program, while delivery goes through
	// each server's own stored member connection anyway.
	assert.deepEqual([...ACTIVITY_SCOPES], ["identify", "guilds"]);
});
