import { FileUploadBuilder, LabelBuilder, ModalBuilder } from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

/** `test_showcase_upload` — opens a modal with a file upload component. */
export const showcaseUploadButton = {
	customId: "test_showcase_upload",

	handler: (async (interaction) => {
		const modal = new ModalBuilder()
			.setCustomId("test_showcase_upload_modal")
			.setTitle("Showcase: File Upload")
			.addComponents(
				new LabelBuilder()
					.setLabel("Attach a file")
					.setDescription("File upload (type 19) — modal-only")
					.setComponent(
						new FileUploadBuilder()
							.setCustomId("sc_upload")
							.setMinValues(0)
							.setMaxValues(3)
							.setRequired(false),
					),
			);

		return interaction.showModal(modal);
	}) satisfies ComponentHandler,
};
