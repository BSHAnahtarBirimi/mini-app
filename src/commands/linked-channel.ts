import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	CommandBuilder,
	ContainerBuilder,
	LobbyMemberFlags,
	MessageFlags,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
} from "@minesa-org/mini-interaction";
import type { MessageActionRowComponent } from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

import { db } from "../utils/database.js";
import { getLobbyRecord, setLobbyRecord, deleteLobbyRecord } from "../utils/lobby-store.js";
import { createLobby } from "../utils/lobby-api.js";
import { hasSocialLayerScope, buildSocialSdkOAuthUrl } from "../utils/lobby-oauth.js";
import { getStoredUserToken } from "../utils/lobby-tokens.js";

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
		const guildId = interaction.guild_id;
		const userId = interaction.member?.user?.id ?? interaction.user?.id;
		if (!guildId || !userId) {
			return interaction.reply({
				content: "❌ This command only works inside a server.",
				flags: MessageFlags.Ephemeral,
			});
		}

		// Auto-provision: create the lobby once per guild with the invoking
		// admin as a member carrying CanLinkLobby (1 << 0). Without that flag a
		// member can neither link nor unlink channels.
		let record = await getLobbyRecord(db, guildId);
		if (!record) {
			const applicationId = process.env.DISCORD_APPLICATION_ID;
			const botToken = process.env.DISCORD_BOT_TOKEN;
			if (!applicationId || !botToken) {
				return interaction.reply({
					content: "❌ Missing DISCORD_APPLICATION_ID / DISCORD_BOT_TOKEN environment variables.",
					flags: MessageFlags.Ephemeral,
				});
			}
			try {
				const lobby = await createLobby([
					{ id: userId, flags: LobbyMemberFlags.CanLinkLobby },
				]);
				record = {
					lobbyId: lobby.id,
					creatorId: userId,
					createdAt: new Date().toISOString(),
				};
				await setLobbyRecord(db, guildId, record);
			} catch (error) {
				console.error("[linked-channel] lobby creation failed:", error);
				return interaction.reply({
					content: "❌ Could not create the lobby. Please try again later.",
					flags: MessageFlags.Ephemeral,
				});
			}
		}

		// Scope check on the invoking admin's stored token: channel linking
		// needs a USER OAuth2 Bearer token carrying `sdk.social_layer` — the
		// app's legacy connect flow (applications.commands identify guilds
		// role_connections.write) is not enough, so linking would 403.
		const storedToken = await getStoredUserToken(db, userId);
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

		const container = new ContainerBuilder().setAccentColor(0x57f287);

		container.addComponent(
			new SectionBuilder().addComponent(
				new TextDisplayBuilder().setContent(
					[
						"## 🔗 Linked Channels",
						"Connect this server's game lobby to a text channel —",
						"lobby members can read **and post** messages in the",
						"linked channel from inside the game.",
					].join("\n"),
				),
			),
		);
		container.addComponent(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

		// Scope warning + one-click "Reconnect Discord" authorize URL
		// (openid sdk.social_layer). sdk.social_layer is LIMITED ACCESS and
		// requires a Social SDK access request from Discord; until the app is
		// approved, channel linking is also capped at 20 calls / 2 h per app.
		if (reconnectUrl) {
			container.addComponent(
				new SectionBuilder()
					.addComponent(
						new TextDisplayBuilder().setContent(
							[
								"### ⚠️ Reconnect required",
								"Channel linking needs a Discord connection with the",
								"**Social SDK** scope (`openid sdk.social_layer`). Your",
								"current connection is missing it — reconnect below,",
								"otherwise linking will fail.",
							].join("\n"),
						),
					)
					.setAccessory(
						new ButtonBuilder()
							.setStyle(ButtonStyle.Link)
							.setLabel("🔁 Reconnect Discord")
							.setURL(reconnectUrl),
					),
				);
			container.addComponent(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
			);
		}

		// Status line + manage section
		const statusLine = `**Lobby:** \`${record.lobbyId}\``;
		container.addComponent(
			new SectionBuilder()
				.addComponent(
					new TextDisplayBuilder().setContent(
						[
							"### 🛠️ Manage the link",
							statusLine,
							"Linking requires Manage Channels, View Channel and Send",
							"Messages permissions on the chosen channel.",
						].join("\n"),
					),
				),
		);
		container.addComponent(
			new ActionRowBuilder<MessageActionRowComponent>().addComponents(
				new ButtonBuilder()
					.setStyle(ButtonStyle.Success)
					.setCustomId("lc:link")
					.setLabel("🔗 Link a channel"),
				new ButtonBuilder()
					.setStyle(ButtonStyle.Danger)
					.setCustomId("lc:unlink")
					.setLabel("✖️ Unlink"),
			),
		);

		container.addComponent(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

		container.addComponent(
			new TextDisplayBuilder().setContent(
				[
					"### 💬 Community",
					"Join our Discord server to meet other players.",
				].join("\n"),
			),
		);
		container.addComponent(
			new ActionRowBuilder<MessageActionRowComponent>().addComponents(
				new ButtonBuilder()
					.setStyle(ButtonStyle.Primary)
					.setCustomId("lc:join")
					.setLabel("🏠 Join Discord server"),
			),
		);

		return interaction.reply({
			flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
			components: [container],
		});
	}) satisfies SlashCommandHandler,
};
