import {
	LabelBuilder,
	ModalBuilder,
	ModalStringSelectMenuBuilder,
} from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

/** `ping_button` — opens a modal with a modal-side string select menu. */
export const pingButton = {
	customId: "ping_button",

	handler: (async (interaction) => {
		const modal = new ModalBuilder()
			.setCustomId("ping_modal")
			.setTitle("Mini-Interaction Test")
			.addComponents(
				new LabelBuilder()
					.setLabel("Select an option")
					.setDescription("Say hi or hello")
					.setComponent(
						new ModalStringSelectMenuBuilder()
							.setCustomId("ping_menu_modal")
							.setPlaceholder("Select an option")
							.setMinValues(1)
							.setMaxValues(2)
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
