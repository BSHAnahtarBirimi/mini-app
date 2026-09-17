import { ModalBuilder } from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

/**
 * `test_showcase_legacy` — opens the classic ActionRow + TextInput modal (no Label).
 * The legacy format requires a `label` field on the TextInput itself, which
 * TextInputBuilder does not expose, so the component is written raw.
 */
export const showcaseLegacyButton = {
	customId: "test_showcase_legacy",

	handler: (async (interaction) => {
		const modal = new ModalBuilder()
			.setCustomId("test_showcase_legacy_modal")
			.setTitle("Showcase: Legacy ActionRow")
			.addComponents({
				type: 1,
				components: [
					{
						type: 4,
						custom_id: "sc_legacy_text",
						style: 1,
						label: "Legacy input",
						min_length: 1,
						max_length: 100,
						required: true,
						placeholder: "Type something...",
					},
				],
			});

		return interaction.showModal(modal);
	}) satisfies ComponentHandler,
};
