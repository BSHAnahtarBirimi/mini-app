import type { ModalHandler } from "@minesa-org/mini-interaction";

/** `upload_test_modal` — echoes the uploaded file info. */
export const uploadTestModal = {
	customId: "upload_test_modal",

	handler: (async (interaction) => {
		const uploads = interaction.getFileUploadValues("file_choice");
		const attachment = interaction.getAttachment("file_choice");

		return interaction.reply({
			content: uploads.length
				? `📎 Upload test — ${uploads.length} file(s)${attachment ? `, first: \`${attachment.filename}\`` : ""}`
				: "📎 Upload test — no files attached.",
		});
	}) satisfies ModalHandler,
};
