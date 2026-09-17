import type { ModalHandler } from "@minesa-org/mini-interaction";

/** `test_showcase_resolved_modal` — reads resolved users and roles from the select menus. */
export const showcaseResolvedModal = {
	customId: "test_showcase_resolved_modal",

	handler: (async (interaction) => {
		const users = interaction.getUsers("sc_user");
		const roles = interaction.getRoles("sc_role");

		const userLines = users.length
			? users.map((u) => `<@${u.user.id}> (\`${u.user.username}\`)`).join(", ")
			: "—";
		const roleLines = roles.length
			? roles.map((r) => `<@&${r.id}> (\`${r.name}\`)`).join(", ")
			: "—";

		return interaction.reply({
			content: [
				"**👥 Resolved showcase**",
				`**Users:** ${userLines}`,
				`**Roles:** ${roleLines}`,
			].join("\n"),
		});
	}) satisfies ModalHandler,
};
