import { CommandBuilder, LabelBuilder, ModalBuilder, RadioBuilder } from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

/** `/desc` — bisect A: single Label WITH description + RadioGroup. */
export const descCommand = {
	data: new CommandBuilder().setName("desc").setDescription("Bisect: Label description field test"),

	handler: (async (interaction) => {
		const modal = new ModalBuilder()
			.setCustomId("desc_test_modal")
			.setTitle("Desc Test")
			.addComponents(
				new LabelBuilder()
					.setLabel("Pick one")
					.setDescription("This label has a description")
					.setComponent(
						new RadioBuilder()
							.setCustomId("desc_radio")
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
