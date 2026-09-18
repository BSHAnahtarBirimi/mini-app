import { CommandBuilder } from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

/**
 * `/echo` — demonstrates the v0.6+ wrapped interaction option resolver.
 * Handlers receive typed interactions with option resolvers and reply methods.
 */
export const echoCommand = {
	data: new CommandBuilder()
		.setName("echo")
		.setDescription("Echoes your text back")
		.addStringOption((option) =>
			option
				.setName("text")
				.setDescription("What should I say?")
				.setRequired(true),
		),

	handler: (async (interaction) => {
		const text = interaction.options.getString("text", true);

		return interaction.reply({
			content: `🔊 ${text}`,
		});
	}) satisfies SlashCommandHandler,
};
