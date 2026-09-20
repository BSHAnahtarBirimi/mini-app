import assert from "node:assert/strict";
import test from "node:test";

import { handleActivity } from "../../api/activity.ts";
import type { ActivityDeps } from "../../api/activity.ts";
import { ActivityAuthError } from "./activity-auth.ts";

/**
 * `/api/activity` is what a Discord frame calls before it can do anything, so a
 * wrong answer here is an Activity that never starts. The handler is driven
 * directly, for the same reason `/api/diag` and `/api/message` are: the contract
 * — what `GET` reports, how each exchange failure is classified, and that the
 * secret never appears in any response — is checked rather than assumed.
 */

type FakeResponse = {
	statusCode: number;
	body: string;
	headers: Record<string, string>;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
};

function fakeResponse(): FakeResponse {
	const res: FakeResponse = {
		statusCode: 0,
		body: "",
		headers: {},
		setHeader(name, value) {
			res.headers[name.toLowerCase()] = value;
		},
		end(body) {
			res.body = body ?? "";
		},
	};
	return res;
}

function json(res: FakeResponse): Record<string, unknown> {
	return JSON.parse(res.body) as Record<string, unknown>;
}

function deps(overrides: Partial<ActivityDeps> = {}): ActivityDeps {
	return {
		config: () => ({ clientId: "1530890351101874277", tokenExchange: true }),
		exchange: async () => ({ accessToken: "the-token", scope: "identify guilds", expiresIn: 604800 }),
		...overrides,
	};
}

async function call(
	request: { method?: string; body?: unknown; url?: string },
	overrides: Partial<ActivityDeps> = {},
): Promise<FakeResponse> {
	const res = fakeResponse();
	await handleActivity(request, res, deps(overrides));
	return res;
}

test("GET reports what the page needs to start, and nothing secret", async () => {
	const res = await call({ method: "GET" });
	assert.equal(res.statusCode, 200);
	const body = json(res);
	assert.equal(body.ok, true);
	assert.equal(body.clientId, "1530890351101874277");
	assert.deepEqual(body.scopes, ["identify", "guilds"]);
	assert.equal(body.tokenExchange, true);
	assert.deepEqual(body.missing, []);
	assert.equal(JSON.stringify(body).includes("secret"), false);
});

test("GET names the missing variables instead of leaving a blank frame", async () => {
	const res = await call(
		{ method: "GET" },
		{ config: () => ({ clientId: null, tokenExchange: false }) },
	);
	const body = json(res);
	assert.equal(body.clientId, null);
	assert.equal(body.tokenExchange, false);
	assert.deepEqual(body.missing, ["DISCORD_APPLICATION_ID", "DISCORD_CLIENT_SECRET"]);

	const partial = await call(
		{ method: "GET" },
		{ config: () => ({ clientId: "1530890351101874277", tokenExchange: false }) },
	);
	assert.deepEqual(json(partial).missing, ["DISCORD_CLIENT_SECRET"]);
});

test("POST exchanges the code and returns the member's token", async () => {
	const res = await call({ method: "POST", body: { code: "nfAiW1ZOzZVGux0lkafLrJrUuu4JRl" } });
	assert.equal(res.statusCode, 200);
	assert.deepEqual(json(res), {
		ok: true,
		accessToken: "the-token",
		scope: "identify guilds",
		expiresIn: 604800,
	});
});

test("POST accepts a body Vercel left unparsed", async () => {
	const res = await call({ method: "POST", body: JSON.stringify({ code: "a-code" }) });
	assert.equal(res.statusCode, 200);
	assert.equal(json(res).accessToken, "the-token");
});

test("a missing or malformed code is refused without touching Discord", async () => {
	let exchanges = 0;
	for (const body of [{}, { code: "" }, { code: "  " }, { code: 7 }, { code: "not a code" }]) {
		const res = await call(
			{ method: "POST", body },
			{
				exchange: async () => {
					exchanges += 1;
					return { accessToken: "x", scope: null, expiresIn: null };
				},
			},
		);
		assert.equal(res.statusCode, 400, `${JSON.stringify(body)} must be a 400`);
		assert.equal(json(res).ok, false);
	}
	assert.equal(exchanges, 0);
});

test("Discord's own refusal is classified rather than lumped together", async () => {
	const badCode = await call(
		{ method: "POST", body: { code: "used-code" } },
		{
			exchange: async () => {
				throw new ActivityAuthError("Discord refused the code: 400 — Invalid \"code\" in request.", {
					status: 400,
				});
			},
		},
	);
	assert.equal(badCode.statusCode, 400);
	assert.match(String(json(badCode).error), /Invalid "code"/);

	// 401 is the application's credentials, which is a deployment problem, not a
	// reason for the member to press the button again.
	const badApp = await call(
		{ method: "POST", body: { code: "a-code" } },
		{
			exchange: async () => {
				throw new ActivityAuthError("Discord refused the code: 401 — Invalid client", { status: 401 });
			},
		},
	);
	assert.equal(badApp.statusCode, 401);

	// A missing secret produces no status at all and must not read as the
	// caller's fault.
	const unconfigured = await call(
		{ method: "POST", body: { code: "a-code" } },
		{
			exchange: async () => {
				throw new ActivityAuthError("set DISCORD_CLIENT_SECRET", { reason: "missing configuration" });
			},
		},
	);
	assert.equal(unconfigured.statusCode, 400);

	const unexpected = await call(
		{ method: "POST", body: { code: "a-code" } },
		{
			exchange: async () => {
				throw new Error("boom");
			},
		},
	);
	assert.equal(unexpected.statusCode, 500);
	assert.match(String(json(unexpected).error), /boom/);
});

test("only GET and POST are served", async () => {
	const res = await call({ method: "PUT" });
	assert.equal(res.statusCode, 405);
	assert.equal(res.headers.allow, "GET, POST");
});
