import { CommandBuilder, FileUploadBuilder, LabelBuilder, ModalBuilder } from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

/** `/upload` — minimal isolation test: one Label + one FileUpload, nothing else. */
export const uploadCommand = {
	data: new CommandBuilder().setName("upload").setDescription("Isolation test: single FileUpload modal"),

	handler: (async (interaction) => {
		const modal = new ModalBuilder()
			.setCustomId("upload_test_modal")
			.setTitle("Upload Test")
			.addComponents(
				new LabelBuilder().setLabel("Attach a file").setComponent(
					new FileUploadBuilder().setCustomId("file_choice").setMinValues(0).setMaxValues(1),
				),
			);

		return interaction.showModal(modal);
	}) satisfies SlashCommandHandler,
};
