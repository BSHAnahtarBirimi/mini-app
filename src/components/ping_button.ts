import {
	CheckboxBuilder,
	CheckboxGroupBuilder,
	FileUploadBuilder,
	LabelBuilder,
	ModalBuilder,
	RadioBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

/** `ping_button` — opens a showcase modal with every modal component mini-interaction supports. */
export const pingButton = {
	customId: "ping_button",

	handler: (async (interaction) => {
		const modal = new ModalBuilder()
			.setCustomId("ping_modal")
			.setTitle("Mini-Interaction Showcase")
			.addComponents(
				new LabelBuilder()
					.setLabel("Favorite feature")
					.setDescription("Pick one — radio group (modal-only, type 21)")
					.setComponent(
						new RadioBuilder()
							.setCustomId("ping_radio")
							.setRequired(true)
							.addOptions(
								{
									label: "Radio Group",
									value: "radio_group",
									description: "Single choice, up to 10 options",
								},
								{
									label: "Checkbox Group",
									value: "checkbox_group",
									description: "Multi-select in modals",
								},
								{
									label: "File Upload",
									value: "file_upload",
									description: "Attach files from a modal",
								},
								{
									label: "Select Menus",
									value: "select_menus",
									description: "String, user, role, channel, mentionable",
								},
							),
					),
				new LabelBuilder()
					.setLabel("Extras you want")
					.setDescription("Pick any — checkbox group (modal-only, type 22)")
					.setComponent(
						new CheckboxGroupBuilder()
							.setCustomId("ping_checkboxes")
							.setMinValues(0)
							.setMaxValues(3)
							.addOptions(
								{ label: "Modals", value: "modals" },
								{ label: "Components V2", value: "components_v2" },
								{ label: "Deferred replies", value: "deferred" },
							),
					),
				new LabelBuilder()
					.setLabel("Send me a follow-up")
					.setDescription("Single checkbox (modal-only, type 23)")
					.setComponent(
						new CheckboxBuilder().setCustomId("ping_followup").setDefault(false),
					),
				new LabelBuilder()
					.setLabel("Anything to add?")
					.setDescription("Classic text input")
					.setComponent(
						new TextInputBuilder()
							.setCustomId("ping_notes")
							.setStyle(TextInputStyle.Paragraph)
							.setRequired(false)
							.setMaxLength(200)
							.setPlaceholder("Optional notes..."),
					),
				new LabelBuilder()
					.setLabel("Attach a file")
					.setDescription("File upload (modal-only, type 19)")
					.setComponent(
						new FileUploadBuilder()
							.setCustomId("ping_upload")
							.setMinValues(0)
							.setMaxValues(1),
					),
			);

		return interaction.showModal(modal);
	}) satisfies ComponentHandler,
};
