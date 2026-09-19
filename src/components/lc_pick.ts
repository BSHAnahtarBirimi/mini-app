import { ChannelType, MessageFlags } from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

import { getLobbyRecord } from "../utils/lobby-store.js";
import { setPendingLink } from "../utils/linked-channel-state.js";
import { classifyChannelPrivacy } from "../utils/channel-privacy.js";
import type { ChannelPrivacy, ChannelOverwrite } from "../utils/channel-privacy.js";

/**
 * `lc:pick` — channel select handler. Stores the pick and shows the WARNING
 * step before linking. This step is mandatory for every pick — a channel is
 * only linked after an explicit "Link anyway" (lc:confirm). Never links
 * silently.
 *
 * The warning must convey, in substance:
 * - everyone in the lobby will be able to READ AND POST in this channel from
 *   inside the game, even members who cannot see it in Discord;
 * - any lobby member can generate a server invite, and server admins cannot
 *   restrict that.
 */
export const pickChannelSelect = {
	customId: "lc:pick",

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

		const channelId = interaction.values?.[0];
		if (!channelId) {
			return interaction.reply({
				content: "❌ No channel selected.",
				flags: MessageFlags.Ephemeral,
			});
		}

		// The resolved channel object carries the guild id again.
		const resolved = interaction
			.getChannels()
			.find((channel) => channel.id === channelId);
		const channelName = resolved?.name ?? undefined;

		// Privacy was computed from permission_overwrites when the menu was
		// built; the resolved payload here only exposes permission_overwrites
		// inconsistently, so re-classify when possible.
		let privacy: ChannelPrivacy = "unknown";
		const maybeOverwrites = (resolved as { permission_overwrites?: unknown } | undefined)
			?.permission_overwrites;
		if (resolved && Array.isArray(maybeOverwrites)) {
			privacy = classifyChannelPrivacy(
				{
					type: ChannelType.GuildText,
					permission_overwrites: maybeOverwrites as ChannelOverwrite[],
				},
				guildId,
			);
		}

		// Persisted rather than kept in memory: the "Link anyway" press is often
		// served by a different serverless instance than this select.
		await setPendingLink(userId, guildId, {
			channelId,
			channelName,
			privacy,
		});

		const mention = channelName ? `**#${channelName}**` : `<#${channelId}>`;

		return interaction.reply({
			content: [
				"## ⚠️ Warning: Link this channel?",
				`You are about to link ${mention} to this lobby.`,
				"",
				"**After linking, everyone in the lobby will be able to read AND post messages in this channel from inside the game — including members who cannot see the channel in Discord.**",
				"Linking bypasses the channel's Discord permissions for lobby members.",
				"",
				"Additionally, **any lobby member will be able to generate a server invite** to this server, and **server admins cannot restrict that**. Only link channels in servers you trust your players to join.",
				"",
				privacy === "public"
					? "✅ This channel looks provably public based on its Discord permissions."
					: privacy === "private"
						? "🔒 This channel looks **private** based on its Discord permissions."
						: "❓ This channel's privacy could not be determined from its Discord permissions.",
				"",
				"Link anyway?",
			].join("\n"),
			components: [
				{
					type: 1,
					components: [
						{
							type: 2,
							style: 3,
							custom_id: "lc:confirm",
							label: "🔗 Link anyway",
						},
						{
							type: 2,
							style: 4,
							custom_id: "lc:cancel",
							label: "Cancel",
						},
					],
				},
			],
			flags: MessageFlags.Ephemeral,
		});
	}) satisfies ComponentHandler,
};
