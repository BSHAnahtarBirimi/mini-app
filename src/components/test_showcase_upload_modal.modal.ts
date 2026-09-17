import type { ModalHandler } from "@minesa-org/mini-interaction";

/** `test_showcase_upload_modal` — reads uploaded attachments and previews them. */
export const showcaseUploadModal = {
	customId: "test_showcase_upload_modal",

	handler: (async (interaction) => {
		const uploads = interaction.getFileUploadValues("sc_upload");
		const attachment = interaction.getAttachment("sc_upload");

		const lines = ["**📎 Upload showcase**"];

		if (!uploads.length) {
			lines.push("No files were uploaded.");
		} else {
			lines.push(`**Uploaded:** ${uploads.length} file(s)`);
			if (attachment) {
				lines.push(
					`**First file:** \`${attachment.filename}\` (${attachment.size} bytes)`,
				);
			}
		}

		return interaction.reply({
			content: lines.join("\n"),
		});
	}) satisfies ModalHandler,
};
