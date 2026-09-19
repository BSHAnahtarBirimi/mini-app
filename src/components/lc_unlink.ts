import { MessageFlags } from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

import { getLobbyRecord, deleteLobbyRecord } from "../utils/lobby-store.ts";
import { getFreshUserToken } from "../utils/lobby-tokens.ts";
import { hasSocialLayerScope } from "../utils/lobby-oauth.ts";
import { unlinkChannelFromLobby, describeLobbyError, DiscordRestApiError } from "../utils/lobby-api.ts";

/**
 * `lc:unlink` — removes the channel link from the guild's lobby.
 *
 * Also requires the USER OAuth2 Bearer token with `sdk.social_layer` and the
 * CanLinkLobby flag — members without the flag cannot link OR unlink. Single
 * attempt, errors surfaced (unlink is capped at 20 calls / 2 h per app too).
 */
export const unlinkButton = {
	customId: "lc:unlink",

	handler: (async (interaction) => {
		// Ephemerality is fixed here; the editReply below must not repeat it.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const guildId = interaction.guild_id;
		const userId = interaction.member?.user?.id ?? interaction.user?.id;
		if (!guildId || !userId) {
			return interaction.editReply({ content: "❌ This only works inside a server." });
		}

		const record = await getLobbyRecord(guildId);
		if (!record) {
			return interaction.editReply({
				content: "ℹ️ No lobby is configured for this server yet.",
			});
		}

		const storedToken = await getFreshUserToken(userId);
		if (!storedToken) {
			return interaction.editReply({
				content:
					"❌ Connect your Discord account first (the app's **Connect Discord** page), then retry.",
			});
		}
		if (!hasSocialLayerScope(storedToken.scope)) {
			return interaction.editReply({
				content:
					"⚠️ **Reconnect required** — your Discord connection is missing the `openid sdk.social_layer` scope. Use **Reconnect Discord** on the `/linked-channel` panel, then retry.",
			});
		}

		try {
			await unlinkChannelFromLobby(record.lobbyId, storedToken.accessToken);
			await deleteLobbyRecord(guildId);

			return interaction.editReply({
				content: "✅ **Unlinked.** The lobby no longer forwards messages to any Discord channel.",
			});
		} catch (error) {
			if (error instanceof DiscordRestApiError) {
				console.error("[lc:unlink] unlink failed:", error.status, error.body);
				return interaction.editReply({
					content: [
						"❌ **Discord rejected the unlink.**",
						`• ${describeLobbyError(error)}`,
						"",
						"Common causes: missing `sdk.social_layer` scope, missing CanLinkLobby lobby flag, no link present, or the development cap of **20 calls per 2 hours** being exhausted. The request was **not** retried.",
					].join("\n"),
				});
			}
			console.error("[lc:unlink] unexpected error:", error);
			return interaction.editReply({
				content: [
					"❌ **Unexpected error while unlinking.** The request was **not** retried.",
					`• ${error instanceof Error ? error.message : String(error)}`,
				].join("\n"),
			});
		}
	}) satisfies ComponentHandler,
};
