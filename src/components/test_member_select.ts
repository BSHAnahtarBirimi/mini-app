import type { ComponentHandler } from "@minesa-org/mini-interaction";

/** `test_member_select` — user select menu that replies mentioning the picks. */
export const memberSelect = {
	customId: "test_member_select",

	handler: (async (interaction) => {
		const users = interaction.getUsers();
		const mentions = users.map((u) => `<@${u.user.id}>`).join(", ") || "—";

		return interaction.reply({
			content: `**👤 Member select** — you picked: ${mentions}`,
		});
	}) satisfies ComponentHandler,
};
