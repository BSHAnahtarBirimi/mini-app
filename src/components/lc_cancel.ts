import { MessageFlags } from "@minesa-org/mini-interaction";
import type { ComponentHandler } from "@minesa-org/mini-interaction";

import { clearPendingLink } from "../utils/linked-channel-state.ts";

/** `lc:cancel` — clears the pending channel pick without linking. */
export const cancelLinkButton = {
	customId: "lc:cancel",

	handler: (async (interaction) => {
		const guildId = interaction.guild_id;
		const userId = interaction.member?.user?.id ?? interaction.user?.id;
		if (guildId && userId) {
			await clearPendingLink(userId, guildId);
		}

		return interaction.reply({
			content: "🚫 Cancelled — nothing was linked.",
			flags: MessageFlags.Ephemeral,
		});
	}) satisfies ComponentHandler,
};
