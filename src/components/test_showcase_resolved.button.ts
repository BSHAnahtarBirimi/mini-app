import {
	LabelBuilder,
	ModalBuilder,
	ModalChannelSelectMenuBuilder,
	ModalRoleSelectMenuBuilder,
	ModalUserSelectMenuBuilder,
} from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

/** `test_showcase_resolved` — opens a modal with member, role & channel select menus. */
export const showcaseResolvedButton = {
	customId: "test_showcase_resolved",

	handler: (async (interaction) => {
		const modal = new ModalBuilder()
			.setCustomId("test_showcase_resolved_modal")
			.setTitle("Showcase: Select Menus")
			.addComponents(
				new LabelBuilder()
					.setLabel("Pick members")
					.setDescription("User select — 1 to 3 members")
					.setComponent(
						new ModalUserSelectMenuBuilder()
							.setCustomId("sc_user")
							.setPlaceholder("Select members...")
							.setMinValues(1)
							.setMaxValues(3)
							.setRequired(true),
					),
				new LabelBuilder()
					.setLabel("Pick roles")
					.setDescription("Role select — 0 to 2 roles")
					.setComponent(
						new ModalRoleSelectMenuBuilder()
							.setCustomId("sc_role")
							.setPlaceholder("Select roles...")
							.setMinValues(0)
							.setMaxValues(2)
							.setRequired(false),
					),
				new LabelBuilder()
					.setLabel("Pick channels")
					.setDescription("Channel select — 0 to 2 channels")
					.setComponent(
						new ModalChannelSelectMenuBuilder()
							.setCustomId("sc_channel")
							.setPlaceholder("Select channels...")
							.setMinValues(0)
							.setMaxValues(2)
							.setRequired(false),
					),
			);

		return interaction.showModal(modal);
	}) satisfies ComponentHandler,
};
