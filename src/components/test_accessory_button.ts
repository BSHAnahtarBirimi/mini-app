import type { ComponentHandler } from "@minesa-org/mini-interaction";

/** `test_accessory_button` — section accessory button that confirms the click. */
export const accessoryButton = {
	customId: "test_accessory_button",

	handler: (async (interaction) => {
		return interaction.reply({
			content: "✨ **Accessory button** — clicked from a Section accessory. Buttons can live in Action Rows *or* Section accessories.",
		});
	}) satisfies ComponentHandler,
};
