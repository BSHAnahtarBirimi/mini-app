import { MessageFlags } from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

import { getLobbyRecord } from "../utils/lobby-store.ts";
import { listGuildChannelsForMenu } from "../utils/lobby-channels.ts";
import { hasSocialLayerScope } from "../utils/lobby-oauth.ts";
import { getFreshUserToken } from "../utils/lobby-tokens.ts";
import { buildChannelMenuPayloads } from "../utils/linked-channel-panel.ts";
import { describeError, recordInteractionError } from "../utils/interaction-errors.ts";

/**
 * `lc:link` — shows the channel select menu for linking.
 *
 * Discord's channel select menu has no per-option labels, so we fetch the
 * guild's channels with the BOT token and present a labelled StringSelect
 * instead (privacy badges computed from permission_overwrites). The
 * post-selection warning step (lc:pick) remains the safety net.
 *
 * The handler defers first: a lobby read plus two Discord calls do not reliably
 * fit inside Discord's 3 second first-response deadline, and a late response
 * makes the button appear to do nothing at all.
 */
export const linkButton = {
	customId: "lc:link",

	handler: (async (interaction) => {
		// Ephemerality is fixed here; the editReply below must not repeat it.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const guildId = interaction.guild_id;
		const userId = interaction.member?.user?.id ?? interaction.user?.id;

		try {
			if (!guildId || !userId) {
				return await interaction.editReply({ content: "❌ This only works inside a server." });
			}

			const record = await getLobbyRecord(guildId);
			if (!record) {
				return await interaction.editReply({
					content: "❌ No lobby found for this server. Run `/linked-channel` first.",
				});
			}

			// Fast scope pre-flight: warn before the user browses channels if the
			// stored token lacks sdk.social_layer (linking would 403 anyway).
			const storedToken = await getFreshUserToken(userId);
			if (!storedToken || !hasSocialLayerScope(storedToken.scope)) {
				return await interaction.editReply({
					content:
						"⚠️ **Reconnect required** — channel linking needs a Discord connection with the `openid sdk.social_layer` scope. Use **Reconnect Discord** on the `/linked-channel` panel first.",
				});
			}

			if (!process.env.DISCORD_BOT_TOKEN) {
				return await interaction.editReply({
					content: "❌ Missing DISCORD_BOT_TOKEN environment variable.",
				});
			}

			let channels;
			try {
				channels = await listGuildChannelsForMenu(guildId);
			} catch (error) {
				console.error("[lc:link] channel listing failed:", error);
				await recordInteractionError(error, "lc:link:list-channels");
				return await interaction.editReply({
					content: "❌ Could not list this server's channels. Please try again later.",
				});
			}

			if (channels.length === 0) {
				return await interaction.editReply({
					content: "❌ No text channels available to link in this server.",
				});
			}

			// Both forms exist so a refused edit completes with the legacy
			// payload instead of leaving the button stuck on "thinking…" (see
			// linked-channel-panel.ts, which unit tests both shapes).
			const payloads = buildChannelMenuPayloads({ lobbyId: record.lobbyId, channels });

			try {
				return await interaction.editReply(payloads.v2);
			} catch (error) {
				console.error("[lc:link] V2 menu rejected:", error);
				await recordInteractionError(error, "lc:link:menu-v2");
				return await interaction.editReply(payloads.legacy);
			}
		} catch (error) {
			// Never leave the deferred message unanswered: a visible error beats
			// an eternal "thinking…" state.
			console.error("[lc:link] handler failed:", error);
			await recordInteractionError(error, "lc:link");
			return await interaction
				.editReply({ content: `❌ **Could not open the channel picker.**\n• ${describeError(error)}` })
				.catch(() => undefined);
		}
	}) satisfies ComponentHandler,
};
