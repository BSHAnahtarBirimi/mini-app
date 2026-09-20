/**
 * Sending one message to **every** linked channel.
 *
 * Discord has no broadcast primitive: an application that maintains a linked
 * channel in several servers can only reach all of them by finding each one and
 * posting into it. There is no webhook event, gateway subscription or "Event" in
 * the Developer Portal that grants one — the loop is the mechanism, and this
 * module is that loop, shared by everything that wants to speak to all links.
 *
 * Targets come from `linkedChannelTargets` (the same definition the
 * `APPLICATION_DEAUTHORIZED` notice uses), which discovers servers from Discord
 * and reads each one's channel — falling back to the channel remembered on the
 * guild's record, so a lobby Discord has already reaped still gets a target.
 *
 * Two properties matter, for both senders below:
 *
 * - **The sends run concurrently** (`Promise.allSettled`), so one slow or
 *   unreachable channel cannot eat the whole function timeout, and one failure
 *   cannot mute the channels after it. The caller gets a per-channel outcome and
 *   reports it — that is the answer to "did every channel get it?".
 * - **Who is speaking decides the call.** `broadcastToLinkedChannelsAsBot` posts
 *   with the **bot** token straight into each channel: anyone's message, no
 *   Discord account needed, and no lobby has to be alive. That is what the web
 *   app uses. `broadcastToLinkedChannels` posts *into the lobby* with a user's
 *   OAuth2 token (`openid sdk.social_layer`), which is the call a game makes —
 *   the panel's test button uses that one so it exercises the game's own path.
 */

import {
	describeLobbyError,
	DiscordRestApiError,
	sendChannelMessage,
	sendLobbyMessage,
} from "./lobby-api.ts";
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

/** A bot-token broadcast carries no lobby: the channel is all it needs. */
export type ChannelBroadcastOutcome = Omit<TargetOutcome, "lobbyId">;

/** Collaborators of {@link broadcastToLinkedChannels}, injectable for tests. */
export type BroadcastDeps = {
	targets: () => Promise<LinkedChannelTarget[]>;
	send: (
		target: LinkedChannelTarget,
		content: string,
		userToken: string,
	) => Promise<{ id: string }>;
};

/** Collaborators of {@link broadcastToLinkedChannelsAsBot}, injectable for tests. */
export type ChannelBroadcastDeps = {
	targets: () => Promise<LinkedChannelTarget[]>;
	send: (channelId: string, content: string) => Promise<{ id: string }>;
};

const defaultDeps: BroadcastDeps = {
	targets: () => linkedChannelTargets(),
	send: (target, content, userToken) => sendLobbyMessage(target.lobbyId, content, userToken),
};

const defaultChannelDeps: ChannelBroadcastDeps = {
	targets: () => linkedChannelTargets(),
	send: (channelId, content) => sendChannelMessage(channelId, content),
};

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
 * Posts `content` into every linked channel this app maintains, as **the bot**.
 *
 * This is the sender for anything that is not a game session: it needs no user
 * token, no lobby membership and no live lobby, so a message typed in a browser
 * (see `api/message.ts`) reaches every linked channel — including servers whose
 * lobby Discord has since reaped. The trade-off is that the message is posted by
 * the bot, and `sendChannelMessage` disables mention parsing so text written by
 * a third party cannot ping a server.
 */
export async function broadcastToLinkedChannelsAsBot(
	content: string,
	deps: ChannelBroadcastDeps = defaultChannelDeps,
): Promise<ChannelBroadcastOutcome[]> {
	const outcomes = await attemptEvery(await deps.targets(), (target) =>
		deps.send(target.channelId, content),
	);
	// A bot post does not involve a lobby, so the lobby id is dropped rather than
	// reported as if it mattered.
	return outcomes.map(({ lobbyId: _lobbyId, ...rest }) => rest);
}

/**
 * Posts `content` into every linked channel as the given **user**, through each
 * lobby (`POST /lobbies/{id}/messages`) — the call a Social SDK game makes.
 *
 * Requires the user's OAuth2 token (`openid sdk.social_layer`) and membership of
 * the lobby, so a server where somebody else created the lobby reports a refusal
 * instead of a message. It is still the honest check: a lobby with no linked
 * channel is refused by Discord.
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
