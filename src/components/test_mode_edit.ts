import type { APIContainerComponent } from "discord-api-types/v10";
import type { ComponentHandler } from "@minesa-org/mini-interaction";
import { buildShowcaseContainer } from "./test_showcase_container.js";

/** `test_mode_edit` — string select that defers update, then edits the reply. */
export const modeEditSelect = {
	customId: "test_mode_edit",

	handler: (async (interaction) => {
		const choice = interaction.getStringValues()[0];

		if (choice === "accent") {
			// Swap the accent colour on the shared showcase container.
			const container = buildShowcaseContainer().setAccentColor(0xed4245);
			await interaction.deferUpdate();
			return interaction.editReply({
				components: [container.toJSON() as unknown as APIContainerComponent],
			});
		}

		// Standard edit flow: defer, then edit the original response.
		await interaction.deferUpdate();
		return interaction.editReply({
			components: [
				{
					type: 17,
					accent_color: 0xfee75c,
					components: [
						{ type: 10, content: "## ✏️ Edited via editReply" },
						{
							type: 10,
							content: `You selected \`${choice}\` — deferred the update, then edited the original message.`,
						},
						{ type: 14, spacing: 1, divider: true },
						{ type: 10, content: "-# Pick **Swap accent color** to recolour the full showcase container." },
					],
				},
			],
		});
	}) satisfies ComponentHandler,
};
