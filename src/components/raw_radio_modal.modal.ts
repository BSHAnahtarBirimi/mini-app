import type { ModalHandler } from "@minesa-org/mini-interaction";

/** `raw_radio_modal` — echoes the raw modal's radio choice. */
export const rawRadioModal = {
	customId: "raw_radio_modal",

	handler: (async (interaction) => {
		const choice = interaction.getRadioGroupValue("raw_radio_choice");

		return interaction.reply({ content: `📻 Raw radio test — you picked: \`${choice ?? "nothing"}\`` });
	}) satisfies ModalHandler,
};
