import { CommandBuilder, LabelBuilder, ModalBuilder, ModalUserSelectMenuBuilder } from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

/** `/usersel` — minimal isolation test: one Label + one UserSelect, nothing else. */
export const userselCommand = {
	data: new CommandBuilder().setName("usersel").setDescription("Isolation test: single UserSelect modal"),

	handler: (async (interaction) => {
		const modal = new ModalBuilder()
			.setCustomId("usersel_test_modal")
			.setTitle("User Select Test")
			.addComponents(
				new LabelBuilder().setLabel("Pick a user").setComponent(
					new ModalUserSelectMenuBuilder()
						.setCustomId("user_choice")
						.setPlaceholder("Select...")
						.setMinValues(1)
						.setMaxValues(1)
						.setRequired(true),
				),
			);

		return interaction.showModal(modal);
	}) satisfies SlashCommandHandler,
};
