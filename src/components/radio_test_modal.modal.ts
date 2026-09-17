import type { ModalHandler } from "@minesa-org/mini-interaction";

/** `radio_test_modal` — echoes the radio choice. */
export const radioTestModal = {
	customId: "radio_test_modal",

	handler: (async (interaction) => {
		const choice = interaction.getRadioGroupValue("radio_choice");

		return interaction.reply({ content: `📻 Radio test — you picked: \`${choice ?? "nothing"}\`` });
	}) satisfies ModalHandler,
};
