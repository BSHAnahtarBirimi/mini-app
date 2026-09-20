import assert from "node:assert/strict";
import test from "node:test";

import type { DeliveryOutcome } from "./lobby-broadcast.ts";
import {
	MAX_MESAJ_LENGTH,
	MESAJ_OPTION,
	checkMesajText,
	createMesajHandler,
	describeMesajReply,
} from "./mesaj-command.ts";
import type { MesajDeps } from "./mesaj-command.ts";

/**
 * `/mesaj` posts into **every** linked channel the app maintains, so the three
 * things worth pinning are: the text is exactly what the member typed, the reply
 * names each channel's own outcome (the only way a partial delivery is ever
 * noticed), and the interaction is acknowledged before any of that work starts —
 * a handler that answers late leaves the client on "«bot» is thinking…".
 */

type Reply = { content?: string; flags?: number };

/**
 * The handler is typed against the library's interaction, which a stub cannot
 * satisfy structurally; `authorize-command.test.ts` narrows it the same way.
 */
const asHandler = (deps: MesajDeps) =>
	createMesajHandler(deps) as unknown as (i: unknown) => Promise<unknown>;

/** A stubbed interaction that records the deferral and every reply. */
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

const outcome = (over: Partial<DeliveryOutcome>): DeliveryOutcome => ({
	guildId: "1",
	lobbyId: "l",
	channelId: "1525905982000070780",
	ok: true,
	delivery: "lobby",
	messageId: "m",
	...over,
});

function deps(overrides: Partial<MesajDeps> = {}): MesajDeps {
	return {
		hasDatabase: () => true,
		quota: async () => ({ allowed: true, remaining: 4, retryAfterSeconds: 0, enforced: true }),
		broadcast: async () => [outcome({})],
		...overrides,
	};
}

test("the text is taken as written, and an empty one is refused", () => {
	assert.deepEqual(checkMesajText("  merhaba  "), { ok: true, text: "merhaba" });
	assert.deepEqual(checkMesajText("a\r\nb"), { ok: true, text: "a\nb" });

	for (const empty of ["", "   ", "\n", undefined, 7, null]) {
		const checked = checkMesajText(empty);
		assert.equal(checked.ok, false);
		if (!checked.ok) assert.match(checked.error, new RegExp(MESAJ_OPTION));
	}

	const long = checkMesajText("x".repeat(MAX_MESAJ_LENGTH + 1));
	assert.equal(long.ok, false, "Discord's own limit is enforced here, not discovered there");
});

test("the reply counts the channels and names each outcome", () => {
	const reply = describeMesajReply([
		outcome({}),
		outcome({ channelId: "1550970323917340694", delivery: "channel", lobbyFallback: "no stored connection" }),
	]);

	assert.match(reply, /Sent to all 2 linked channels/);
	assert.match(reply, /• <#1525905982000070780> — via the game lobby/);
	assert.match(
		reply,
		/• <#1550970323917340694> — via the bot \(no stored connection\)/,
		"the bot path carries the reason, so it does not read as a lobby delivery",
	);
});

test("a partial delivery is reported as such, with a hint for the failure", () => {
	const reply = describeMesajReply([
		outcome({}),
		outcome({
			channelId: "2",
			ok: false,
			delivery: undefined,
			messageId: undefined,
			error: "404 — Unknown Lobby",
			status: 404,
		}),
	]);

	assert.match(reply, /Sent to 1 of 2 linked channels/);
	assert.match(reply, /❌ 404 — Unknown Lobby/);
	assert.match(reply, /404.*lobby went idle/, "and says what to do about it");
});

test("nothing linked is explained rather than reported as a failure", () => {
	const reply = describeMesajReply([]);
	assert.match(reply, /No channel is linked yet/);
	assert.match(reply, /\/linked-channel/);
});

test("the command acknowledges before doing the work, then replies with the result", async () => {
	const order: string[] = [];
	const { interaction, replies, content } = stubInteraction();
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
			broadcast: async (text) => {
				order.push(`broadcast:${text}`);
				return [outcome({})];
			},
		}),
	);
	interaction.deferReply = async () => {
		order.push("defer");
	};

	await handler(interaction);

	assert.equal(order[0], "defer", "the acknowledgement comes first");
	assert.deepEqual(order.slice(1), ["database", "quota", "broadcast:merhaba dünya"]);
	assert.equal(replies.length, 1, "one reply replaces the deferral");
	assert.match(content(), /Sent to all 1 linked channel/);
});

test("a refused quota stops before anything is posted", async () => {
	let broadcasted = 0;
	const { interaction, content } = stubInteraction();
	const handler = asHandler(
		deps({
			quota: async () => ({ allowed: false, remaining: 0, retryAfterSeconds: 37, enforced: true }),
			broadcast: async () => {
				broadcasted += 1;
				return [];
			},
		}),
	);

	await handler(interaction);

	assert.equal(broadcasted, 0);
	assert.match(content(), /37s/);
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

test("a failing broadcast is answered, never left on «bot» is thinking…", async () => {
	const { interaction, content } = stubInteraction();
	const handler = asHandler(
		deps({
			broadcast: async () => {
				throw new Error("MongoNetworkError");
			},
		}),
	);

	await handler(interaction);
	assert.match(content(), /Could not send the message/);
	assert.match(content(), /MongoNetworkError/);
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
	assert.match(content(), /Sent to all 1 linked channel/, "the member asked for a broadcast, and gets one");
});

test("outside a server the command refuses rather than posting nowhere", async () => {
	const { interaction, content } = stubInteraction({ guild_id: undefined, member: undefined });
	const handler = asHandler(deps());

	await handler(interaction);
	assert.match(content(), /only works inside a server/);
});
