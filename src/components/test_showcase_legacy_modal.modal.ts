import type { ModalHandler } from "@minesa-org/mini-interaction";

/** `test_showcase_legacy_modal` — reads the classic ActionRow text input. */
export const showcaseLegacyModal = {
	customId: "test_showcase_legacy_modal",

	handler: (async (interaction) => {
		const text = interaction.getTextFieldValue("sc_legacy_text");

		return interaction.reply({
			content: `**🧱 Legacy showcase**\n**Text input:** ${text ? `\`${text}\`` : "—"}`,
		});
	}) satisfies ModalHandler,
};
