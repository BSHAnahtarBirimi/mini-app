import { CommandBuilder, MessageFlags } from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

import {
	DATABASE_NOT_CONFIGURED_MESSAGE,
	hasDatabaseConfig,
} from "../utils/database.ts";
import { getLobbyRecord } from "../utils/lobby-store.ts";
import { describeLobbyError, DiscordRestApiError } from "../utils/lobby-api.ts";
import { provisionLobby } from "../utils/lobby-lifecycle.ts";
import { hasSocialLayerScope, buildSocialSdkOAuthUrl } from "../utils/lobby-oauth.ts";
import { getFreshUserToken } from "../utils/lobby-tokens.ts";
import { buildPanelPayloads } from "../utils/linked-channel-panel.ts";
import { describeError, recordInteractionError } from "../utils/interaction-errors.ts";

/**
 * `/linked-channel` — Linked Channels example flow.
 *
 * Panel → "Link a channel" → text-channel select → (warning if not provably
 * public) → link. Uses the Discord Social SDK Lobby HTTP API:
 *
 * - Linking REQUIRES a USER OAuth2 Bearer token with the `openid
 *   sdk.social_layer` scope (limited access — needs a Social SDK access
 *   request from Discord). The stored token's scope is checked and a
 *   "Reconnect Discord" button is shown when it is missing.
 * - The linking user's lobby member record must have the CanLinkLobby flag
 *   (`1 << 0`); it is set on lobby creation. Without it a member cannot link
 *   or unlink.
 * - Channel linking is capped at 20 calls per 2 hours per application while
 *   the app is unapproved — failed links are shown to the user, never retried
 *   in a loop.
 */
export const linkedChannelCommand = {
	data: new CommandBuilder()
		.setName("linked-channel")
		.setDescription("Manage the Discord channel linked to this server's lobby"),

	handler: (async (interaction) => {
		/*
		 * Acknowledge before doing any work.
		 *
		 * Discord invalidates the interaction token unless the FIRST response
		 * arrives within 3 seconds, and this handler cannot answer before it
		 * has done several sequential round-trips: read the lobby (Mongo),
		 * maybe create it (Discord REST), store it (Mongo), then read the
		 * caller's stored token (Mongo) — plus a token refresh when it has
		 * expired. Missing that deadline makes the client report "The
		 * application did not respond" while the lobby has already been
		 * created, so the panel never shows. Deferring costs one fast call and
		 * buys the full function timeout for the rest.
		 *
		 * Ephemerality has to be set here: the later `editReply` edits the
		 * deferred message and must NOT pass `MessageFlags.Ephemeral`.
		 */
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const guildId = interaction.guild_id;
		const userId = interaction.member?.user?.id ?? interaction.user?.id;

		try {
			if (!guildId || !userId) {
				return await interaction.editReply({
					content: "❌ This command only works inside a server.",
				});
			}

			// Lobby links and user tokens live in MiniDatabase; without it every
			// later step would silently look "unlinked".
			if (!hasDatabaseConfig()) {
				return await interaction.editReply({ content: DATABASE_NOT_CONFIGURED_MESSAGE });
			}

			// Auto-provision: create the lobby once per guild with the invoking
			// admin as a member carrying CanLinkLobby (1 << 0). Without that
			// flag a member can neither link nor unlink channels. Lobbies are
			// session objects, so an expired one is replaced on use rather than
			// being trusted (see lobby-lifecycle.ts).
			let record = await getLobbyRecord(guildId);
			if (!record) {
				const applicationId = process.env.DISCORD_APPLICATION_ID;
				const botToken = process.env.DISCORD_BOT_TOKEN;
				if (!applicationId || !botToken) {
					return await interaction.editReply({
						content: "❌ Missing DISCORD_APPLICATION_ID / DISCORD_BOT_TOKEN environment variables.",
					});
				}
				try {
					record = await provisionLobby(guildId, [userId]);
				} catch (error) {
					console.error("[linked-channel] lobby creation failed:", error);
					await recordInteractionError(error, "linked-channel:create-lobby");
					return await interaction.editReply({
						content: [
							"❌ **Could not create the lobby.**",
							error instanceof DiscordRestApiError ? `• ${describeLobbyError(error)}` : "",
							"Creating lobbies needs the bot token and an application enabled for the Social SDK.",
						]
							.filter(Boolean)
							.join("\n"),
					});
				}
			}

			// Scope check on the invoking admin's stored token: channel linking
			// needs a USER OAuth2 Bearer token carrying `sdk.social_layer` — the
			// app's legacy connect flow (applications.commands identify guilds
			// role_connections.write) is not enough, so linking would 403.
			const storedToken = await getFreshUserToken(userId);
			let reconnectUrl: string | null = null;
			if (!storedToken || !hasSocialLayerScope(storedToken.scope)) {
				const clientId = process.env.DISCORD_APPLICATION_ID;
				const secret = process.env.DISCORD_CLIENT_SECRET;
				const redirectUri = process.env.DISCORD_REDIRECT_URI;
				if (clientId && secret && redirectUri) {
					reconnectUrl = buildSocialSdkOAuthUrl({
						clientId,
						clientSecret: secret,
						redirectUri,
					});
				}
			}

			// Both forms are built here, *before* the edit: a payload the library's
			// builders refuse throws while it is constructed, and that throw used
			// to happen after the deferral — which is exactly the
			// "«bot» is thinking…" state with nothing in the logs but a
			// console.error. Constructing both up front makes that failure
			// visible (recorded below) instead of silent.
			const payloads = buildPanelPayloads({ lobbyId: record.lobbyId, reconnectUrl });

			try {
				// Ephemerality was fixed by the deferral above; only the
				// Components V2 flag belongs here.
				return await interaction.editReply(payloads.v2);
			} catch (error) {
				// An edit of the deferred message can still be refused (the V2
				// flag describes how a message was created). Without this
				// fallback the interaction would stay on "«bot» is thinking…"
				// forever, so send the equivalent legacy payload and record what
				// was refused.
				console.error("[linked-channel] V2 panel rejected:", error);
				await recordInteractionError(error, "linked-channel:panel-v2");
				return await interaction.editReply(payloads.legacy);
			}
		} catch (error) {
			// Never leave the deferred message unanswered: a visible error beats
			// an eternal "thinking…" state.
			console.error("[linked-channel] handler failed:", error);
			await recordInteractionError(error, "linked-channel");
			return await interaction
				.editReply({ content: `❌ **\`/linked-channel\` failed.**\n• ${describeError(error)}` })
				.catch(() => undefined);
		}
	}) satisfies SlashCommandHandler,
};
