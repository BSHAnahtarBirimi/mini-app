import assert from "node:assert/strict";
import test from "node:test";

import handleDiag from "../../api/diag.ts";

/**
 * `?command=authorize` exists because a Discord interaction cannot be produced
 * from outside Discord (they are Ed25519-signed with the application's private
 * key) — and waiting for a human to press a broken recovery path is how it stays
 * broken. The endpoint therefore runs the command's own handler against a stub
 * interaction and reports what it would have sent, so a deployment can be asked
 * "does `/authorize` still produce a correct link?" without anyone typing
 * anything.
 */

type FakeResponse = {
	statusCode: number;
	body: string;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
};

function fakeResponse(): FakeResponse {
	const res: FakeResponse = {
		statusCode: 0,
		body: "",
		setHeader: () => undefined,
		end(body?: string) {
			res.body = body ?? "";
		},
	};
	return res;
}

/**
 * Runs the endpoint without a configured database: diagnostics read the
 * deployment's failure log from it, and a test must not depend on — or add to —
 * what happens to be in the live one.
 */
async function diag(query: string): Promise<Record<string, unknown>> {
	const saved = process.env.MONGODB_URI;
	delete process.env.MONGODB_URI;
	const res = fakeResponse();
	try {
		await handleDiag({ method: "GET", url: `/api/diag${query}`, headers: {} }, res);
	} finally {
		if (saved !== undefined) process.env.MONGODB_URI = saved;
	}
	assert.equal(res.statusCode, 200, "diagnostics must always answer");
	return JSON.parse(res.body) as Record<string, unknown>;
}

/** Every string a serialised reply carries. */
function textOf(reply: unknown): string {
	const parts: string[] = [];
	const walk = (value: unknown): void => {
		if (typeof value === "string") {
			parts.push(value);
			return;
		}
		if (Array.isArray(value)) {
			value.forEach(walk);
			return;
		}
		if (value && typeof value === "object") {
			for (const [key, inner] of Object.entries(value)) {
				if (key === "url" && typeof inner === "string") parts.push(inner);
				else walk(inner);
			}
		}
	};
	walk(reply);
	return parts.join("\n");
}

test("the command is not run unless it is asked for", async () => {
	const body = await diag("");
	assert.equal("authorizeCommand" in body, false);
});

test("?command=authorize runs the command and reports the reply it produced", async () => {
	const body = await diag("?command=authorize");
	const probe = body.authorizeCommand as {
		ok: boolean;
		deferred: boolean;
		replies: unknown[];
		error: string | null;
	};

	assert.ok(probe, "the probe is reported");
	assert.equal(probe.deferred, true, "the command must acknowledge before it can be answered");
	assert.equal(probe.replies.length >= 1, true, "a reply was produced");
	assert.equal(probe.error, null);
	assert.equal(probe.ok, true);
});

test("with no OAuth environment the probe still answers, and says so", async () => {
	// The test environment has no Discord credentials, which is exactly the
	// "misconfigured deployment" case: the command must reply with an
	// explanation instead of failing after the deferral.
	const body = await diag("?command=authorize");
	const probe = body.authorizeCommand as { ok: boolean; replies: unknown[] };
	const text = textOf(probe.replies);
	assert.equal(probe.ok, true, "an explanatory reply is a working command");
	assert.match(text, /no connection stored yet|No link to show|DISCORD_/);
});

test("no problems are reported for a command that answered", async () => {
	const body = await diag("?command=authorize");
	const problems = (body.problems as string[]) ?? [];
	assert.deepEqual(
		problems.filter((problem) => problem.includes("/authorize")),
		[],
		"a command that produced a reply is not a problem",
	);
});
