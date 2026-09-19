import { MessageFlags } from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

import { getLobbyRecord } from "../utils/lobby-store.ts";
import { getPendingLink, clearPendingLink } from "../utils/linked-channel-state.ts";
import { getFreshUserToken } from "../utils/lobby-tokens.ts";
import { hasSocialLayerScope } from "../utils/lobby-oauth.ts";
import { linkChannelToLobby, describeLobbyError, DiscordRestApiError } from "../utils/lobby-api.ts";

/**
 * `lc:confirm` — performs the actual channel link after the warning step.
 *
 * Calls the Lobby HTTP API with the linking user's OAuth2 Bearer token
 * (needs `openid sdk.social_layer`) against the lobby where that user's
 * member record carries CanLinkLobby (1 << 0). Failed links are surfaced to
 * the user — NEVER retried in a loop — because while the app is unapproved,
 * channel linking is capped at 20 calls per 2 hours per application.
 */
export const confirmLinkButton = {
	customId: "lc:confirm",

	handler: (async (interaction) => {
		const guildId = interaction.guild_id;
		const userId = interaction.member?.user?.id ?? interaction.user?.id;
		if (!guildId || !userId) {
			return interaction.reply({
				content: "❌ This only works inside a server.",
				flags: MessageFlags.Ephemeral,
			});
		}

		const record = await getLobbyRecord(guildId);
		if (!record) {
			return interaction.reply({
				content: "❌ No lobby found for this server. Run `/linked-channel` first.",
				flags: MessageFlags.Ephemeral,
			});
		}

		const pending = await getPendingLink(userId, guildId);
		if (!pending || pending.channelId === "") {
			return interaction.reply({
				content: [
					"⌛ **The selected channel was forgotten** — pending picks expire after 10 minutes.",
					"Start again with **Link a channel**.",
				].join("\n"),
				flags: MessageFlags.Ephemeral,
			});
		}

		const storedToken = await getFreshUserToken(userId);
		if (!storedToken) {
			return interaction.reply({
				content:
					"❌ Connect your Discord account first (the app's **Connect Discord** page), then retry the link.",
				flags: MessageFlags.Ephemeral,
			});
		}
		if (!hasSocialLayerScope(storedToken.scope)) {
			return interaction.reply({
				content:
					"⚠️ **Reconnect required** — your Discord connection is missing the `openid sdk.social_layer` scope. Use **Reconnect Discord** on the `/linked-channel` panel, then retry.",
				flags: MessageFlags.Ephemeral,
			});
		}

		try {
			// Single attempt — no retry loop (20 calls / 2 h per app).
			const lobby = await linkChannelToLobby(
				record.lobbyId,
				pending.channelId,
				storedToken.accessToken,
			);

			const channelMention = pending.channelName
				? `**#${pending.channelName}**`
				: `<#${pending.channelId}>`;
			// The link succeeded, so the pending pick has served its purpose.
			await clearPendingLink(userId, guildId);

			return interaction.reply({
				content: [
					`✅ **Linked!** ${channelMention} is now linked to lobby \`${lobby.id}\`.`,
					"",
					"Lobby members can read and post in the channel from inside the game — including members who cannot see it in Discord.",
				].join("\n"),
				flags: MessageFlags.Ephemeral,
			});
		} catch (error) {
			if (error instanceof DiscordRestApiError) {
				console.error("[lc:confirm] link failed:", error.status, error.body);
				return interaction.reply({
					content: [
						"❌ **Discord rejected the link.**",
						`• ${describeLobbyError(error)}`,
						"",
						"Common causes: missing `sdk.social_layer` scope on your connection, missing CanLinkLobby lobby flag, lacking Manage Channels / View / Send permissions on the channel, the channel being already linked, or the development cap of **20 link calls per 2 hours** being exhausted. The request was **not** retried.",
					].join("\n"),
					flags: MessageFlags.Ephemeral,
				});
			}
			console.error("[lc:confirm] unexpected error:", error);
			return interaction.reply({
				content: [
					"❌ **Unexpected error while linking.** The request was **not** retried.",
					`• ${error instanceof Error ? error.message : String(error)}`,
				].join("\n"),
				flags: MessageFlags.Ephemeral,
			});
		}
	}) satisfies ComponentHandler,
};
