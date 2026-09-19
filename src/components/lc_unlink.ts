import { MessageFlags } from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

import { getLobbyRecord, deleteLobbyRecord } from "../utils/lobby-store.ts";
import { deleteUserToken, getFreshUserToken } from "../utils/lobby-tokens.ts";
import { hasSocialLayerScope, REVOKED_CONNECTION_HINT } from "../utils/lobby-oauth.ts";
import {
	unlinkChannelFromLobby,
	describeLobbyError,
	DiscordRestApiError,
	LobbyCallTimeoutError,
} from "../utils/lobby-api.ts";
import { isUnknownLobbyError } from "../utils/lobby-lifecycle.ts";
import { recordInteractionError } from "../utils/interaction-errors.ts";

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

		// A lobby is a session object that Discord reaps when idle, so a stored id
		// can already be unknown. Nothing is linked in that case — clearing the
		// record is the whole operation, and reporting it as a failure would be
		// noise (the admin cannot unlink what no longer exists).
		try {
			await unlinkChannelFromLobby(record.lobbyId, storedToken.accessToken);
			await deleteLobbyRecord(guildId);

			return interaction.editReply({
				content: "✅ **Unlinked.** The lobby no longer forwards messages to any Discord channel.",
			});
		} catch (error) {
			if (isUnknownLobbyError(error)) {
				await deleteLobbyRecord(guildId);
				return interaction.editReply({
					content: [
						"✅ **Nothing was linked.** The stored lobby no longer exists on Discord's side — lobbies are re-created when needed, so this is expected after they go idle.",
						"The local record has been cleared.",
					].join("\n"),
				});
			}
			if (error instanceof LobbyCallTimeoutError) {
				console.error("[lc:unlink] unlink call timed out:", error.message);
				await recordInteractionError(error, "lc:unlink:timeout");
				return interaction.editReply({
					content: [
						"⏳ **Discord did not answer the unlink request.**",
						`• ${error.message}`,
						"Nothing was changed, and the request was **not** retried.",
					].join("\n"),
				});
			}
			// Discord rejected the stored user token: the account revoked the app.
			if (error instanceof DiscordRestApiError && error.status === 401) {
				console.error("[lc:unlink] stored connection was revoked:", error.body);
				await deleteUserToken(userId).catch(() => undefined);
				await recordInteractionError(error, "lc:unlink:revoked");
				return interaction.editReply({ content: REVOKED_CONNECTION_HINT });
			}
			if (error instanceof DiscordRestApiError) {
				console.error("[lc:unlink] unlink failed:", error.status, error.body);
					return interaction.editReply({
					content: [
						"❌ **Discord rejected the unlink.**",
						`• ${describeLobbyError(error)}`,
						"",
						"403 usually means `CanLinkLobby` is not set for your lobby member, or the `openid sdk.social_layer` scope is missing on your connection. The request was **not** retried.",
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
