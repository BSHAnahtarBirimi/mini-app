import type { ComponentHandler } from "@minesa-org/mini-interaction";

/** `test_role_select` — role select menu that replies with resolved roles. */
export const roleSelect = {
	customId: "test_role_select",

	handler: (async (interaction) => {
		const roles = interaction.getRoles();
		const names = roles.map((r) => `<@&${r.id}>`).join(", ") || "—";

		return interaction.reply({
			content: `**🏷️ Role select** — you picked: ${names}`,
		});
	}) satisfies ComponentHandler,
};
