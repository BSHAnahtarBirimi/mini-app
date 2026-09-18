import { MessageFlags } from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

import { db } from "../utils/database.js";
import { getLobbyRecord, deleteLobbyRecord } from "../utils/lobby-store.js";
import { getStoredUserToken } from "../utils/lobby-tokens.js";
import { hasSocialLayerScope } from "../utils/lobby-oauth.js";
import { unlinkChannelFromLobby, describeLobbyError, DiscordRestApiError } from "../utils/lobby-api.js";

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
		const guildId = interaction.guild_id;
		const userId = interaction.member?.user?.id ?? interaction.user?.id;
		if (!guildId || !userId) {
			return interaction.reply({
				content: "❌ This only works inside a server.",
				flags: MessageFlags.Ephemeral,
			});
		}

		const record = await getLobbyRecord(db, guildId);
		if (!record) {
			return interaction.reply({
				content: "ℹ️ No lobby is configured for this server yet.",
				flags: MessageFlags.Ephemeral,
			});
		}

		const storedToken = await getStoredUserToken(db, userId);
		if (!storedToken) {
			return interaction.reply({
				content:
					"❌ Connect your Discord account first (the app's **Connect Discord** page), then retry.",
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
			await unlinkChannelFromLobby(record.lobbyId, storedToken.accessToken);
			await deleteLobbyRecord(db, guildId);

			return interaction.reply({
				content: "✅ **Unlinked.** The lobby no longer forwards messages to any Discord channel.",
				flags: MessageFlags.Ephemeral,
			});
		} catch (error) {
			if (error instanceof DiscordRestApiError) {
				console.error("[lc:unlink] unlink failed:", error.status, error.body);
				return interaction.reply({
					content: [
						"❌ **Discord rejected the unlink.**",
						`• ${describeLobbyError(error)}`,
						"",
						"Common causes: missing `sdk.social_layer` scope, missing CanLinkLobby lobby flag, no link present, or the development cap of **20 calls per 2 hours** being exhausted. The request was **not** retried.",
					].join("\n"),
					flags: MessageFlags.Ephemeral,
				});
			}
			console.error("[lc:unlink] unexpected error:", error);
			return interaction.reply({
				content: "❌ Unexpected error while unlinking. The request was **not** retried.",
				flags: MessageFlags.Ephemeral,
			});
		}
	}) satisfies ComponentHandler,
};
