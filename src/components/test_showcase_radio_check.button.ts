import {
	CheckboxBuilder,
	CheckboxGroupBuilder,
	LabelBuilder,
	ModalBuilder,
	RadioBuilder,
} from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

/** `test_showcase_radio_check` — opens a modal with radio group, checkbox group and single checkbox. */
export const showcaseRadioCheckButton = {
	customId: "test_showcase_radio_check",

	handler: (async (interaction) => {
		const modal = new ModalBuilder()
			.setCustomId("test_showcase_radio_check_modal")
			.setTitle("Showcase: Radio & Checkbox")
			.addComponents(
				new LabelBuilder()
					.setLabel("Favorite feature")
					.setDescription("Radio group — single choice")
					.setComponent(
						new RadioBuilder()
							.setCustomId("sc_radio")
							.setRequired(true)
							.addOptions(
								{
									label: "Radio Group",
									value: "radio_group",
									description: "Single choice, 2-10 options",
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
							),
					),
				new LabelBuilder()
					.setLabel("Extras you want")
					.setDescription("Checkbox group — multi-select")
					.setComponent(
						new CheckboxGroupBuilder()
							.setCustomId("sc_checkboxes")
							.setMinValues(0)
							.setMaxValues(3)
							.setRequired(false)
							.addOptions(
								{ label: "Modals", value: "modals" },
								{ label: "Components V2", value: "components_v2" },
								{ label: "Deferred replies", value: "deferred" },
							),
					),
				new LabelBuilder()
					.setLabel("Send me a follow-up")
					.setDescription("Single checkbox")
					.setComponent(
						new CheckboxBuilder().setCustomId("sc_followup").setDefault(false),
					),
			);

		return interaction.showModal(modal);
	}) satisfies ComponentHandler,
};
