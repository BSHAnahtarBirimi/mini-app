import { MessageFlags } from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

import { getLobbyRecord } from "../utils/lobby-store.ts";
import { getFreshUserToken } from "../utils/lobby-tokens.ts";
import { hasSocialLayerScope } from "../utils/lobby-oauth.ts";
import { createLobbyChannelInviteForSelf, describeLobbyError, DiscordRestApiError } from "../utils/lobby-api.ts";
import { isUnknownLobbyError } from "../utils/lobby-lifecycle.ts";

/**
 * `lc:join` — "Join Discord server" button.
 *
 * Calls POST /lobbies/{lobby.id}/members/@me/invites with the calling user's
 * OAuth2 Bearer token (`openid sdk.social_layer`): creates a single-use
 * invite (1 hour expiry) to the lobby's linked channel's server, targeted at
 * the calling user. The lobby must have a linked channel and the caller must
 * be a lobby member. Also requires the stored user token — the bot token is
 * not accepted on this endpoint.
 */
export const joinServerButton = {
	customId: "lc:join",

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
				content: "❌ No lobby found for this server. Ask an admin to run `/linked-channel` first.",
			});
		}

		const storedToken = await getFreshUserToken(userId);
		if (!storedToken) {
			return interaction.editReply({
				content:
					"❌ Connect your Discord account first (the app's **Connect Discord** page), then try again.",
			});
		}
		if (!hasSocialLayerScope(storedToken.scope)) {
			return interaction.editReply({
				content:
					"⚠️ **Reconnect required** — joining via the lobby needs the `openid sdk.social_layer` scope. Use **Reconnect Discord** on the `/linked-channel` panel, then try again.",
			});
		}

		try {
			const invite = await createLobbyChannelInviteForSelf(
				record.lobbyId,
				storedToken.accessToken,
			);

			return interaction.editReply({
				content: [
					"📨 **Your one-time invite is ready!** It expires after 1 hour and can only be used once.",
					`https://discord.gg/${invite.code}`,
				].join("\n"),
			});
		} catch (error) {
			// Lobbies are session objects: an id stored when the panel ran may have
			// been reaped, and there is no invite to hand out for a lobby that no
			// longer exists. Say that instead of reporting a Discord failure.
			if (isUnknownLobbyError(error)) {
				return interaction.editReply({
					content: [
						"⌛ **This lobby no longer exists on Discord's side.** Lobbies are re-created when a channel is linked, so run `/linked-channel` and link a channel again.",
					].join("\n"),
				});
			}
			if (error instanceof DiscordRestApiError) {
				console.error("[lc:join] invite failed:", error.status, error.body);
				return interaction.editReply({
					content: [
						"❌ **Could not create an invite.**",
						`• ${describeLobbyError(error)}`,
						"",
						"The lobby must have a linked channel and you must be one of its members.",
					].join("\n"),
				});
			}
			console.error("[lc:join] unexpected error:", error);
			return interaction.editReply({
				content: [
					"❌ **Unexpected error while creating the invite.**",
					`• ${error instanceof Error ? error.message : String(error)}`,
				].join("\n"),
			});
		}
	}) satisfies ComponentHandler,
};
