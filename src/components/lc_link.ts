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
 */
export const linkButton = {
	customId: "lc:link",

	handler: (async (interaction) => {
		const guildId = interaction.guild_id;
		const userId = interaction.member?.user?.id ?? interaction.user?.id;

		if (!guildId || !userId) {
			return interaction.reply({
				content: "❌ This only works inside a server.",
				flags: MessageFlags.Ephemeral,
			});
		}

		const record = await getLobbyRecord(guildId);
		if (!record) {
			return interaction.reply({
				content: "❌ No lobby found for this server. Run `/linked-channel` first.",
				flags: MessageFlags.Ephemeral,
			});
		}

		// Fast scope pre-flight: warn before the user browses channels if the
		// stored token lacks sdk.social_layer (linking would 403 anyway).
		const storedToken = await getFreshUserToken(userId);
		if (!storedToken || !hasSocialLayerScope(storedToken.scope)) {
			return interaction.reply({
				content:
					"⚠️ **Reconnect required** — channel linking needs a Discord connection with the `openid sdk.social_layer` scope. Use **Reconnect Discord** on the `/linked-channel` panel first.",
				flags: MessageFlags.Ephemeral,
			});
		}

		const botToken = process.env.DISCORD_BOT_TOKEN;
		if (!botToken) {
			return interaction.reply({
				content: "❌ Missing DISCORD_BOT_TOKEN environment variable.",
				flags: MessageFlags.Ephemeral,
			});
		}

		let channels;
		try {
			channels = await listGuildChannelsForMenu(guildId);
		} catch (error) {
			console.error("[lc:link] channel listing failed:", error);
			return interaction.reply({
				content: "❌ Could not list this server's channels. Please try again later.",
				flags: MessageFlags.Ephemeral,
			});
		}

		if (channels.length === 0) {
			return interaction.reply({
				content: "❌ No text channels available to link in this server.",
				flags: MessageFlags.Ephemeral,
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

		return interaction.reply({
			flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
			components: [container],
		});
	}) satisfies ComponentHandler,
};
