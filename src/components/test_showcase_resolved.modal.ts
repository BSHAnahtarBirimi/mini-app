import {
	LabelBuilder,
	ModalBuilder,
	ModalRoleSelectMenuBuilder,
	ModalUserSelectMenuBuilder,
} from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

/** `test_showcase_resolved` — opens a modal with user & role select menus (resolved data). */
export const showcaseResolvedButton = {
	customId: "test_showcase_resolved",

	handler: (async (interaction) => {
		const modal = new ModalBuilder()
			.setCustomId("test_showcase_resolved_modal")
			.setTitle("Showcase: Resolved Data")
			.addComponents(
				new LabelBuilder()
					.setLabel("Mention a user")
					.setDescription("User select menu — resolves to user object")
					.setComponent(
						new ModalUserSelectMenuBuilder()
							.setCustomId("sc_user")
							.setPlaceholder("Select a user")
							.setMinValues(1)
							.setMaxValues(3)
							.setRequired(true),
					),
				new LabelBuilder()
					.setLabel("Pick a role")
					.setDescription("Role select menu — resolves to role object")
					.setComponent(
						new ModalRoleSelectMenuBuilder()
							.setCustomId("sc_role")
							.setPlaceholder("Select a role")
							.setMinValues(0)
							.setMaxValues(2),
					),
			);

		return interaction.showModal(modal);
	}) satisfies ComponentHandler,
};
