import assert from "node:assert/strict";
import test from "node:test";

import type { BroadcastOutcome } from "./lobby-broadcast.ts";
import {
	ECHO_NEEDS_CONNECTION,
	ECHO_NEEDS_SCOPE,
	ECHO_OPTION,
	ECHO_SCOPE_NOTE,
	MAX_ECHO_LENGTH,
	checkEchoText,
	createEchoHandler,
	describeEchoQuotaRefusal,
	describeEchoReply,
} from "./echo-command.ts";
import type { EchoDeps } from "./echo-command.ts";
import { REVOKED_CONNECTION_HINT } from "./lobby-oauth.ts";
import type { StoredUserToken } from "./lobby-tokens.ts";

/**
 * `/echo` posts through **the member's own connection** (`POST
 * /lobbies/{id}/messages`), which is what makes the text a lobby message — the
 * call a game reads — instead of the app's bot speaking in a channel.
 *
 * The things worth pinning are the ones that fail silently or expensively:
 *
 * - the member's **user** token is what goes out, never the bot's;
 * - a connection without `sdk.social_layer` is caught *before* the call and
 *   explained, because Discord answers that with a 403 that reads like a
 *   permissions problem in the server;
 * - a refusal is reported once and **not retried** — while the app is unapproved
 *   channel linking is capped at 20 calls per 2 hours per application, so a retry
 *   loop turns one failure into an outage;
 * - every path replies, because the interaction is deferred first.
 */

type Reply = { content?: string; flags?: number };

/** The handler is typed against the library's interaction, which a stub cannot satisfy structurally. */
const asHandler = (deps: EchoDeps) =>
	createEchoHandler(deps) as unknown as (i: unknown) => Promise<unknown>;

function stubInteraction(overrides: Record<string, unknown> = {}) {
	const replies: Reply[] = [];
	const interaction = {
		guild_id: "1525905980422885406",
		member: { user: { id: "285118390031351809" } },
		options: { getString: () => "merhaba dünya" },
		deferReply: async () => {
			replies.push({ content: "(deferred)" });
		},
		editReply: async (payload: Reply) => {
			replies.push(payload);
		},
		...overrides,
	};
	return { interaction, replies, content: () => replies[replies.length - 1]?.content ?? "" };
}

const outcome = (over: Partial<BroadcastOutcome> = {}): BroadcastOutcome => ({
	guildId: "1",
	lobbyId: "l",
	channelId: "1525905982000070780",
	ok: true,
	messageId: "m",
	...over,
});

const token = (scope: string): StoredUserToken => ({ accessToken: "user-token", scope });

function deps(overrides: Partial<EchoDeps> = {}): EchoDeps {
	return {
		hasDatabase: () => true,
		quota: async () => ({ allowed: true, remaining: 4, retryAfterSeconds: 0, enforced: true }),
		getToken: async () => token("identify sdk.social_layer"),
		clearToken: async () => {},
		broadcast: async () => [outcome()],
		...overrides,
	};
}

test("the text is taken as written, and an empty one is refused", () => {
	assert.deepEqual(checkEchoText("  merhaba  "), { ok: true, text: "merhaba" });
	assert.deepEqual(checkEchoText("a\r\nb"), { ok: true, text: "a\nb" });

	for (const empty of ["", "   ", "\n", undefined, 7, null]) {
		const checked = checkEchoText(empty);
		assert.equal(checked.ok, false);
		if (!checked.ok) assert.match(checked.error, new RegExp(ECHO_OPTION));
	}

	const long = checkEchoText("x".repeat(MAX_ECHO_LENGTH + 1));
	assert.equal(long.ok, false, "Discord's own limit is enforced here, not discovered there");
});

test("the reply is a plain confirmation, and failures name the channel", () => {
	const reply = describeEchoReply([
		outcome(),
		outcome({ channelId: "1551113286156812292", ok: false, error: "403 — Missing Permissions", status: 403 }),
	]);

	assert.match(reply, /Posted to 1 of 2 linked channels/);
	assert.match(reply, /• <#1551113286156812292> — 403 — Missing Permissions/);
	assert.doesNotMatch(reply, /`\d+`/, "no Discord message ids — that is debug output, not a reply");
});

test("a full delivery is one short line", () => {
	assert.equal(describeEchoReply([outcome()]), "🔊 Posted to 1 linked channel.");
	assert.equal(
		describeEchoReply([outcome(), outcome({ channelId: "2" }), outcome({ channelId: "3" })]),
		"🔊 Posted to all 3 linked channels.",
	);
});

test("nothing linked is explained rather than reported as a failure", () => {
	const reply = describeEchoReply([]);
	assert.match(reply, /No channel is linked yet/);
	assert.match(reply, /\/linked-channel/);
});

test("the quota refusal says how long to wait", () => {
	const reply = describeEchoQuotaRefusal({
		allowed: false,
		remaining: 0,
		retryAfterSeconds: 42,
		enforced: true,
	});
	assert.match(reply, /42s/);
});

test("the member's own token is what goes out, and the work starts after the deferral", async () => {
	const order: string[] = [];
	const { interaction, replies, content } = stubInteraction();
	const seen: { text?: string; token?: string } = {};
	const handler = asHandler(
		deps({
			hasDatabase: () => {
				order.push("database");
				return true;
			},
			quota: async () => {
				order.push("quota");
				return { allowed: true, remaining: 4, retryAfterSeconds: 0, enforced: true };
			},
			getToken: async () => {
				order.push("token");
				return token("identify sdk.social_layer");
			},
			broadcast: async (text, userToken) => {
				order.push("broadcast");
				seen.text = text;
				seen.token = userToken;
				return [outcome()];
			},
		}),
	);
	interaction.deferReply = async () => {
		order.push("defer");
	};

	await handler(interaction);

	assert.equal(order[0], "defer", "the acknowledgement comes first");
	assert.deepEqual(order.slice(1), ["database", "quota", "token", "broadcast"]);
	assert.equal(seen.text, "merhaba dünya");
	assert.equal(seen.token, "user-token", "a lobby message is posted as the member, not as the bot");
	assert.equal(replies.length, 1, "one reply replaces the deferral");
	assert.match(content(), /Posted to 1 linked channel/);
	assert.doesNotMatch(content(), /thinking/i);
});

test("outside a server the command refuses rather than posting nowhere", async () => {
	const { interaction, content } = stubInteraction({ guild_id: undefined, member: undefined });
	let broadcasted = 0;
	const handler = asHandler(
		deps({
			broadcast: async () => {
				broadcasted += 1;
				return [];
			},
		}),
	);

	await handler(interaction);

	assert.equal(broadcasted, 0);
	assert.match(content(), /only works inside a server/);
});

test("no stored connection asks for /authorize instead of calling Discord", async () => {
	const { interaction, content } = stubInteraction();
	let broadcasted = 0;
	const handler = asHandler(
		deps({
			getToken: async () => null,
			broadcast: async () => {
				broadcasted += 1;
				return [];
			},
		}),
	);

	await handler(interaction);

	assert.equal(broadcasted, 0, "the call would have been a 401 and a wasted lobby call");
	assert.equal(content(), ECHO_NEEDS_CONNECTION);
	assert.match(content(), /\/authorize/);
});

test("a connection without sdk.social_layer is explained, not sent off to fail with a 403", async () => {
	const { interaction, content } = stubInteraction();
	let broadcasted = 0;
	// The exact scope set this app's own OAuth flow requests today — enough for
	// `/authorize` and role connections, not enough for a lobby message.
	const handler = asHandler(
		deps({
			getToken: async () => token("applications.commands identify guilds role_connections.write"),
			broadcast: async () => {
				broadcasted += 1;
				return [];
			},
		}),
	);

	await handler(interaction);

	assert.equal(broadcasted, 0);
	assert.equal(content(), ECHO_NEEDS_SCOPE);
	assert.match(content(), /sdk\.social_layer/);
	assert.match(content(), /\/authorize/, "the way out is a reconnect, not a retry");
	assert.match(ECHO_SCOPE_NOTE, /limited access/, "and the text says why that scope is special");
	assert.match(ECHO_SCOPE_NOTE, /Social SDK access request/);
});

test("a failing broadcast is reported once, never retried", async () => {
	const { interaction, content } = stubInteraction();
	let calls = 0;
	const handler = asHandler(
		deps({
			broadcast: async () => {
				calls += 1;
				throw new Error("Discord answered 429 (rate limited)");
			},
		}),
	);

	await handler(interaction);

	assert.equal(calls, 1, "one attempt: channel linking is capped per application, so a retry loop is the outage");
	assert.match(content(), /Could not post your message/);
	assert.match(content(), /429/);
});

test("a channel that refuses is named with Discord's reason, and the others still went out", async () => {
	const { interaction, content } = stubInteraction();
	const handler = asHandler(
		deps({
			broadcast: async () => [
				outcome(),
				outcome({ channelId: "1551113286156812292", ok: false, error: "404 — Unknown Lobby", status: 404 }),
			],
		}),
	);

	await handler(interaction);

	assert.match(content(), /Posted to 1 of 2 linked channels/);
	assert.match(content(), /<#1551113286156812292>/);
	assert.match(content(), /404/);
});

test("every lobby rejecting the token means the connection was revoked — it is cleared and said so", async () => {
	const { interaction, content } = stubInteraction();
	let cleared = 0;
	const handler = asHandler(
		deps({
			broadcast: async () => [
				outcome({ ok: false, error: "401 — Unauthorized", status: 401 }),
				outcome({ channelId: "2", ok: false, error: "401 — Unauthorized", status: 401 }),
			],
			clearToken: async () => {
				cleared += 1;
			},
		}),
	);

	await handler(interaction);

	assert.equal(cleared, 1, "a dead token is dropped, so nothing keeps claiming a connection");
	assert.equal(content(), REVOKED_CONNECTION_HINT);
});

test("one 401 among successes does not clear a working connection", async () => {
	const { interaction, content } = stubInteraction();
	let cleared = 0;
	const handler = asHandler(
		deps({
			broadcast: async () => [
				outcome(),
				outcome({ channelId: "2", ok: false, error: "401 — Unauthorized", status: 401 }),
			],
			clearToken: async () => {
				cleared += 1;
			},
		}),
	);

	await handler(interaction);

	assert.equal(cleared, 0);
	assert.match(content(), /Posted to 1 of 2 linked channels/);
});

test("a refused quota stops before the token is even read", async () => {
	const { interaction, content } = stubInteraction();
	let spread = 0;
	const handler = asHandler(
		deps({
			quota: async () => ({ allowed: false, remaining: 0, retryAfterSeconds: 37, enforced: true }),
			broadcast: async () => {
				spread += 1;
				return [];
			},
		}),
	);

	await handler(interaction);

	assert.equal(spread, 0);
	assert.match(content(), /37s/);
});

test("an unreadable quota does not take the command down with it", async () => {
	const { interaction, content } = stubInteraction();
	const handler = asHandler(
		deps({
			quota: async () => {
				throw new Error("quota store down");
			},
		}),
	);

	await handler(interaction);

	assert.match(content(), /Posted to 1 linked channel/, "the member asked for their text to be posted");
});

test("a deployment without a database says so instead of reporting no channels", async () => {
	const { interaction, content } = stubInteraction();
	let broadcasted = 0;
	const handler = asHandler(
		deps({
			hasDatabase: () => false,
			broadcast: async () => {
				broadcasted += 1;
				return [];
			},
		}),
	);

	await handler(interaction);

	assert.equal(broadcasted, 0);
	assert.match(content(), /MONGODB_URI/);
});

test("an empty option is refused before any quota or connection work", async () => {
	const { interaction, content } = stubInteraction({
		options: { getString: () => "   " },
	});
	let spread = 0;
	const handler = asHandler(
		deps({
			broadcast: async () => {
				spread += 1;
				return [];
			},
		}),
	);

	await handler(interaction);

	assert.equal(spread, 0);
	assert.match(content(), new RegExp(ECHO_OPTION));
});

test("an unreadable stored connection is reported, not swallowed", async () => {
	const { interaction, content } = stubInteraction();
	let broadcasted = 0;
	const handler = asHandler(
		deps({
			getToken: async () => {
				throw new Error("MongoNetworkError");
			},
			broadcast: async () => {
				broadcasted += 1;
				return [];
			},
		}),
	);

	await handler(interaction);

	assert.equal(broadcasted, 0);
	assert.match(content(), /Could not read your Discord connection/);
	assert.match(content(), /MongoNetworkError/);
});
