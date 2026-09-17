import type { ModalHandler } from "@minesa-org/mini-interaction";

/** `usersel_test_modal` — echoes the selected user. */
export const userselTestModal = {
	customId: "usersel_test_modal",

	handler: (async (interaction) => {
		const user = interaction.getUser("user_choice");

		return interaction.reply({
			content: user ? `👥 UserSelect test — you picked <@${user.user.id}>` : "👥 UserSelect test — nobody selected.",
		});
	}) satisfies ModalHandler,
};
