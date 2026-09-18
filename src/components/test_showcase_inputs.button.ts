import {
	LabelBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

/** `test_showcase_inputs` — opens a modal with paragraph + short text inputs. */
export const showcaseInputsButton = {
	customId: "test_showcase_inputs",

	handler: (async (interaction) => {
		const modal = new ModalBuilder()
			.setCustomId("test_showcase_inputs_modal")
			.setTitle("Showcase: Text Inputs")
			.addComponents(
				new LabelBuilder()
					.setLabel("Short input")
					.setDescription("TextInputStyle.Short — single line, max 50 chars")
					.setComponent(
						new TextInputBuilder()
							.setCustomId("sc_short")
							.setStyle(TextInputStyle.Short)
							.setRequired(true)
							.setMaxLength(50)
							.setPlaceholder("Single-line text..."),
					),
				new LabelBuilder()
					.setLabel("Paragraph input")
					.setDescription("TextInputStyle.Paragraph — multi-line, max 300 chars")
					.setComponent(
						new TextInputBuilder()
							.setCustomId("sc_paragraph")
							.setStyle(TextInputStyle.Paragraph)
							.setRequired(false)
							.setMaxLength(300)
							.setPlaceholder("Multi-line text..."),
					),
			);

		return interaction.showModal(modal);
	}) satisfies ComponentHandler,
};
