import { MessageFlags } from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

import { deleteUserToken, getFreshUserToken } from "../utils/lobby-tokens.ts";
import { hasSocialLayerScope, REVOKED_CONNECTION_HINT } from "../utils/lobby-oauth.ts";
import {
	broadcastToLinkedChannels,
	describeBroadcastOutcomes,
} from "../utils/lobby-broadcast.ts";
import { describeLobbyError, LobbyCallTimeoutError } from "../utils/lobby-api.ts";
import { recordInteractionError } from "../utils/interaction-errors.ts";

/** What the test message says once it lands in the linked channel(s). */
export const TEST_MESSAGE =
	"👋 Test message sent from the app's lobby — this is how a message posted inside the game appears in the linked channel.";

/**
 * `lc:test` — "Send a test message to every linked channel".
 *
 * Posts into **every** lobby this app maintains, with the calling user's OAuth2
 * Bearer token (`POST /lobbies/{lobby.id}/messages`, needs
 * `openid sdk.social_layer`). That is exactly what a Social SDK client does when
 * a player sends a message in-game: the message is delivered to the lobby and
 * mirrored into its linked channel, which is the part of Linked Channels no
 * Discord UI can show.
 *
 * It goes to all of them, not only this server's, because an application with
 * links in several servers otherwise has no way to see that they all still work
 * — and because Discord has no broadcast primitive, a loop over the links is the
 * only mechanism that exists (see `lobby-broadcast.ts`). The reply names each
 * channel and Discord's answer for it, so a link that stopped working is visible
 * instead of looking like the app only ever posts in one place.
 *
 * Defers first: listing the lobbies, reading the stored token and posting into
 * each is past Discord's 3 second first-response deadline (see
 * `response-timing.test.ts`).
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
			const outcomes = await broadcastToLinkedChannels(TEST_MESSAGE, storedToken.accessToken);
			const failed = outcomes.filter((outcome) => !outcome.ok);

			// Every channel refused the stored user token: the account revoked the
			// app. Drop the dead record so nothing keeps claiming a connection.
			const allRejected =
				outcomes.length > 0 &&
				failed.length === outcomes.length &&
				failed.every((outcome) => outcome.status === 401);
			if (allRejected) {
				console.error("[lc:test] stored connection was revoked:", failed[0]?.error);
				await deleteUserToken(userId).catch(() => undefined);
				await recordInteractionError(
					new Error(`every linked channel rejected the stored token: ${failed[0]?.error ?? ""}`),
					"lc:test:revoked",
				);
				return interaction.editReply({ content: REVOKED_CONNECTION_HINT });
			}

			for (const outcome of failed) {
				console.error(`[lc:test] <#${outcome.channelId}> refused the message:`, outcome.error);
			}

			return interaction.editReply({ content: describeBroadcastOutcomes(outcomes) });
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
			console.error("[lc:test] unexpected error:", error);
			await recordInteractionError(error, "lc:test");
			return interaction.editReply({
				content: [
					"❌ **Could not list the linked channels.**",
					`• ${describeLobbyError(error)}`,
					"",
					"Nothing was sent, and the request was **not** retried.",
				].join("\n"),
			});
		}
	}) satisfies ComponentHandler,
};
