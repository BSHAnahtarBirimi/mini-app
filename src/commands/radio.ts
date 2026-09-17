import { CommandBuilder, LabelBuilder, ModalBuilder, RadioBuilder } from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

/** `/radio` — minimal isolation test: one Label + one RadioGroup, nothing else. */
export const radioCommand = {
	data: new CommandBuilder().setName("radio").setDescription("Isolation test: single RadioGroup modal"),

	handler: (async (interaction) => {
		const modal = new ModalBuilder()
			.setCustomId("radio_test_modal")
			.setTitle("Radio Test")
			.addComponents(
				new LabelBuilder().setLabel("Pick one").setComponent(
					new RadioBuilder()
						.setCustomId("radio_choice")
						.setRequired(true)
						.addOptions(
							{ label: "Option A", value: "a" },
							{ label: "Option B", value: "b" },
						),
				),
			);

		return interaction.showModal(modal);
	}) satisfies SlashCommandHandler,
};
