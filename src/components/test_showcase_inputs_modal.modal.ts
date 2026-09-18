import type { ModalHandler } from "@minesa-org/mini-interaction";

/** `test_showcase_inputs_modal` — reads short + paragraph text input values. */
export const showcaseInputsModal = {
	customId: "test_showcase_inputs_modal",

	handler: (async (interaction) => {
		const short = interaction.getTextFieldValue("sc_short");
		const paragraph = interaction.getTextFieldValue("sc_paragraph");

		return interaction.reply({
			content: [
				"**✏️ Text Inputs showcase**",
				`**Short:** ${short ? `\`${short}\`` : "—"}`,
				`**Paragraph:** ${paragraph ? `\n>>> ${paragraph}` : "—"}`,
			].join("\n"),
		});
	}) satisfies ModalHandler,
};
