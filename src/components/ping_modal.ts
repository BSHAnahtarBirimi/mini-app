import type { ModalHandler } from "@minesa-org/mini-interaction";

/** `ping_modal` — reads every submitted modal component and summarizes them. */
export const pingModal = {
	customId: "ping_modal",

	handler: (async (interaction) => {
		const radio = interaction.getRadioGroupValue("ping_radio");
		const checkboxes = interaction.getCheckboxGroupValues("ping_checkboxes");
		const wantsFollowUp = interaction.getCheckboxValue("ping_followup");
		const notes = interaction.getTextFieldValue("ping_notes");
		const attachments = interaction.getFileUploadValues("ping_upload");

		const lines = [
			`**📻 Radio group:** ${radio ?? "—"}`,
			`**☑️ Checkbox group:** ${checkboxes.length ? checkboxes.join(", ") : "—"}`,
			`**🔘 Single checkbox:** ${wantsFollowUp ? "Yes" : "No"}`,
			`**📝 Notes:** ${notes?.trim() ? notes : "—"}`,
			`**📎 File upload:** ${attachments.length ? `${attachments.length} file(s)` : "—"}`,
		];

		return interaction.reply({
			content: `**Modal showcase results**\n${lines.join("\n")}`,
		});
	}) satisfies ModalHandler,
};
