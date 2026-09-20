/**
 * `/echo` — your text, posted into the **lobby chat** of every linked channel.
 *
 * The lobby is the game's own message stream, so this is not the same thing as
 * `/mesaj`. `/mesaj` is a broadcast that *falls back* to the app's bot: it always
 * arrives, but when the bot posts it, no game ever sees it. `/echo` posts through
 * `POST /lobbies/{id}/messages` with the calling member's own OAuth2 token — the
 * exact call a Social SDK client makes when a player sends a message — so the
 * text appears in the in-game chat *and* is mirrored into that lobby's linked
 * channel. That is why it needs the member's connection (`openid
 * sdk.social_layer`) and their lobby membership, and why a server where the
 * caller is not a member is reported rather than silently downgraded to a bot
 * message.
 *
 * The behaviour lives here and not in `src/commands/echo.ts`, like
 * `mesaj-command.ts`: `MiniInteraction` discovers commands by importing every
 * file in `src/commands`, so a command module imported from anywhere else makes
 * the bundler emit a compiled copy into that directory, the scan finds the
 * command twice, and Discord rejects the whole registration `PUT`.
 *
 * Two rules that come straight from bugs this project already hit:
 *
 * - **It acknowledges before it works.** Posting into every lobby takes seconds
 *   across several servers, and Discord invalidates the interaction token unless
 *   the first response lands within 3s. Ephemerality is fixed at the deferral, so
 *   the later `editReply` must not repeat the flag.
 * - **Failures are shown, never retried.** Discord's lobby routes are rate
 *   limited, so a refusal is reported per channel with its reason — a retry loop
 *   is how a rate limit becomes an outage.
 */

import { MessageFlags } from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

import { DATABASE_NOT_CONFIGURED_MESSAGE, hasDatabaseConfig } from "./database.ts";
import { describeError, recordInteractionError } from "./interaction-errors.ts";
import { broadcastToLinkedChannels } from "./lobby-broadcast.ts";
import type { BroadcastOutcome } from "./lobby-broadcast.ts";
import { hasSocialLayerScope, REVOKED_CONNECTION_HINT } from "./lobby-oauth.ts";
import { deleteUserToken, getFreshUserToken } from "./lobby-tokens.ts";
import type { StoredUserToken } from "./lobby-tokens.ts";
import { consumeEchoQuota } from "./web-rate-limit.ts";
import type { QuotaResult } from "./web-rate-limit.ts";

/** The command's string option — kept as `text` so `/echo text:…` still works. */
export const ECHO_OPTION = "text";

/**
 * Longest accepted text: Discord's own message limit.
 *
 * A lobby message is a Discord message in the linked channel, so anything longer
 * could not be delivered even if it were accepted — and the refusal says how long
 * the text was instead of truncating it in silence.
 */
export const MAX_ECHO_LENGTH = 2000;

/** What to say when the caller has no stored connection at all. */
export const ECHO_NEEDS_CONNECTION = [
	"❌ Connect your Discord account first — run `/authorize`, then try again.",
	"Your text is posted as *you*, so it needs your own connection.",
].join("\n");

/**
 * Why the missing scope is not the member's fault, and what it actually takes.
 *
 * `sdk.social_layer` is Discord's **limited-access** scope: it is granted at
 * consent time only if the application has an approved **Social SDK access
 * request**. A member can therefore reconnect successfully and still come back
 * without it, which looks like the app ignoring the consent — so the refusal says
 * so, in one line, instead of sending them round the loop again.
 */
export const ECHO_SCOPE_NOTE =
	"`sdk.social_layer` is **limited access**: Discord grants it only after approving a **Social SDK access request** for this application, so a reconnect can succeed and still not include it.";

/** What to say when the stored connection exists but lacks the Social SDK scope. */
export const ECHO_NEEDS_SCOPE = [
	"⚠️ One more step: run `/authorize` again to grant the `sdk.social_layer` permission, then try again.",
	ECHO_SCOPE_NOTE,
].join("\n");

/**
 * The text to post, or why it cannot be.
 *
 * Identical rules to `/mesaj`'s: trimmed, non-empty, within Discord's limit. The
 * text is posted exactly as written — the app adds nothing around it, so there is
 * nothing of the app's voice left to forge.
 */
export function checkEchoText(
	raw: unknown,
): { ok: true; text: string } | { ok: false; error: string } {
	const text = typeof raw === "string" ? raw.replace(/\r\n?/g, "\n").trim() : "";
	if (text === "") {
		return { ok: false, error: `Give the text in \`${ECHO_OPTION}\` — it was empty.` };
	}
	if (text.length > MAX_ECHO_LENGTH) {
		return {
			ok: false,
			error: `That text is ${text.length} characters; Discord's limit is ${MAX_ECHO_LENGTH}.`,
		};
	}
	return { ok: true, text };
}

/**
 * The reply: one line when everything arrived, and Discord's own reason for
 * each channel that did not.
 *
 * Deliberately terse. Earlier versions led with an explanation of what a lobby
 * message *is* and listed a Discord message id per channel — developer narration
 * nobody asked for. What a member wants from `/echo` is confirmation, or the
 * name of the channel that refused and why; the mechanics live in `/docs`.
 *
 * Note what is **not** here: a retry. While the application is unapproved,
 * channel linking is capped at 20 calls per 2 hours, so a failed invocation is
 * reported once with Discord's own reason and left alone.
 */
export function describeEchoReply(outcomes: BroadcastOutcome[]): string {
	if (outcomes.length === 0) {
		return "ℹ️ No channel is linked yet — run `/linked-channel` and link one first.";
	}

	const sent = outcomes.filter((outcome) => outcome.ok).length;
	const failed = outcomes.filter((outcome) => !outcome.ok);

	if (failed.length === 0) {
		return `🔊 Posted to ${sent === 1 ? "1 linked channel" : `all ${sent} linked channels`}.`;
	}

	return [
		`🔊 Posted to ${sent} of ${outcomes.length} linked channels.`,
		...failed.map((outcome) => `• <#${outcome.channelId}> — ${outcome.error ?? "failed"}`),
	].join("\n");
}

/** The refusal shown when a member echoes too often. */
export function describeEchoQuotaRefusal(quota: QuotaResult): string {
	return `⏳ You're sending too fast — try again in ${quota.retryAfterSeconds}s.`;
}

/** What the handler needs from the outside world, injectable for tests. */
export type EchoDeps = {
	hasDatabase: () => boolean;
	/** Counts this invocation against the member's own quota namespace. */
	quota: (userId: string) => Promise<QuotaResult>;
	/** The caller's stored connection, refreshed when it has expired. */
	getToken: (userId: string) => Promise<StoredUserToken | null>;
	/** Drops a connection Discord has rejected. */
	clearToken: (userId: string) => Promise<void>;
	/** Posts into every lobby as the caller. */
	broadcast: (text: string, userToken: string) => Promise<BroadcastOutcome[]>;
};

const defaultDeps: EchoDeps = {
	hasDatabase: () => hasDatabaseConfig(),
	quota: (userId) => consumeEchoQuota(userId),
	getToken: getFreshUserToken,
	clearToken: deleteUserToken,
	broadcast: (text, userToken) => broadcastToLinkedChannels(text, userToken),
};

/** Builds the `/echo` handler, with collaborators that can be replaced in tests. */
export function createEchoHandler(deps: EchoDeps = defaultDeps): SlashCommandHandler {
	return (async (interaction) => {
		// Ephemerality is fixed here; the editReply below must not repeat it.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const userId = interaction.member?.user?.id ?? interaction.user?.id;
		if (!userId || !interaction.guild_id) {
			return await interaction.editReply({
				content: "❌ This command only works inside a server — a lobby is a server's session.",
			});
		}

		if (!deps.hasDatabase()) {
			return await interaction.editReply({ content: DATABASE_NOT_CONFIGURED_MESSAGE });
		}

		const checked = checkEchoText(interaction.options.getString(ECHO_OPTION, true));
		if (!checked.ok) {
			return await interaction.editReply({ content: `❌ ${checked.error}` });
		}

		try {
			const quota = await deps.quota(userId);
			if (!quota.allowed) {
				return await interaction.editReply({ content: describeEchoQuotaRefusal(quota) });
			}
		} catch (error) {
			// A quota that cannot be read must not take the command down: the
			// member asked for their text to be posted, and posting is the job.
			console.error("[echo] could not read the quota:", error);
		}

		// The connection has to be checked before the call, not after: Discord
		// answers a user-token route with 403 when the scope is missing, which
		// reads like a permissions problem in the server rather than a missing
		// consent — the exact confusion `/authorize` exists to remove.
		let token: StoredUserToken | null = null;
		try {
			token = await deps.getToken(userId);
		} catch (error) {
			console.error("[echo] could not read the stored connection:", error);
			return await interaction.editReply({
				content: `❌ **Could not read your Discord connection.**\n• ${describeError(error)}`,
			});
		}

		if (!token) return await interaction.editReply({ content: ECHO_NEEDS_CONNECTION });
		if (!hasSocialLayerScope(token.scope)) {
			return await interaction.editReply({ content: ECHO_NEEDS_SCOPE });
		}

		try {
			const outcomes = await deps.broadcast(checked.text, token.accessToken);

			// Every lobby refused the stored token: the account revoked the app.
			// Drop the dead record so nothing keeps claiming a connection.
			const failed = outcomes.filter((outcome) => !outcome.ok);
			const allRejected =
				outcomes.length > 0 &&
				failed.length === outcomes.length &&
				failed.every((outcome) => outcome.status === 401);
			if (allRejected) {
				console.error("[echo] stored connection was revoked:", failed[0]?.error);
				await deps.clearToken(userId).catch(() => undefined);
				await recordInteractionError(
					new Error(`every lobby rejected the stored token: ${failed[0]?.error ?? ""}`),
					"echo:revoked",
				);
				return await interaction.editReply({ content: REVOKED_CONNECTION_HINT });
			}

			for (const outcome of failed) {
				console.error(`[echo] <#${outcome.channelId}> refused the message:`, outcome.error);
			}

			return await interaction.editReply({ content: describeEchoReply(outcomes) });
		} catch (error) {
			// Never leave the deferred reply unanswered: a visible failure beats an
			// eternal "«bot» is thinking…". Nothing was sent, and nothing retried.
			console.error("[echo] broadcast failed:", error);
			await recordInteractionError(error, "echo");
			return await interaction.editReply({
				content: `❌ Could not post your message.\n• ${describeError(error)}`,
			});
		}
	}) satisfies SlashCommandHandler;
}
