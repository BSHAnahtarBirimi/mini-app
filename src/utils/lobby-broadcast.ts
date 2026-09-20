/**
 * Sending one message to **every** linked channel.
 *
 * Discord has no broadcast primitive: an application that maintains a linked
 * channel in several servers can only reach all of them by finding each one and
 * posting into it. There is no webhook event, gateway subscription or "Event" in
 * the Developer Portal that grants one — the loop is the mechanism, and this
 * module is that loop, shared by anything that wants to speak to all links.
 *
 * Targets come from `linkedChannelTargets` (the same definition the
 * `APPLICATION_DEAUTHORIZED` notice uses), which discovers servers from Discord
 * and reads each one's channel — falling back to the channel remembered on the
 * guild's record, so a lobby Discord has already reaped still gets a target.
 *
 * Two properties matter:
 *
 * - **The sends run concurrently** (`Promise.allSettled`), so one slow or
 *   unreachable lobby cannot eat the whole function timeout, and one failure
 *   cannot mute the channels after it. The caller gets a per-channel outcome and
 *   reports it — that is the answer to "did every channel get it?".
 * - **A message posted *into a lobby* is the game's own path.** Discord mirrors
 *   it into the linked channel, which is what a Social SDK client does when a
 *   player sends a message in-game. That requires the calling user's OAuth2
 *   token (`openid sdk.social_layer`) and membership of the lobby, so a server
 *   where somebody else created the lobby reports a refusal instead of a
 *   message. It is still the honest check: a lobby with no linked channel is
 *   refused by Discord.
 */

import { describeLobbyError, DiscordRestApiError, sendLobbyMessage } from "./lobby-api.ts";
import type { LinkedChannelTarget } from "./webhook-events.ts";
import { linkedChannelTargets } from "./webhook-events.ts";

export type BroadcastOutcome = {
	guildId: string;
	lobbyId: string;
	channelId: string;
	ok: boolean;
	/** Present when the message landed (the lobby message id). */
	messageId?: string;
	/** Present when it did not — Discord's own reason. */
	error?: string;
	/** Discord's HTTP status when it answered with an error (401 ⇒ token dead). */
	status?: number;
};

/** Collaborators of {@link broadcastToLinkedChannels}, injectable for tests. */
export type BroadcastDeps = {
	targets: () => Promise<LinkedChannelTarget[]>;
	send: (
		target: LinkedChannelTarget,
		content: string,
		userToken: string,
	) => Promise<{ id: string }>;
};

const defaultDeps: BroadcastDeps = {
	targets: () => linkedChannelTargets(),
	send: (target, content, userToken) => sendLobbyMessage(target.lobbyId, content, userToken),
};

/**
 * Posts `content` into every linked channel this app maintains, as the user
 * whose token is given (the game's own call).
 *
 * Never throws for a per-channel failure and never retries: Discord's answer for
 * one channel is reported back for that channel and the rest still go out.
 */
export async function broadcastToLinkedChannels(
	content: string,
	userToken: string,
	deps: BroadcastDeps = defaultDeps,
): Promise<BroadcastOutcome[]> {
	const targets = await deps.targets();

	const settled = await Promise.allSettled(
		targets.map((target) => deps.send(target, content, userToken)),
	);

	return settled.map((result, index) => {
		const target = targets[index];
		const base = { guildId: target.guildId, lobbyId: target.lobbyId, channelId: target.channelId };
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
 * The reply body for a broadcast, one line per channel.
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
