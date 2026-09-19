import { MessageFlags } from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

import { getLobbyRecord } from "../utils/lobby-store.ts";
import { getFreshUserToken } from "../utils/lobby-tokens.ts";
import { hasSocialLayerScope } from "../utils/lobby-oauth.ts";
import {
	describeLobbyError,
	sendLobbyMessage,
	DiscordRestApiError,
	LobbyCallTimeoutError,
} from "../utils/lobby-api.ts";
import { isUnknownLobbyError } from "../utils/lobby-lifecycle.ts";
import { recordInteractionError } from "../utils/interaction-errors.ts";

/** What the test message says once it lands in the linked channel. */
export const TEST_MESSAGE =
	"👋 Test message sent from the app's lobby — this is how a message posted inside the game appears in the linked channel.";

/**
 * `lc:test` — "Send a test message".
 *
 * Posts into the lobby with the calling user's OAuth2 Bearer token
 * (`POST /lobbies/{lobby.id}/messages`, needs `openid sdk.social_layer`). That is
 * exactly what a Social SDK client does when a player sends a message in-game:
 * the message is delivered to the lobby and mirrored into the linked channel,
 * which is the part of Linked Channels no Discord UI can show. It also fails
 * loudly when the lobby has no linked channel, so it doubles as a check that the
 * link is actually live.
 *
 * Defers first: reading the lobby and the stored token and then posting is past
 * Discord's 3 second first-response deadline (see response-timing.test.ts).
 */
export const sendTestMessageButton = {
	customId: "lc:test",

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
				content:
					"ℹ️ No lobby is configured for this server yet — link a channel first, then this button posts into it.",
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
					"⚠️ **Reconnect required** — posting into the lobby needs the `openid sdk.social_layer` scope. Use **Reconnect Discord** on the `/linked-channel` panel, then try again.",
			});
		}

		try {
			const message = await sendLobbyMessage(record.lobbyId, TEST_MESSAGE, storedToken.accessToken);

			return interaction.editReply({
				content: [
					"✅ **Sent.** The message went in through the lobby (as a game would), so it now appears in the linked channel.",
					"",
					`Lobby message id: \`${message.id}\``,
					"If nothing shows up in the channel, the lobby has no linked channel — check **Link a channel** first.",
				].join("\n"),
			});
		} catch (error) {
			if (error instanceof LobbyCallTimeoutError) {
				console.error("[lc:test] lobby message timed out:", error.message);
				await recordInteractionError(error, "lc:test:timeout");
				return interaction.editReply({
					content: [
						"⏳ **Discord did not answer the send request.**",
						`• ${error.message}`,
						"",
						"Nothing was sent, and the request was **not** retried.",
					].join("\n"),
				});
			}
			if (isUnknownLobbyError(error)) {
				return interaction.editReply({
					content: [
						"⌛ **This lobby no longer exists on Discord's side.** Lobbies are session objects Discord reaps when idle — link a channel again and retry.",
					].join("\n"),
				});
			}
			if (error instanceof DiscordRestApiError) {
				console.error("[lc:test] lobby message failed:", error.status, error.body);
				return interaction.editReply({
					content: [
						"❌ **Discord refused the message.**",
						`• ${describeLobbyError(error)}`,
						"",
						"The lobby must have a linked channel, and you must be one of its members. `403` usually means the `openid sdk.social_layer` scope is missing on your connection.",
					].join("\n"),
				});
			}
			console.error("[lc:test] unexpected error:", error);
			return interaction.editReply({
				content: [
					"❌ **Unexpected error while sending.**",
					`• ${error instanceof Error ? error.message : String(error)}`,
				].join("\n"),
			});
		}
	}) satisfies ComponentHandler,
};
