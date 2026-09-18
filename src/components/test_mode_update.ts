import type { APIContainerComponent } from "discord-api-types/v10";
import type { ComponentHandler } from "@minesa-org/mini-interaction";
import { buildShowcaseContainer } from "./test_showcase_container.ts";

/** `test_mode_update` — string select that updates the message in place. */
export const modeUpdateSelect = {
	customId: "test_mode_update",

	handler: (async (interaction) => {
		const choice = interaction.getStringValues()[0];

		if (choice === "reset") {
			// Restore the original showcase container.
			return interaction.update({
				components: [buildShowcaseContainer().toJSON() as unknown as APIContainerComponent],
			});
		}

		// Rewrite the container in place with a confirmation block.
		return interaction.update({
			components: [
				{
					type: 17,
					accent_color: 0x57f287,
					components: [
						{ type: 10, content: "## ✅ Updated in place" },
						{
							type: 10,
							content: `You selected \`${choice}\` — this message was rewritten via \`interaction.update()\`.`,
						},
						{ type: 14, spacing: 1, divider: true },
						{ type: 10, content: "-# Pick **Reset demo** on the update menu to restore the showcase." },
					],
				},
			],
		});
	}) satisfies ComponentHandler,
};
