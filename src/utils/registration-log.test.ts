import assert from "node:assert/strict";
import test from "node:test";

import { REGISTRATION_LOG_KEY } from "./registration-log.ts";
import {
	describeRegistrationProblem,
	describeRegistrationScope,
	deployRegistrationScopes,
	withCommandScope,
} from "./registration-log.ts";
import type { RegistrationRecord, RegistrationScopeOutcome } from "./registration-log.ts";

/**
 * The registration log exists because a build's registration could fail and
 * leave **no readable trace** — three deploys shipped while Discord kept a
 * command list from before `/mesaj`. The logic worth pinning is small and
 * therefore easy to get subtly wrong, which is exactly when silence hurts:
 *
 * - a configured guild means **both** scopes (guild for instant feedback, global
 *   for every other server), not the guild *instead of* global;
 * - a failed attempt must read as a problem with Discord's own reason, not as a
 *   success nobody can distinguish from one.
 */

const outcome = (over: Partial<RegistrationScopeOutcome>): RegistrationScopeOutcome => ({
	scope: "global",
	ok: true,
	...over,
});

const record = (over: Partial<RegistrationRecord> = {}): RegistrationRecord => ({
	at: "2026-09-20T12:00:00.000Z",
	commit: "277a138",
	ok: true,
	scopes: [outcome({})],
	...over,
});

test("a configured guild registers both scopes — guild first, then global", () => {
	assert.deepEqual(deployRegistrationScopes("1525905980422885406"), [
		"1525905980422885406",
		null,
	]);
});

test("without a configured guild only the global scope is registered", () => {
	assert.deepEqual(deployRegistrationScopes(undefined), [null]);
	assert.deepEqual(deployRegistrationScopes(null), [null]);
	assert.deepEqual(deployRegistrationScopes(""), [null], "an empty guild id is no guild");
});

test("scope labels read unambiguously in logs and in the recorded outcome", () => {
	assert.equal(describeRegistrationScope(null), "global");
	assert.equal(describeRegistrationScope("1525905980422885406"), "guild:1525905980422885406");
});

test("a completed registration is not a problem", () => {
	assert.equal(describeRegistrationProblem(record()), null);
});

test("a failed scope is a problem that names the scope and Discord's reason", () => {
	const problem = describeRegistrationProblem(
		record({
			ok: false,
			scopes: [
				outcome({ scope: "guild:1525905980422885406", ok: true }),
				outcome({ scope: "global", ok: false, error: "401: Unauthorized" }),
			],
		}),
	);

	assert.match(problem ?? "", /did not complete/);
	assert.match(problem ?? "", /commit 277a138/);
	assert.match(problem ?? "", /global: 401: Unauthorized/);
	assert.match(problem ?? "", /npm run register/);
});

test("a skip with nothing attempted is a problem that says so", () => {
	const problem = describeRegistrationProblem(
		record({ ok: false, scopes: [], reason: "skipped — DISCORD_BOT_TOKEN is not set" }),
	);
	assert.match(problem ?? "", /skipped — DISCORD_BOT_TOKEN is not set/);

	const unexplained = describeRegistrationProblem(record({ ok: false, scopes: [] }));
	assert.match(unexplained ?? "", /no scope was attempted/);
});

test("the key is namespaced with the other diagnostics", () => {
	assert.match(REGISTRATION_LOG_KEY, /^diag:/);
});

test("withCommandScope pins the route variable per call and restores it", async () => {
	const seen: (string | undefined)[] = [];
	const capture = async () => {
		seen.push(process.env.DISCORD_GUILD_ID);
		return "done";
	};

	// With no variable set to begin with: the guild call sets it, the global call
	// removes it entirely (the library treats any value, even empty, as a guild),
	// and afterwards the environment is exactly as it started.
	delete process.env.DISCORD_GUILD_ID;
	assert.equal(await withCommandScope("1525905980422885406", capture), "done");
	assert.equal(await withCommandScope(null, capture), "done");
	assert.deepEqual(seen, ["1525905980422885406", undefined]);
	assert.equal("DISCORD_GUILD_ID" in process.env, false, "nothing leaked into the environment");

	// With a variable set to begin with: both calls see their own scope, and the
	// original value survives both.
	process.env.DISCORD_GUILD_ID = "999888777666555444";
	try {
		seen.length = 0;
		await withCommandScope("1525905980422885406", capture);
		await withCommandScope(null, capture);
		assert.deepEqual(seen, ["1525905980422885406", undefined]);
		assert.equal(process.env.DISCORD_GUILD_ID, "999888777666555444", "the previous value is restored");
	} finally {
		delete process.env.DISCORD_GUILD_ID;
	}
});

test("withCommandScope restores the environment even when the call throws", async () => {
	process.env.DISCORD_GUILD_ID = "999888777666555444";
	try {
		await assert.rejects(
			withCommandScope(null, async () => {
				throw new Error("Discord answered 429");
			}),
			/429/,
		);
		assert.equal(process.env.DISCORD_GUILD_ID, "999888777666555444", "restored in a finally, not on the happy path");
	} finally {
		delete process.env.DISCORD_GUILD_ID;
	}
});
