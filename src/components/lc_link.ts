import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	MessageFlags,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
} from "@minesa-org/mini-interaction";
import type { MessageActionRowComponent } from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

import { getLobbyRecord } from "../utils/lobby-store.ts";
import { listGuildChannelsForMenu, buildChannelMenuOptions } from "../utils/lobby-channels.ts";
import { hasSocialLayerScope } from "../utils/lobby-oauth.ts";
import { getFreshUserToken } from "../utils/lobby-tokens.ts";

/**
 * `lc:link` — shows the channel select menu for linking.
 *
 * Discord's channel select menu has no per-option labels, so we fetch the
 * guild's channels with the BOT token and present a labelled StringSelect
 * instead (privacy badges computed from permission_overwrites). The
 * post-selection warning step (lc:pick) remains the safety net.
 *
 * The handler defers first: a lobby read plus two Discord calls do not reliably
 * fit inside Discord's 3 second first-response deadline, and a late response
 * makes the button appear to do nothing at all.
 */
export const linkButton = {
	customId: "lc:link",

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
				content: "❌ No lobby found for this server. Run `/linked-channel` first.",
			});
		}

		// Fast scope pre-flight: warn before the user browses channels if the
		// stored token lacks sdk.social_layer (linking would 403 anyway).
		const storedToken = await getFreshUserToken(userId);
		if (!storedToken || !hasSocialLayerScope(storedToken.scope)) {
			return interaction.editReply({
				content:
					"⚠️ **Reconnect required** — channel linking needs a Discord connection with the `openid sdk.social_layer` scope. Use **Reconnect Discord** on the `/linked-channel` panel first.",
			});
		}

		const botToken = process.env.DISCORD_BOT_TOKEN;
		if (!botToken) {
			return interaction.editReply({
				content: "❌ Missing DISCORD_BOT_TOKEN environment variable.",
			});
		}

		let channels;
		try {
			channels = await listGuildChannelsForMenu(guildId);
		} catch (error) {
			console.error("[lc:link] channel listing failed:", error);
			return interaction.editReply({
				content: "❌ Could not list this server's channels. Please try again later.",
			});
		}

		if (channels.length === 0) {
			return interaction.editReply({
				content: "❌ No text channels available to link in this server.",
			});
		}

		const container = new ContainerBuilder().setAccentColor(0x5865f2);
		container.addComponent(
			new SectionBuilder().addComponent(
				new TextDisplayBuilder().setContent(
					[
						"### 🔗 Link a channel",
						`Pick the text channel to link to lobby \`${record.lobbyId}\`.`,
						"Lobby members will be able to read **and post** in it",
						"from inside the game.",
					].join("\n"),
				),
			),
		);
		container.addComponent(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
		container.addComponent(
			new TextDisplayBuilder().setContent(
				"✅ provably public · 🔒 private · ❓ unknown — **every** pick gets a final confirmation step.",
			),
		);
		container.addComponent(
			new ActionRowBuilder<MessageActionRowComponent>().addComponents(
				new StringSelectMenuBuilder()
					.setCustomId("lc:pick")
					.setPlaceholder("Select a text channel to link…")
					.setMinValues(1)
					.setMaxValues(1)
					.addOptions(...buildChannelMenuOptions(channels)),
			),
		);
		container.addComponent(
			new ActionRowBuilder<MessageActionRowComponent>().addComponents(
				new ButtonBuilder().setStyle(ButtonStyle.Secondary).setCustomId("lc:cancel").setLabel("Cancel"),
			),
		);

		// Components V2 must be flagged explicitly on an edit: the deferred-edit
		// path does not infer the flag when re-sending the payload.
		return interaction.editReply({
			flags: MessageFlags.IsComponentsV2,
			components: [container],
		});
	}) satisfies ComponentHandler,
};
