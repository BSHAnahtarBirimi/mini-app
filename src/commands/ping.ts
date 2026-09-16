import {
	ButtonBuilder,
	ButtonStyle,
	CommandBuilder,
	ContainerBuilder,
	MessageFlags,
	SectionBuilder,
	TextDisplayBuilder,
} from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

/** `/ping` — Components V2 showcase (container + section + button). */
export const pingCommand = {
	data: new CommandBuilder().setName("ping").setDescription("pong"),

	handler: (async (interaction) => {
		const container = new ContainerBuilder().addComponent(
			new SectionBuilder()
				.addComponent(
					new TextDisplayBuilder().setContent(
						"This is a test message using Components V2.",
					),
				)
				.setAccessory(
					new ButtonBuilder()
						.setCustomId("ping_button")
						.setLabel("Pong")
						.setStyle(ButtonStyle.Primary),
				),
		);

		return interaction.reply({
			flags: MessageFlags.IsComponentsV2,
			components: [container.toJSON()],
		});
	}) satisfies SlashCommandHandler,
};
