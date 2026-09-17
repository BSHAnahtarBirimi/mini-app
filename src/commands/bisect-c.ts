import { CheckboxGroupBuilder, CommandBuilder, LabelBuilder, ModalBuilder } from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

/** `/checkbox` — bisect C: single Label + CheckboxGroup only. */
export const checkboxCommand = {
	data: new CommandBuilder().setName("checkbox").setDescription("Bisect: single CheckboxGroup modal"),

	handler: (async (interaction) => {
		const modal = new ModalBuilder()
			.setCustomId("checkbox_test_modal")
			.setTitle("Checkbox Test")
			.addComponents(
				new LabelBuilder().setLabel("Pick any").setComponent(
					new CheckboxGroupBuilder()
						.setCustomId("cb_group")
						.setMinValues(0)
						.setMaxValues(2)
						.addOptions(
							{ label: "One", value: "1" },
							{ label: "Two", value: "2" },
						),
				),
			);

		return interaction.showModal(modal);
	}) satisfies SlashCommandHandler,
};
