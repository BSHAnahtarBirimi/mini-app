import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

type LegacyTextInputRow = {
	type: 4;
	custom_id: string;
	style: number;
	label?: string;
	min_length?: number;
	max_length?: number;
	required?: boolean;
	value?: string;
	placeholder?: string;
};

/** `test_showcase_legacy` — opens the classic ActionRow + TextInput modal (no Label). */
export const showcaseLegacyButton = {
	customId: "test_showcase_legacy",

	handler: (async (interaction) => {
		const modal = new ModalBuilder()
			.setCustomId("test_showcase_legacy_modal")
			.setTitle("Showcase: Legacy ActionRow")
			.addComponents(
				new ActionRowBuilder<LegacyTextInputRow>().addComponents(
					new TextInputBuilder()
						.setCustomId("sc_legacy_text")
						.setStyle(TextInputStyle.Short)
						.setRequired(true)
						.setMaxLength(100)
						.setPlaceholder("Legacy input..."),
				),
			);

		return interaction.showModal(modal);
	}) satisfies ComponentHandler,
};
