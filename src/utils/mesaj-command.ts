/**
 * `/mesaj` — one message out to **every** linked channel.
 *
 * The same delivery the web app performs (`sendToLinkedChannels`: through each
 * server's lobby when its member has a connected account, into the channel as
 * the bot when it cannot), asked for from inside Discord instead of from a
 * browser. Two differences follow from the audience:
 *
 * - **The text is posted as written**, exactly as on the web. Nothing is added
 *   around it, so nothing of the app's voice can be forged — and the sender is a
 *   member of the server the message reaches, which is the same trust Discord
 *   already extends to their own messages.
 * - **It is rate-limited per member**, not per IP (`consumeCommandQuota`). One
 *   invocation posts into every linked channel the app maintains, so "5 per
 *   minute" applies to the person, and the refusal names the member rather than
 *   an address.
 *
 * The handler is created by a factory with injectable collaborators, and lives
 * here rather than in `src/commands/` — the framework discovers commands by
 * importing every file in that directory, so anything imported from there (a
 * diagnostic, a test) would make the bundler emit a second copy and the command
 * would be discovered twice. `src/commands/mesaj.ts` is the thin wrapper.
 */

import { MessageFlags } from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

import { DATABASE_NOT_CONFIGURED_MESSAGE, hasDatabaseConfig } from "./database.ts";
import type { DeliveryOutcome } from "./lobby-broadcast.ts";
import { sendToLinkedChannels } from "./lobby-broadcast.ts";
import type { QuotaResult } from "./web-rate-limit.ts";
import { consumeCommandQuota } from "./web-rate-limit.ts";

/** The command's string option: `metin` (Turkish for "text"). */
export const MESAJ_OPTION = "metin";

/**
 * Longest accepted message.
 *
 * 2000 is Discord's own limit for a message, so anything longer could not be
 * posted even if it were accepted. The web app's 500 is a tighter budget on
 * purpose: that endpoint is open to strangers, this one is not.
 */
export const MAX_MESAJ_LENGTH = 2000;

/** The text to post, or why the invocation cannot be honoured. */
export function checkMesajText(
	raw: unknown,
): { ok: true; text: string } | { ok: false; error: string } {
	const text = typeof raw === "string" ? raw.replace(/\r\n?/g, "\n").trim() : "";
	if (text === "") {
		return { ok: false, error: `Give the message in \`${MESAJ_OPTION}\` — it was empty.` };
	}
	if (text.length > MAX_MESAJ_LENGTH) {
		return {
			ok: false,
			error: `That message is ${text.length} characters; Discord's limit is ${MAX_MESAJ_LENGTH}.`,
		};
	}
	return { ok: true, text };
}

/**
 * The reply, one line per channel.
 *
 * Pure so the wording is unit tested: this is how the member finds out *which*
 * server did not receive the message, which is the only thing that makes a
 * broadcast dependable rather than hopeful.
 */
export function describeMesajReply(outcomes: DeliveryOutcome[]): string {
	if (outcomes.length === 0) {
		return [
			"ℹ️ **No channel is linked yet.**",
			"Run `/linked-channel` → **Link a channel** in a server first; then this command posts into every linked channel the app maintains.",
		].join("\n");
	}

	const sent = outcomes.filter((outcome) => outcome.ok).length;
	const lines = [
		sent === outcomes.length
			? `✅ **Sent to all ${outcomes.length} linked channel${outcomes.length === 1 ? "" : "s"}.**`
			: `⚠️ **Sent to ${sent} of ${outcomes.length} linked channels.**`,
		"",
		...outcomes.map((outcome) => {
			if (!outcome.ok) return `• <#${outcome.channelId}> — ❌ ${outcome.error ?? "failed"}`;
			if (outcome.delivery === "lobby") return `• <#${outcome.channelId}> — via the game lobby`;
			// "via the bot" on its own reads as success; the reason it was not a
			// lobby message is what tells the reader that lobby is idle.
			return `• <#${outcome.channelId}> — via the bot${outcome.lobbyFallback ? ` (${outcome.lobbyFallback})` : ""}`;
		}),
	];

	const failed = outcomes.filter((outcome) => !outcome.ok);
	if (failed.length > 0) {
		const statuses = new Set(failed.map((outcome) => outcome.status));
		const hints: string[] = [];
		if (statuses.has(404)) {
			hints.push("**404** means that server's lobby went idle — re-link it there.");
		}
		if (statuses.has(403)) {
			hints.push(
				"**403** means the app cannot post in that channel (View Channel + Send Messages), or its linked member left.",
			);
		}
		if (statuses.has(401)) {
			hints.push("**401** means the stored Discord connection was revoked — run `/authorize` there.");
		}
		lines.push("", hints.length > 0 ? hints.join(" ") : "Discord's reason per channel is above.");
	}

	return lines.join("\n");
}

/** The quota message for a refused invocation. */
export function describeQuotaRefusal(quota: QuotaResult): string {
	return `⏳ **Slow down.** This command posts into every linked channel at once, so it is limited to ${quota.retryAfterSeconds}s more — try again then.`;
}

/** What the handler needs from the outside world, injectable for tests. */
export type MesajDeps = {
	hasDatabase: () => boolean;
	/** Counts this invocation against the member's quota. */
	quota: (userId: string) => Promise<QuotaResult>;
	broadcast: (text: string) => Promise<DeliveryOutcome[]>;
};

const defaultDeps: MesajDeps = {
	hasDatabase: () => hasDatabaseConfig(),
	quota: (userId) => consumeCommandQuota(userId),
	broadcast: (text) => sendToLinkedChannels(text),
};

/**
 * Builds the `/mesaj` handler.
 *
 * It acknowledges before doing any work — the broadcast can take seconds across
 * several servers, and Discord invalidates the interaction token unless the first
 * response lands within 3s. Ephemerality is fixed at the deferral, so the later
 * edit must not repeat the flag (a deferred message's flags are set on create).
 */
export function createMesajHandler(deps: MesajDeps = defaultDeps): SlashCommandHandler {
	return (async (interaction) => {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const userId = interaction.member?.user?.id ?? interaction.user?.id;
		if (!userId) {
			return await interaction.editReply({
				content: "❌ This command only works inside a server.",
			});
		}

		if (!deps.hasDatabase()) {
			return await interaction.editReply({ content: DATABASE_NOT_CONFIGURED_MESSAGE });
		}

		const checked = checkMesajText(interaction.options.getString(MESAJ_OPTION, true));
		if (!checked.ok) {
			return await interaction.editReply({ content: `❌ ${checked.error}` });
		}

		try {
			const quota = await deps.quota(userId);
			if (!quota.allowed) {
				return await interaction.editReply({ content: describeQuotaRefusal(quota) });
			}
		} catch (error) {
			// A quota that cannot be read must not take the feature down; the
			// broadcast itself is the thing the member asked for.
			console.error("[mesaj] could not read the quota:", error);
		}

		try {
			return await interaction.editReply({
				content: describeMesajReply(await deps.broadcast(checked.text)),
			});
		} catch (error) {
			// Never leave the deferred reply unanswered: a visible failure beats an
			// eternal "«bot» is thinking…".
			console.error("[mesaj] broadcast failed:", error);
			return await interaction.editReply({
				content: `❌ **Could not send the message.**\n• ${describeError(error)}`,
			});
		}
	}) satisfies SlashCommandHandler;
}

/** One-line description of a thrown value, for the reply. */
function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
