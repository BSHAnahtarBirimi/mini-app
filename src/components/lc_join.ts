import { MessageFlags } from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

import { db } from "../utils/database.js";
import { getLobbyRecord } from "../utils/lobby-store.js";
import { getStoredUserToken } from "../utils/lobby-tokens.js";
import { hasSocialLayerScope } from "../utils/lobby-oauth.js";
import { createLobbyChannelInviteForSelf, describeLobbyError, DiscordRestApiError } from "../utils/lobby-api.js";

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
				content: "❌ No lobby found for this server. Ask an admin to run `/linked-channel` first.",
				flags: MessageFlags.Ephemeral,
			});
		}

		const storedToken = await getStoredUserToken(db, userId);
		if (!storedToken) {
			return interaction.reply({
				content:
					"❌ Connect your Discord account first (the app's **Connect Discord** page), then try again.",
				flags: MessageFlags.Ephemeral,
			});
		}
		if (!hasSocialLayerScope(storedToken.scope)) {
			return interaction.reply({
				content:
					"⚠️ **Reconnect required** — joining via the lobby needs the `openid sdk.social_layer` scope. Use **Reconnect Discord** on the `/linked-channel` panel, then try again.",
				flags: MessageFlags.Ephemeral,
			});
		}

		try {
			const invite = await createLobbyChannelInviteForSelf(
				record.lobbyId,
				storedToken.accessToken,
			);

			return interaction.reply({
				content: [
					"📨 **Your one-time invite is ready!** It expires after 1 hour and can only be used once.",
					`https://discord.gg/${invite.code}`,
				].join("\n"),
				flags: MessageFlags.Ephemeral,
			});
		} catch (error) {
			if (error instanceof DiscordRestApiError) {
				console.error("[lc:join] invite failed:", error.status, error.body);
				return interaction.reply({
					content: [
						"❌ **Could not create an invite.**",
						`• ${describeLobbyError(error)}`,
						"",
						"The lobby must have a linked channel and you must be one of its members.",
					].join("\n"),
					flags: MessageFlags.Ephemeral,
				});
			}
			console.error("[lc:join] unexpected error:", error);
			return interaction.reply({
				content: "❌ Unexpected error while creating the invite.",
				flags: MessageFlags.Ephemeral,
			});
		}
	}) satisfies ComponentHandler,
};
