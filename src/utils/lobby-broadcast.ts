/**
 * Sending one message to **every** linked channel.
 *
 * Discord has no broadcast primitive: an application that maintains a linked
 * channel in several servers can only reach all of them by finding each one and
 * posting into it. There is no webhook event, gateway subscription or "Event" in
 * the Developer Portal that grants one — the loop is the mechanism, and this
 * module is that loop, shared by everything that wants to speak to all links.
 *
 * Targets come from `linkedChannelTargets`, which discovers servers from Discord
 * and reads each one's channel — falling back to the channel remembered on the
 * guild's record, so a lobby Discord has already reaped still gets a target.
 *
 * Two senders, because *who is speaking* changes which call is correct:
 *
 * - {@link sendToLinkedChannels} — the web app. **Lobby first**: post into each
 *   server's lobby with the OAuth2 token of a member of *that* lobby, which is
 *   the call a Social SDK game makes and the reason a player's message and a web
 *   visitor's message look the same in-game. When that is not possible — the
 *   member never authorized, the scope was not granted, or the lobby went idle —
 *   the message is posted into the channel by the **bot** instead, and the
 *   outcome says which path was used. A lobby is a session object and a channel
 *   is not, so this is the difference between "delivered while a game session is
 *   live" and "delivered, always".
 * - {@link broadcastToLinkedChannels} — the panel's test button. Posts into every
 *   lobby with **your** token, one attempt, results reported. It is deliberately
 *   not the sender above: pressing it is how an admin checks that *their* own
 *   connection works, so a fallback would hide exactly what it tests.
 *
 * All of them run their sends concurrently (`Promise.allSettled`), so one slow or
 * unreachable channel cannot eat the whole function timeout, and one failure
 * cannot mute the channels after it. Each channel's own outcome is returned,
 * because "did every channel get it?" is the only question that matters here.
 */

import {
	describeLobbyError,
	DiscordRestApiError,
	sendChannelMessage,
	sendLobbyMessage,
} from "./lobby-api.ts";
import { getLobbyRecord } from "./lobby-store.ts";
import { getFreshUserToken } from "./lobby-tokens.ts";
import { hasSocialLayerScope } from "./lobby-oauth.ts";
import type { LinkedChannelTarget } from "./webhook-events.ts";
import { linkedChannelTargets } from "./webhook-events.ts";

/** What one channel's attempt did. */
type Attempt = {
	ok: boolean;
	/** Present when the message landed (the lobby message id). */
	messageId?: string;
	/** Present when it did not — Discord's own reason. */
	error?: string;
	/** Discord's HTTP status when it answered with an error (401 ⇒ token dead). */
	status?: number;
};

/** An {@link Attempt} with the channel it belongs to. */
type TargetOutcome = Attempt & {
	guildId: string;
	lobbyId: string;
	channelId: string;
};

export type BroadcastOutcome = TargetOutcome;

/** Which call delivered a message. */
export type Delivery = "lobby" | "channel";

/** One channel's result from {@link sendToLinkedChannels}. */
export type DeliveryOutcome = {
	guildId: string;
	lobbyId: string;
	channelId: string;
	ok: boolean;
	/** Which path delivered it. Absent only when nothing did. */
	delivery?: Delivery;
	messageId?: string;
	/**
	 * Why the lobby path was not used, when it wasn't — Discord's own reason or
	 * the missing connection. Present even on success, because "it arrived, but
	 * via the bot" is the difference between a live game session and none.
	 */
	lobbyFallback?: string;
	/** Discord's reason on the path that failed last (only when `ok` is false). */
	error?: string;
	status?: number;
};

/** The token to post through a server's lobby with, or why there is none. */
export type MemberToken = { token: string } | { reason: string };

/** Collaborators of {@link broadcastToLinkedChannels}, injectable for tests. */
export type BroadcastDeps = {
	targets: () => Promise<LinkedChannelTarget[]>;
	send: (
		target: LinkedChannelTarget,
		content: string,
		userToken: string,
	) => Promise<{ id: string }>;
};

/** Collaborators of {@link sendToLinkedChannels}, injectable for tests. */
export type SenderDeps = {
	targets: () => Promise<LinkedChannelTarget[]>;
	/** The OAuth2 token of a member of *that server's* lobby, or why not. */
	memberToken: (guildId: string) => Promise<MemberToken>;
	sendLobby: (lobbyId: string, content: string, userToken: string) => Promise<{ id: string }>;
	sendChannel: (channelId: string, content: string) => Promise<{ id: string }>;
};

const defaultDeps: BroadcastDeps = {
	targets: () => linkedChannelTargets(),
	send: (target, content, userToken) => sendLobbyMessage(target.lobbyId, content, userToken),
};

/**
 * The stored connection of the member who linked *this* server's lobby.
 *
 * A lobby message is only accepted from a member of that lobby, so the token has
 * to come from the server's own record (`creatorId`) rather than from whoever is
 * using the app — one person's token cannot post into another server's lobby.
 */
async function lobbyMemberToken(guildId: string): Promise<MemberToken> {
	const record = await getLobbyRecord(guildId);
	if (!record) return { reason: "this server has no stored lobby" };

	const token = await getFreshUserToken(record.creatorId);
	if (!token) {
		return {
			reason: "the member who linked this server has no stored Discord connection (`/authorize`)",
		};
	}
	if (!hasSocialLayerScope(token.scope)) {
		return {
			reason: `the stored connection is missing \`openid sdk.social_layer\` (scopes: ${token.scope ?? "none"})`,
		};
	}
	return { token: token.accessToken };
}

const defaultSenderDeps: SenderDeps = {
	targets: () => linkedChannelTargets(),
	memberToken: lobbyMemberToken,
	sendLobby: (lobbyId, content, userToken) => sendLobbyMessage(lobbyId, content, userToken),
	sendChannel: (channelId, content) => sendChannelMessage(channelId, content),
};

/** Posts into one server's lobby, else the bot posts into its channel. */
async function deliverOne(
	target: LinkedChannelTarget,
	content: string,
	deps: SenderDeps,
): Promise<DeliveryOutcome> {
	const base = { guildId: target.guildId, lobbyId: target.lobbyId, channelId: target.channelId };

	// A token lookup that fails (a database blip) falls back rather than
	// dropping the channel: the message still has somewhere to go.
	const member = await deps.memberToken(target.guildId).catch(
		(error): MemberToken => ({ reason: describeLobbyError(error) }),
	);

	let lobbyFallback: string;
	if ("token" in member) {
		try {
			const message = await deps.sendLobby(target.lobbyId, content, member.token);
			return { ...base, ok: true, delivery: "lobby", messageId: message.id };
		} catch (error) {
			lobbyFallback = describeLobbyError(error);
		}
	} else {
		lobbyFallback = member.reason;
	}

	try {
		const message = await deps.sendChannel(target.channelId, content);
		return { ...base, ok: true, delivery: "channel", messageId: message.id, lobbyFallback };
	} catch (error) {
		return {
			...base,
			ok: false,
			lobbyFallback,
			error: describeLobbyError(error),
			...(error instanceof DiscordRestApiError ? { status: error.status } : {}),
		};
	}
}

/**
 * Posts `content` into every linked channel: through each server's lobby when
 * its member's stored connection allows it, else into the channel as the bot.
 *
 * Never throws for a per-channel failure and never retries. A channel where both
 * paths failed is reported with the reason for each, so nothing is lost silently
 * and nothing pretends to have been delivered.
 */
export async function sendToLinkedChannels(
	content: string,
	deps: SenderDeps = defaultSenderDeps,
): Promise<DeliveryOutcome[]> {
	const targets = await deps.targets();
	return await Promise.all(targets.map((target) => deliverOne(target, content, deps)));
}

/**
 * Runs one send per target, concurrently, and reports each channel's own result.
 *
 * Never throws for a per-channel failure and never retries: Discord's answer for
 * one channel is recorded against that channel and the rest still go out.
 */
async function attemptEvery(
	targets: LinkedChannelTarget[],
	run: (target: LinkedChannelTarget) => Promise<{ id: string }>,
): Promise<TargetOutcome[]> {
	const settled = await Promise.allSettled(targets.map((target) => run(target)));

	return settled.map((result, index) => {
		const target = targets[index];
		const base = {
			guildId: target.guildId,
			lobbyId: target.lobbyId,
			channelId: target.channelId,
		};
		if (result.status === "fulfilled") return { ...base, ok: true, messageId: result.value.id };
		const reason = result.reason;
		return {
			...base,
			ok: false,
			error: describeLobbyError(reason),
			...(reason instanceof DiscordRestApiError ? { status: reason.status } : {}),
		};
	});
}

/**
 * Posts `content` into every linked channel as the given **user**, through each
 * lobby (`POST /lobbies/{id}/messages`) — the call a Social SDK game makes.
 *
 * Requires that user's OAuth2 token (`openid sdk.social_layer`) and membership of
 * every lobby, so a server where somebody else created the lobby reports a
 * refusal instead of a message. It is still the honest check: a lobby with no
 * linked channel is refused by Discord.
 */
export async function broadcastToLinkedChannels(
	content: string,
	userToken: string,
	deps: BroadcastDeps = defaultDeps,
): Promise<BroadcastOutcome[]> {
	return attemptEvery(await deps.targets(), (target) =>
		deps.send(target, content, userToken),
	);
}

/**
 * The reply body for a user-token broadcast, one line per channel.
 *
 * Pure so the wording is unit tested: this is how the admin finds out *which*
 * server is not receiving, which is the whole point of broadcasting.
 */
export function describeBroadcastOutcomes(outcomes: BroadcastOutcome[]): string {
	if (outcomes.length === 0) {
		return "ℹ️ **No channel is linked yet.** Link one first (**Link a channel**), then this button posts into every linked channel this app maintains.";
	}

	const sent = outcomes.filter((outcome) => outcome.ok).length;
	const lines = [
		sent === outcomes.length
			? `✅ **Sent into all ${outcomes.length} linked channel${outcomes.length === 1 ? "" : "s"}.**`
			: `⚠️ **Sent into ${sent} of ${outcomes.length} linked channels.**`,
		"",
		...outcomes.map((outcome) =>
			outcome.ok
				? `• <#${outcome.channelId}> — message \`${outcome.messageId ?? "?"}\``
				: `• <#${outcome.channelId}> — ❌ ${outcome.error ?? "failed"}`,
		),
	];

	const failed = outcomes.filter((outcome) => !outcome.ok);
	if (failed.length > 0) {
		const statuses = new Set(failed.map((outcome) => outcome.status));
		const hints: string[] = [];
		if (statuses.has(404)) {
			hints.push(
				"**404** (\"unknown lobby\") means that server's lobby went idle — lobbies are re-created when needed, so run **Link a channel** there again.",
			);
		}
		if (statuses.has(403)) {
			hints.push(
				"**403** usually means you are not a member of that server's lobby (the admin who linked it is), or the bot lacks **Send Messages** in the channel.",
			);
		}
		if (statuses.has(401)) {
			hints.push(
				"**401** means Discord no longer accepts your connection — use **Reconnect Discord** on this panel.",
			);
		}
		if (hints.length === 0) hints.push("Discord's reason for each channel is above.");
		lines.push(
			"",
			`${failed.length} channel${failed.length === 1 ? "" : "s"} did not receive it. ${hints.join(" ")}`,
		);
	}

	return lines.join("\n");
}
