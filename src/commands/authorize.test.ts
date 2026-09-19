import assert from "node:assert/strict";
import test from "node:test";

import { MessageFlags } from "@minesa-org/mini-interaction";

import { createAuthorizeHandler, resolveAuthorizeReply } from "./authorize.ts";
import type { AuthorizeDeps } from "./authorize.ts";
import type { StoredUserToken } from "../utils/lobby-tokens.ts";
import type { UserTokenCheck } from "../utils/user-identity.ts";

/**
 * `/authorize` is the recovery path when a connection is missing, incomplete or
 * dead, so its reply is driven here for every one of those states — including
 * the one nothing else can detect: a stored token Discord has already revoked,
 * which must be dropped (otherwise the app keeps claiming a connection that
 * cannot do anything) and reported.
 */

const ENV = {
	DISCORD_APPLICATION_ID: "1530890351101874277",
	DISCORD_CLIENT_SECRET: "secret",
	DISCORD_REDIRECT_URI: "https://example.test/api/discord-oauth-callback",
} as NodeJS.ProcessEnv;

/**
 * Test isolation. A handler that throws records the failure in the database it
 * is configured with, and the development environment points at the
 * deployment's real one — so a test that deliberately provokes a failure would
 * plant a fake entry in the live diagnostics log (and `/api/diag` would then
 * report a problem that never happened).
 */
async function withoutDatabase<T>(action: () => Promise<T>): Promise<T> {
	const saved = process.env.MONGODB_URI;
	delete process.env.MONGODB_URI;
	try {
		return await action();
	} finally {
		if (saved !== undefined) process.env.MONGODB_URI = saved;
	}
}

type AnyNode = {
	type?: number;
	style?: number;
	url?: string;
	content?: string;
	accessory?: unknown;
	components?: AnyNode[];
};

/** A reply is `{ flags, components }` (V2) or `{ content, components }` (legacy). */
type Reply = { flags?: number; content?: string; components?: AnyNode[] };

const componentsOf = (reply: Reply): AnyNode[] =>
	Array.isArray(reply.components) ? reply.components : [];

/** Walks a serialised payload (containers → action rows → components). */
function visit(components: unknown[], onNode: (node: AnyNode) => void): void {
	for (const value of components) {
		if (Array.isArray(value)) {
			visit(value, onNode);
			continue;
		}
		if (!value || typeof value !== "object") continue;
		const node = value as AnyNode;
		onNode(node);
		if (Array.isArray(node.components)) visit(node.components, onNode);
	}
}

/** Everything the reply says, in any of its forms. */
function allText(reply: Reply): string {
	const parts: string[] = [];
	if (typeof reply.content === "string") parts.push(reply.content);
	visit(componentsOf(reply), (node) => {
		if (typeof node.content === "string") parts.push(node.content);
	});
	return parts.join("\n");
}

/** The link button's URL, whichever form the reply used. */
function linkUrl(reply: Reply): string | undefined {
	let url: string | undefined;
	visit(componentsOf(reply), (node) => {
		if (node.type === 2) url = node.url ?? url;
	});
	return url;
}

type Recorded = {
	/** Order in which the handler did things. */
	calls: string[];
	deferred: { flags?: number }[];
	replies: Reply[];
	cleared: string[];
	saved: { userId: string; scope?: string }[];
};

/**
 * Drives the real handler with a stub interaction and recording collaborators.
 * `editRejects` makes the first `editReply` throw, which is how a refused
 * Components V2 edit looks to the handler.
 */
async function run(
	options: {
		userId?: string;
		stored?: StoredUserToken | null;
		check?: UserTokenCheck;
		env?: NodeJS.ProcessEnv;
		editRejects?: boolean;
		getThrows?: boolean;
	} = {},
): Promise<Recorded> {
	const calls: string[] = [];
	const deferred: { flags?: number }[] = [];
	const replies: Reply[] = [];
	const cleared: string[] = [];
	const saved: { userId: string; scope?: string }[] = [];
	let edits = 0;

	const deps: AuthorizeDeps = {
		env: () => options.env ?? ENV,
		getToken: async () => {
			calls.push("getToken");
			if (options.getThrows) throw new Error("database is unreachable");
			return options.stored ?? null;
		},
		checkToken: async () => {
			calls.push("checkToken");
			return (
				options.check ?? {
					state: "valid",
					scopes: ["openid", "sdk.social_layer"],
					expiresAt: null,
				}
			);
		},
		clearToken: async (userId) => {
			calls.push("clearToken");
			cleared.push(userId);
		},
		saveToken: async (userId, token) => {
			calls.push("saveToken");
			saved.push({ userId, scope: token.scope });
		},
	};

	const interaction = {
		...(options.userId ? { member: { user: { id: options.userId } } } : {}),
		deferReply: async (payload: { flags?: number }) => {
			calls.push("deferReply");
			deferred.push(payload);
		},
		editReply: async (payload: unknown) => {
			calls.push("editReply");
			edits += 1;
			if (options.editRejects && edits === 1) {
				throw new Error("[DiscordRestClient] 400 Invalid Form Body");
			}
			replies.push(JSON.parse(JSON.stringify(payload)) as Reply);
		},
	};

	const handler = createAuthorizeHandler(deps) as unknown as (i: unknown) => Promise<unknown>;
	await withoutDatabase(() => handler(interaction));

	return { calls, deferred, replies, cleared, saved };
}

const storedReady: StoredUserToken = {
	accessToken: "user-token",
	refreshToken: "refresh",
	expiresAt: Date.now() + 60_000,
	scope: "openid sdk.social_layer",
};

test("it defers ephemerally before touching the database or Discord", async () => {
	const { calls, deferred } = await run({ userId: "1", stored: storedReady });
	assert.deepEqual(deferred, [{ flags: MessageFlags.Ephemeral }], "the deferral is ephemeral");
	assert.equal(
		calls[0],
		"deferReply",
		"a database round-trip before the deferral would miss Discord's 3 s deadline",
	);
	assert.ok(
		calls.indexOf("deferReply") < calls.indexOf("getToken"),
		"the stored token is read after the acknowledgement",
	);
});

test("the link carries openid sdk.social_layer and forces re-consent", async () => {
	const { replies } = await run({ userId: "1", stored: null });
	const url = linkUrl(replies[0]!);
	assert.ok(url, "the reply has a link button");
	const parsed = new URL(url);
	assert.equal(parsed.origin + parsed.pathname, "https://discord.com/oauth2/authorize");
	assert.equal(parsed.searchParams.get("client_id"), ENV.DISCORD_APPLICATION_ID);
	assert.equal(parsed.searchParams.get("response_type"), "code");
	assert.equal(
		parsed.searchParams.get("prompt"),
		"consent",
		"re-consent is what grants the added scope",
	);
	assert.deepEqual(
		(parsed.searchParams.get("scope") ?? "").split(" ").sort(),
		["openid", "sdk.social_layer"],
	);
	assert.equal(parsed.searchParams.get("redirect_uri"), ENV.DISCORD_REDIRECT_URI);
	assert.equal(replies[0]!.flags, MessageFlags.IsComponentsV2, "a deferred edit is V2 (never ephemeral)");
	assert.equal(replies[0]!.flags! & MessageFlags.Ephemeral, 0);
});

test("no stored connection is reported as such, not as connected", async () => {
	const { replies, calls } = await run({ userId: "1", stored: null });
	assert.match(allText(replies[0]!), /no connection stored yet/i);
	assert.equal(calls.includes("checkToken"), false, "nothing to check without a record");
	assert.equal(replies.length, 1);
});

test("a record Discord rejects with 401 is cleared and reported as revoked", async () => {
	const { replies, cleared, calls } = await run({
		userId: "42",
		stored: storedReady,
		check: { state: "revoked", reason: "Discord rejected the stored token (401)." },
	});

	assert.deepEqual(cleared, ["42"], "the dead record must be dropped");
	assert.equal(calls.includes("saveToken"), false);
	const text = allText(replies[0]!);
	assert.match(text, /revoked/i);
	assert.match(text, /record has been cleared/i);
	assert.match(text, /Re-authorize Discord/, "the button invites another attempt");
	assert.doesNotMatch(text, /connected as/, "a revoked record is not a connection");
});

test("a token Discord cannot check is kept, and said to be unconfirmed", async () => {
	const { replies, cleared } = await run({
		userId: "42",
		stored: storedReady,
		check: {
			state: "unknown",
			reason: "Discord did not answer `verify your connection` within 5s.",
		},
	});

	assert.deepEqual(cleared, [], "an unanswered check must not drop a working connection");
	const text = allText(replies[0]!);
	assert.match(text, /could not be confirmed/i);
	assert.match(text, /within 5s/);
});

test("Discord's granted scopes replace the stored ones", async () => {
	const { saved, replies } = await run({
		userId: "7",
		stored: { accessToken: "t", scope: "openid" },
		check: { state: "valid", scopes: ["openid", "sdk.social_layer"], expiresAt: null },
	});

	assert.deepEqual(saved, [{ userId: "7", scope: "openid sdk.social_layer" }]);
	assert.match(allText(replies[0]!), /connected as `openid sdk\.social_layer` \(confirmed by Discord\)/);
});

test("a connection without sdk.social_layer is told which scope is missing", async () => {
	const { replies } = await run({
		userId: "7",
		stored: { accessToken: "t", scope: "openid sdk.social_layer_presence" },
		check: { state: "valid", scopes: ["openid", "sdk.social_layer_presence"], expiresAt: null },
	});

	const text = allText(replies[0]!);
	assert.match(text, /`sdk\.social_layer` is missing/);
	assert.match(text, /Re-authorize below/);
});

test("without the OAuth environment it explains instead of offering a dead button", async () => {
	const { replies } = await run({ userId: "1", stored: null, env: {} });
	assert.equal(linkUrl(replies[0]!), undefined, "no button without a URL");
	assert.match(allText(replies[0]!), /DISCORD_CLIENT_SECRET/);
	assert.match(allText(replies[0]!), /No link to show/);
});

test("a refused V2 edit still delivers the link through the legacy form", async () => {
	const { replies } = await run({ userId: "1", stored: null, editRejects: true });
	assert.equal(replies.length, 1, "the refused edit produced no reply");
	assert.equal(replies[0]!.flags, undefined, "the fallback is the legacy form");
	assert.match(allText(replies[0]!), /Authorize Discord/);
	assert.ok(linkUrl(replies[0]!), "the fallback still carries the link");
});

test("a failure is reported instead of leaving the interaction unanswered", async () => {
	const { replies } = await run({ userId: "1", getThrows: true });
	assert.match(allText(replies[0]!), /Could not build the authorize link/);
	assert.match(allText(replies[0]!), /database is unreachable/);
});

test("the reply can be resolved without a Discord interaction", async () => {
	// `/api/diag?command=authorize` renders the command's reply this way, so the
	// recovery path is checkable in a deployment instead of by pressing it.
	const payloads = await resolveAuthorizeReply("", {
		env: () => ENV,
		getToken: async () => storedReady,
		checkToken: async () => ({
			state: "valid",
			scopes: ["openid", "sdk.social_layer"],
			expiresAt: null,
		}),
		clearToken: async () => undefined,
		saveToken: async () => undefined,
	});
	const serialized = JSON.parse(JSON.stringify(payloads.v2)) as Reply;
	assert.ok(linkUrl(serialized), "a link is offered even with no user id");
	assert.match(allText(serialized), /no connection stored yet/i);
});
