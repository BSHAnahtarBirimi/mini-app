import type { ModalHandler } from "@minesa-org/mini-interaction";

/** `test_showcase_resolved_modal` — reads resolved users, roles and channels. */
export const showcaseResolvedModal = {
	customId: "test_showcase_resolved_modal",

	handler: (async (interaction) => {
		const users = interaction.getUsers("sc_user");
		const roles = interaction.getRoles("sc_role");
		const channels = interaction.getChannels("sc_channel");

		const userLines = users.length
			? users.map((u) => `<@${u.user.id}> (\`${u.user.username}\`)`).join(", ")
			: "—";
		const roleLines = roles.length
			? roles.map((r) => `<@&${r.id}> (\`${r.name}\`)`).join(", ")
			: "—";
		const channelLines = channels.length
			? channels.map((c) => `<#${c.id}> (\`${c.name}\`)`).join(", ")
			: "—";

		return interaction.reply({
			content: [
				"**🎯 Select menus showcase**",
				`**Members:** ${userLines}`,
				`**Roles:** ${roleLines}`,
				`**Channels:** ${channelLines}`,
			].join("\n"),
		});
	}) satisfies ModalHandler,
};
