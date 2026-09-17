import { CommandBuilder, LabelBuilder, ModalBuilder, RadioBuilder } from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

/** `/twolabel` — bisect B: TWO top-level Labels, no descriptions. */
export const twolabelCommand = {
	data: new CommandBuilder().setName("twolabel").setDescription("Bisect: two Labels in one modal"),

	handler: (async (interaction) => {
		const modal = new ModalBuilder()
			.setCustomId("twolabel_test_modal")
			.setTitle("Two Label Test")
			.addComponents(
				new LabelBuilder().setLabel("First").setComponent(
					new RadioBuilder()
						.setCustomId("tl_radio1")
						.setRequired(true)
						.addOptions({ label: "A", value: "a" }, { label: "B", value: "b" }),
				),
				new LabelBuilder().setLabel("Second").setComponent(
					new RadioBuilder()
						.setCustomId("tl_radio2")
						.setRequired(true)
						.addOptions({ label: "C", value: "c" }, { label: "D", value: "d" }),
				),
			);

		return interaction.showModal(modal);
	}) satisfies SlashCommandHandler,
};
