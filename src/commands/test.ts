import {
	ButtonBuilder,
	ButtonStyle,
	CommandBuilder,
	ContainerBuilder,
	MessageFlags,
	SeparatorSpacingSize,
	TextDisplayBuilder,
} from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

const button = (customId: string, label: string) =>
	new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle.Primary);

/** `/test` — launches buttons that each open a showcase modal. */
export const testCommand = {
	data: new CommandBuilder().setName("test").setDescription("Showcases every mini-interaction feature"),

	handler: (async (interaction) => {
		const container = new ContainerBuilder()
			.addComponent(
				new TextDisplayBuilder().setContent(
					[
					"## 🧪 Mini-Interaction Showcase",
					"Each button below opens a modal demoing a set of modal features.",
					"",
					"- **📻 Inputs** — radio group, checkbox group, single checkbox",
					"- **📝 Text & Select** — text input, string select menu",
					"- **👥 Resolved** — user & role select menus (resolved data)",
					"- **📎 Upload** — file upload + attachment preview",
					"",
					"-# ℹ️ Inputs & Upload use Discord's newest modal components " +
						"(Radio/Checkbox/File Upload). Some clients — notably the web app — " +
						"may not render them yet. Try the desktop or mobile app if a modal fails.",
					].join("\n"),
				),
			)
			.addComponent({
				type: 14,
				spacing: SeparatorSpacingSize.Small,
				id: 1,
			})
			.addComponent({
				type: 1,
				components: [
					button("test_showcase_inputs", "📻 Inputs").toJSON(),
					button("test_showcase_text_select", "📝 Text & Select").toJSON(),
				],
			})
			.addComponent({
				type: 1,
				components: [
					button("test_showcase_resolved", "👥 Resolved").toJSON(),
					button("test_showcase_upload", "📎 Upload").toJSON(),
				],
			});

		return interaction.reply({
			flags: MessageFlags.IsComponentsV2,
			components: [container.toJSON()],
		});
	}) satisfies SlashCommandHandler,
};
