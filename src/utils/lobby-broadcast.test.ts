import assert from "node:assert/strict";
import test from "node:test";

import { DiscordRestApiError } from "./lobby-api.ts";
import {
	broadcastToLinkedChannels,
	describeBroadcastOutcomes,
	sendToLinkedChannels,
} from "./lobby-broadcast.ts";
import type { BroadcastDeps, SenderDeps } from "./lobby-broadcast.ts";
import type { LinkedChannelTarget } from "./webhook-events.ts";

/**
 * "Send a test message" has to reach *every* linked channel: Discord has no
 * broadcast primitive, so the value of this loop is entirely in it (a) covering
 * all of them, (b) not letting one bad channel mute the others, and (c) saying
 * which channel answered what — otherwise a link that quietly stopped working
 * looks like "the app only posts in one channel".
 */

const target = (channelId: string, guildId = `g-${channelId}`): LinkedChannelTarget => ({
	guildId,
	lobbyId: `lobby-${channelId}`,
	channelId,
});

test("every linked channel is posted into, with its own message id", async () => {
	const sent: { channelId: string; content: string; userToken: string }[] = [];
	const deps: BroadcastDeps = {
		targets: async () => [target("1525905982000070780"), target("1550970323917340694")],
		send: async (entry, content, userToken) => {
			sent.push({ channelId: entry.channelId, content, userToken });
			return { id: `${entry.channelId}-msg` };
		},
	};

	const outcomes = await broadcastToLinkedChannels("hello", "user-token", deps);

	assert.deepEqual(
		sent.map((entry) => entry.channelId),
		["1525905982000070780", "1550970323917340694"],
		"both servers receive it, not only the one the button was pressed in",
	);
	assert.ok(sent.every((entry) => entry.userToken === "user-token"));
	assert.ok(sent.every((entry) => entry.content === "hello"));
	assert.deepEqual(
		outcomes.map((outcome) => [outcome.channelId, outcome.ok, outcome.messageId]),
		[
			["1525905982000070780", true, "1525905982000070780-msg"],
			["1550970323917340694", true, "1550970323917340694-msg"],
		],
	);
});

test("one failing channel is reported without muting the others", async () => {
	const deps: BroadcastDeps = {
		targets: async () => [target("a"), target("b"), target("c")],
		send: async (entry) => {
			if (entry.channelId === "b") {
				throw new DiscordRestApiError(404, "POST", "/lobbies/lobby-b/messages", '{"message":"Unknown Lobby"}');
			}
			return { id: `${entry.channelId}-msg` };
		},
	};

	const outcomes = await broadcastToLinkedChannels("hello", "user-token", deps);

	assert.deepEqual(
		outcomes.map((outcome) => outcome.ok),
		[true, false, true],
		"a dead lobby in the middle must not stop the ones after it",
	);
	assert.equal(outcomes[1]?.status, 404, "the status is machine-readable");
	assert.match(outcomes[1]?.error ?? "", /Unknown Lobby/, "Discord's own reason is kept");
});

test("all channels are posted into concurrently, so one slow lobby cannot starve the rest", async () => {
	// In a sequential loop the second target is not even attempted until the
	// first returns, which with a 5s per-call timeout is how a broadcast runs out
	// of function timeout before it reaches the last server.
	let aPending = false;
	let bStartedWhileAWasPending = false;
	let releaseB: (() => void) | undefined;
	const bStarted = new Promise<void>((resolve) => {
		releaseB = resolve;
	});

	const deps: BroadcastDeps = {
		targets: async () => [target("a"), target("b")],
		send: async (entry) => {
			if (entry.channelId === "a") {
				aPending = true;
				// Bounded, so a sequential implementation fails an assertion
				// instead of hanging the suite.
				await Promise.race([bStarted, new Promise((resolve) => setTimeout(resolve, 500))]);
				aPending = false;
				return { id: "a-msg" };
			}
			bStartedWhileAWasPending = aPending;
			releaseB?.();
			return { id: "b-msg" };
		},
	};

	await broadcastToLinkedChannels("hello", "user-token", deps);

	assert.ok(bStartedWhileAWasPending, "the second channel is attempted while the first is still in flight");
});

// ------------------------------------------------- the web app's lobby-first sender

/** Records both paths and lets each one be made to fail per channel. */
function sender(overrides: Partial<SenderDeps> = {}) {
	const lobbies: { lobbyId: string; token: string }[] = [];
	const channels: string[] = [];
	const tokenAsked: string[] = [];
	const deps: SenderDeps = {
		targets: async () => [target("a"), target("b")],
		memberToken: async (guildId) => {
			tokenAsked.push(guildId);
			return { token: `token-${guildId}` };
		},
		sendLobby: async (lobbyId, _content, userToken) => {
			lobbies.push({ lobbyId, token: userToken });
			return { id: `lobby-msg-${lobbyId}` };
		},
		sendChannel: async (channelId) => {
			channels.push(channelId);
			return { id: `channel-msg-${channelId}` };
		},
		...overrides,
	};
	return { deps, lobbies, channels, tokenAsked };
}

test("the lobby takes the message when the server's own member is connected", async () => {
	const { deps, lobbies, channels, tokenAsked } = sender();

	const outcomes = await sendToLinkedChannels("from the web", deps);

	assert.deepEqual(
		lobbies.map((entry) => entry.lobbyId),
		["lobby-a", "lobby-b"],
		"each server's lobby is the path a game would use",
	);
	assert.deepEqual(
		lobbies.map((entry) => entry.token),
		["token-g-a", "token-g-b"],
		"the token belongs to the member of *that* server's lobby, not to one global user",
	);
	assert.deepEqual(tokenAsked, ["g-a", "g-b"]);
	assert.deepEqual(channels, [], "the bot is not used when the lobby worked");
	assert.deepEqual(
		outcomes.map((outcome) => [outcome.ok, outcome.delivery, outcome.messageId]),
		[
			[true, "lobby", "lobby-msg-lobby-a"],
			[true, "lobby", "lobby-msg-lobby-b"],
		],
	);
});

test("a member with no usable connection falls back to the bot, and says why", async () => {
	const { deps, lobbies, channels } = sender({
		memberToken: async () => ({ reason: "no stored Discord connection (`/authorize`)" }),
	});

	const outcomes = await sendToLinkedChannels("from the web", deps);

	assert.deepEqual(lobbies, [], "there is no member token to post with");
	assert.deepEqual(channels, ["a", "b"], "and the message still reaches every channel");
	assert.deepEqual(
		outcomes.map((outcome) => [outcome.delivery, outcome.lobbyFallback]),
		[
			["channel", "no stored Discord connection (`/authorize`)"],
			["channel", "no stored Discord connection (`/authorize`)"],
		],
		"the admin is told which path was taken and why",
	);
});

test("a lobby Discord has reaped falls back to the bot instead of losing the message", async () => {
	const { deps, channels } = sender({
		sendLobby: async () => {
			throw new DiscordRestApiError(404, "POST", "/lobbies/lobby-a/messages", '{"message":"Unknown Lobby"}');
		},
	});

	const outcomes = await sendToLinkedChannels("from the web", deps);

	assert.deepEqual(channels, ["a", "b"]);
	assert.equal(outcomes[0]?.delivery, "channel");
	assert.match(outcomes[0]?.lobbyFallback ?? "", /Unknown Lobby/);
	assert.equal(outcomes[0]?.ok, true, "a reaped lobby must not mean an undelivered message");
});

test("both paths failing is reported with the lobby's reason as well", async () => {
	const { deps } = sender({
		sendLobby: async () => {
			throw new DiscordRestApiError(403, "POST", "/lobbies/a/messages", '{"message":"Missing scope"}');
		},
		sendChannel: async () => {
			throw new DiscordRestApiError(403, "POST", "/channels/a/messages", '{"message":"Missing Permissions"}');
		},
	});

	const outcomes = await sendToLinkedChannels("from the web", deps);

	assert.equal(outcomes[0]?.ok, false);
	assert.equal(outcomes[0]?.status, 403);
	assert.match(outcomes[0]?.error ?? "", /Missing Permissions/, "the failure that decided it");
	assert.match(outcomes[0]?.lobbyFallback ?? "", /Missing scope/, "and the earlier one");
	assert.equal(outcomes[0]?.delivery, undefined, "nothing was delivered, so no path is claimed");
});

test("a token lookup that throws falls back rather than dropping the channel", async () => {
	const { deps, channels } = sender({
		memberToken: async () => {
			throw new Error("database is unreachable");
		},
	});

	const outcomes = await sendToLinkedChannels("from the web", deps);

	assert.deepEqual(channels, ["a", "b"]);
	assert.match(outcomes[0]?.lobbyFallback ?? "", /database is unreachable/);
	assert.equal(outcomes[0]?.ok, true);
});

test("one channel's trouble does not decide the others'", async () => {
	const { deps, channels } = sender({
		targets: async () => [target("a"), target("b"), target("c")],
		sendLobby: async (lobbyId) => {
			if (lobbyId === "lobby-b") throw new DiscordRestApiError(404, "POST", "/lobbies/b", "{}");
			return { id: `lobby-msg-${lobbyId}` };
		},
		sendChannel: async (channelId) => {
			if (channelId === "b") throw new DiscordRestApiError(403, "POST", "/channels/b", "{}");
			channels.push(channelId);
			return { id: `channel-msg-${channelId}` };
		},
	});

	const outcomes = await sendToLinkedChannels("from the web", deps);

	assert.deepEqual(
		outcomes.map((outcome) => [outcome.channelId, outcome.ok, outcome.delivery]),
		[
			["a", true, "lobby"],
			["b", false, undefined],
			["c", true, "lobby"],
		],
		"the channels after a failing one are still delivered",
	);
	assert.match(outcomes[1]?.error ?? "", /403/);
});

test("nothing linked yet is explained rather than reported as a failure", async () => {
	const outcomes = await broadcastToLinkedChannels("hello", "user-token", {
		targets: async () => [],
		send: async () => {
			throw new Error("must not be called");
		},
	});

	assert.deepEqual(outcomes, []);
	const reply = describeBroadcastOutcomes(outcomes);
	assert.match(reply, /No channel is linked yet/);
	assert.doesNotMatch(reply, /❌/, "an empty link list is information, not an error");
});

test("the reply names each channel and explains a partial result", () => {
	const partial = describeBroadcastOutcomes([
		{ guildId: "g1", lobbyId: "l1", channelId: "111", ok: true, messageId: "m1" },
		{
			guildId: "g2",
			lobbyId: "l2",
			channelId: "222",
			ok: false,
			error: "404 — Unknown Lobby",
			status: 404,
		},
	]);

	assert.match(partial, /Sent into 1 of 2 linked channels/, "the count is the point of the reply");
	assert.match(partial, /<#111> — message `m1`/);
	assert.match(partial, /<#222> — ❌ 404 — Unknown Lobby/, "the channel that failed is named");
	assert.match(partial, /went idle/, "and what to do about a reaped lobby");
	assert.doesNotMatch(partial, /not a member/, "advice for a failure that did not happen is noise");
	assert.doesNotMatch(partial, /Reconnect Discord/, "nor is the hint for a revoked connection");

	const complete = describeBroadcastOutcomes([
		{ guildId: "g1", lobbyId: "l1", channelId: "111", ok: true, messageId: "m1" },
	]);
	assert.match(complete, /Sent into all 1 linked channel\./);
	assert.doesNotMatch(complete, /did not receive it/);

	const notMember = describeBroadcastOutcomes([
		{ guildId: "g1", lobbyId: "l1", channelId: "111", ok: false, error: "403 — Forbidden", status: 403 },
	]);
	assert.match(notMember, /not a member of that server's lobby/);
	assert.doesNotMatch(notMember, /went idle/, "only the failures that happened are explained");

	const revoked = describeBroadcastOutcomes([
		{ guildId: "g1", lobbyId: "l1", channelId: "111", ok: false, error: "401 — Unauthorized", status: 401 },
	]);
	assert.match(revoked, /Reconnect Discord/);
});
