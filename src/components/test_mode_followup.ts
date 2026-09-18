import type { ComponentHandler } from "@minesa-org/mini-interaction";

/** `test_mode_followup` — string select that sends a follow-up reply. */
export const modeFollowupSelect = {
	customId: "test_mode_followup",

	handler: (async (interaction) => {
		const choice = interaction.getStringValues()[0];
		const ephemeral = choice === "ephemeral";

		// Acknowledge by updating nothing visible, then send a follow-up message.
		await interaction.deferUpdate();
		await interaction.sendFollowUp?.(interaction.token, {
			type: 4,
			data: {
				content: `🔔 **Follow-up showcase** — you picked \`${choice}\`.${
					ephemeral ? " (This one is ephemeral — only you can see it.)" : ""
				}`,
				flags: ephemeral ? 64 : undefined,
			},
		});
	}) satisfies ComponentHandler,
};
