import type { ModalHandler } from "@minesa-org/mini-interaction";

/** `ping_modal` — reads the submitted select-menu values from the modal. */
export const pingModal = {
	customId: "ping_modal",

	handler: (async (interaction) => {
		const values = interaction.getSelectMenuValues("ping_menu_modal") ?? [];

		return interaction.reply({
			content: values.length
				? `You selected: ${values.join(", ")}`
				: "You didn't select anything.",
		});
	}) satisfies ModalHandler,
};
