import { MessageFlags } from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

import { getLobbyRecord } from "../utils/lobby-store.ts";
import type { LobbyRecord } from "../utils/lobby-store.ts";
import { getPendingLink, clearPendingLink } from "../utils/linked-channel-state.ts";
import { deleteUserToken, getFreshUserToken } from "../utils/lobby-tokens.ts";
import { hasSocialLayerScope, REVOKED_CONNECTION_HINT } from "../utils/lobby-oauth.ts";
import {
	linkChannelToLobby,
	describeLobbyError,
	DiscordRestApiError,
	LobbyCallTimeoutError,
} from "../utils/lobby-api.ts";
import { isUnknownLobbyError, provisionLobby } from "../utils/lobby-lifecycle.ts";
import { recordInteractionError } from "../utils/interaction-errors.ts";

/**
 * `lc:confirm` — performs the actual channel link after the warning step.
 *
 * Calls the Lobby HTTP API with the linking user's OAuth2 Bearer token
 * (needs `openid sdk.social_layer`) against the lobby where that user's
 * member record carries CanLinkLobby (1 << 0). Failed links are surfaced to
 * the user — NEVER retried in a loop — because while the app is unapproved,
 * channel linking is capped at 20 calls per 2 hours per application.
 *
 * Defers before starting: reading the lobby and the stored token and then
 * performing the link is far past Discord's 3 second first-response deadline,
 * and an unacknowledged attempt would silently do nothing.
 */
export const confirmLinkButton = {
	customId: "lc:confirm",

	handler: (async (interaction) => {
		// Ephemerality is fixed here; the editReply below must not repeat it.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const guildId = interaction.guild_id;
		const userId = interaction.member?.user?.id ?? interaction.user?.id;
		if (!guildId || !userId) {
			return interaction.editReply({ content: "❌ This only works inside a server." });
		}

		const stored = await getLobbyRecord(guildId);

		const pending = await getPendingLink(userId, guildId);
		if (!pending || pending.channelId === "") {
			return interaction.editReply({
				content: [
					"⌛ **The selected channel was forgotten** — pending picks expire after 10 minutes.",
					"Start again with **Link a channel**.",
				].join("\n"),
			});
		}

		const storedToken = await getFreshUserToken(userId);
		if (!storedToken) {
			return interaction.editReply({
				content:
					"❌ Connect your Discord account first (the app's **Connect Discord** page), then retry the link.",
			});
		}
		if (!hasSocialLayerScope(storedToken.scope)) {
			return interaction.editReply({
				content:
					"⚠️ **Reconnect required** — your Discord connection is missing the `openid sdk.social_layer` scope. Use **Reconnect Discord** on the `/linked-channel` panel, then retry.",
			});
		}

		try {
			// The lobby is a session object: Discord reaps it when it goes idle, and
			// the id stored when the panel ran can already be gone. Recover once —
			// create a fresh lobby with this admin carrying CanLinkLobby and retry
			// the link a single time. Never a loop (20 link calls / 2 h per app).
			const lobby = await linkWithLobby(guildId, stored, pending.channelId, userId, storedToken.accessToken);

			const channelMention = pending.channelName
				? `**#${pending.channelName}**`
				: `<#${pending.channelId}>`;
			// The link succeeded, so the pending pick has served its purpose.
			await clearPendingLink(userId, guildId);

			return interaction.editReply({
				content: [
					`✅ **Linked!** ${channelMention} is now linked to lobby \`${lobby.id}\`.`,
					"",
					"Lobby members can read and post in the channel from inside the game — including members who cannot see it in Discord.",
				].join("\n"),
			});
		} catch (error) {
			// A call the library never let out of the door (or a stalled
			// connection) is reported, not swallowed: this is the state that used
			// to leave the admin on "«bot» is thinking…" forever, with nothing
			// linked and nothing recorded anywhere.
			if (error instanceof LobbyCallTimeoutError) {
				console.error("[lc:confirm] link call timed out:", error.message);
				await recordInteractionError(error, "lc:confirm:link-timeout");
				return interaction.editReply({
					content: [
						"⏳ **Discord did not answer the link request.**",
						`• ${error.message}`,
						"",
						"Nothing was linked and the request was **not** retried. This is usually the development cap of **20 link calls per 2 hours** per application while the app is unapproved — wait before retrying, or check `openid sdk.social_layer` on your connection with `/api/diag`.",
					].join("\n"),
				});
			}
			// A 401 means Discord rejected the stored user token — the account
			// revoked the app (often without the deauthorization event reaching
			// us). Drop the dead record so nothing keeps claiming a connection.
			if (error instanceof DiscordRestApiError && error.status === 401) {
				console.error("[lc:confirm] stored connection was revoked:", error.body);
				await deleteUserToken(userId).catch(() => undefined);
				await recordInteractionError(error, "lc:confirm:revoked");
				return interaction.editReply({ content: REVOKED_CONNECTION_HINT });
			}
			// The one failure that is not about permissions or scopes: the
			// application-wide development cap. Say what to do about it.
			if (error instanceof DiscordRestApiError && error.status === 429) {
				console.error("[lc:confirm] link rate limited:", error.status, error.body);
				await recordInteractionError(error, "lc:confirm:rate-limited");
				return interaction.editReply({
					content: [
						"⏳ **Discord rate-limited the link (429).**",
						`• ${describeLobbyError(error)}`,
						"",
						"While the app is unapproved, channel linking is capped at **20 calls per 2 hours per application** — and the cap covers attempts, not successes. Wait for the window to reset, then try again. Nothing was linked and the request was **not** retried.",
					].join("\n"),
				});
			}
			if (error instanceof DiscordRestApiError) {
				console.error("[lc:confirm] link failed:", error.status, error.body);
				return interaction.editReply({
					content: [
						"❌ **Discord rejected the link.**",
						`• ${describeLobbyError(error)}`,
						"",
						error.status === 403
							? "403 usually means the `openid sdk.social_layer` scope is missing on your connection, or `CanLinkLobby` is not set for your lobby member, or you lack Manage Channels / View Channel / Send Messages on the channel. The request was **not** retried."
							: "Common causes: missing `sdk.social_layer` scope on your connection, missing CanLinkLobby lobby flag, lacking Manage Channels / View / Send permissions on the channel, or the development cap of **20 link calls per 2 hours** being exhausted. The request was **not** retried.",
					].join("\n"),
				});
			}
			console.error("[lc:confirm] unexpected error:", error);
			return interaction.editReply({
				content: [
					"❌ **Unexpected error while linking.** The request was **not** retried.",
					`• ${error instanceof Error ? error.message : String(error)}`,
				].join("\n"),
			});
		}
	}) satisfies ComponentHandler,
};

/**
 * Links the channel, re-creating the lobby once when the stored one is gone.
 *
 * Returns the lobby Discord answered with (which may be the fresh one). Throws
 * the original error when the re-created lobby is refused as well — at that
 * point the problem is not the lobby's lifetime, and the caller reports it.
 */
async function linkWithLobby(
	guildId: string,
	stored: LobbyRecord | null,
	channelId: string,
	userId: string,
	userToken: string,
) {
	if (stored) {
		try {
			return await linkChannelToLobby(stored.lobbyId, channelId, userToken);
		} catch (error) {
			// Anything other than an unknown lobby is a real answer from Discord
			// (permissions, scope, rate limit) and must reach the admin as-is.
			if (!isUnknownLobbyError(error)) throw error;
			console.log(`[lc:confirm] lobby ${stored.lobbyId} is unknown — re-creating it`);
		}
	}

	// Expired or never created: provision a current lobby with this admin able
	// to link, and keep the original creator able to as well.
	const fresh = await provisionLobby(guildId, [userId, ...(stored ? [stored.creatorId] : [])]);
	return await linkChannelToLobby(fresh.lobbyId, channelId, userToken);
}
