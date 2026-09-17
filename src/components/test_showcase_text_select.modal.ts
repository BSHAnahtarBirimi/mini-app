import {
	LabelBuilder,
	ModalBuilder,
	ModalStringSelectMenuBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

/** `test_showcase_text_select` — opens a modal with text input + string select menu. */
export const showcaseTextSelectButton = {
	customId: "test_showcase_text_select",

	handler: (async (interaction) => {
		const modal = new ModalBuilder()
			.setCustomId("test_showcase_text_select_modal")
			.setTitle("Showcase: Text & Select")
			.addComponents(
				new LabelBuilder()
					.setLabel("Your message")
					.setDescription("Text input (short style)")
					.setComponent(
						new TextInputBuilder()
							.setCustomId("sc_text")
							.setStyle(TextInputStyle.Short)
							.setRequired(true)
							.setMaxLength(100)
							.setPlaceholder("Type something..."),
					),
				new LabelBuilder()
					.setLabel("Pick a flavor")
					.setDescription("String select menu (modal variant)")
					.setComponent(
						new ModalStringSelectMenuBuilder()
							.setCustomId("sc_select")
							.setPlaceholder("Select an option")
							.setMinValues(1)
							.setMaxValues(2)
							.setRequired(true)
							.addOptions(
								{
									label: "Hello",
									description: "This is hello",
									value: "value_hello",
								},
								{
									label: "Hi",
									description: "This is hi",
									value: "value_hi",
								},
							),
					),
			);

		return interaction.showModal(modal);
	}) satisfies ComponentHandler,
};
