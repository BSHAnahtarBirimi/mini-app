import { CheckboxBuilder, CommandBuilder, LabelBuilder, ModalBuilder } from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

/** `/singlecheck` — bisect D: single Label + single Checkbox only. */
export const singlecheckCommand = {
	data: new CommandBuilder().setName("singlecheck").setDescription("Bisect: single Checkbox modal"),

	handler: (async (interaction) => {
		const modal = new ModalBuilder()
			.setCustomId("singlecheck_test_modal")
			.setTitle("Checkbox Test")
			.addComponents(
				new LabelBuilder()
					.setLabel("Confirm")
					.setComponent(new CheckboxBuilder().setCustomId("sc_check").setDefault(false)),
			);

		return interaction.showModal(modal);
	}) satisfies SlashCommandHandler,
};
