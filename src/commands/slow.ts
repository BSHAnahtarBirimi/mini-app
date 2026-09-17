import { CommandBuilder } from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `/slow` — defers immediately, waits 4s, then edits the reply. */
export const slowCommand = {
	data: new CommandBuilder()
		.setName("slow")
		.setDescription("Tests deferred interactions (takes ~4 seconds)"),

	handler: (async (interaction) => {
		await interaction.deferReply();

		await sleep(4000);

		return interaction.editReply({
			content: "✅ Deferred interaction completed! Took ~4s.",
		});
	}) satisfies SlashCommandHandler,
};
