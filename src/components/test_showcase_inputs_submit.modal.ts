import type { ModalHandler } from "@minesa-org/mini-interaction";

/** `test_showcase_inputs_modal` — reads radio group, checkbox group and single checkbox values. */
export const showcaseInputsModal = {
	customId: "test_showcase_inputs_modal",

	handler: (async (interaction) => {
		const radio = interaction.getRadioGroupValue("sc_radio");
		const checkboxes = interaction.getCheckboxGroupValues("sc_checkboxes");
		const followUp = interaction.getCheckboxValue("sc_followup");

		return interaction.reply({
			content: [
				"**📻 Inputs showcase**",
				`**Radio group:** \`${radio ?? "—"}\``,
				`**Checkbox group:** ${checkboxes.length ? checkboxes.map((v) => `\`${v}\``).join(", ") : "—"}`,
				`**Single checkbox:** ${followUp ? "✅ Yes" : "❌ No"}`,
			].join("\n"),
		});
	}) satisfies ModalHandler,
};
