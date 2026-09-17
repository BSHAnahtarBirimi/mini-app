import type { ComponentHandler } from "@minesa-org/mini-interaction";

/** `test_channel_select` — channel select menu that replies with resolved channels. */
export const channelSelect = {
	customId: "test_channel_select",

	handler: (async (interaction) => {
		const channels = interaction.getChannels();
		const mentions = channels.map((c) => `<#${c.id}>`).join(", ") || "—";

		return interaction.reply({
			content: `**💬 Channel select** — you picked: ${mentions}`,
		});
	}) satisfies ComponentHandler,
};
