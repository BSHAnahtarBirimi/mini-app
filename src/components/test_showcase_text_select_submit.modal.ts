import type { ModalHandler } from "@minesa-org/mini-interaction";

/** `test_showcase_text_select_modal` — reads the text input and string select values. */
export const showcaseTextSelectModal = {
	customId: "test_showcase_text_select_modal",

	handler: (async (interaction) => {
		const text = interaction.getTextFieldValue("sc_text");
		const select = interaction.getSelectMenuValues("sc_select") ?? [];

		return interaction.reply({
			content: [
				"**📝 Text & Select showcase**",
				`**Text input:** ${text ? `\`${text}\`` : "—"}`,
				`**String select:** ${select.length ? select.map((v) => `\`${v}\``).join(", ") : "—"}`,
			].join("\n"),
		});
	}) satisfies ModalHandler,
};
