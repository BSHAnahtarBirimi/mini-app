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
						"- **🧱 Legacy** — ActionRow + TextInput (no Label, deprecated but classic)",
						"- **📻 Inputs** — radio group, checkbox group, single checkbox (in Labels)",
						"- **📝 Text & Select** — text input, string select menu (in Labels)",
						"- **👥 Resolved** — user & role select menus (in Labels)",
						"- **📎 Upload** — file upload + attachment preview (in Labels)",
						"",
						"-# ℹ️ Inputs, Upload & Resolved use newer modal components. Some clients " +
							"(notably the web app) may not render them yet — try desktop/mobile.",
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
					button("test_showcase_legacy", "🧱 Legacy").toJSON(),
					button("test_showcase_inputs", "📻 Inputs").toJSON(),
				],
			})
			.addComponent({
				type: 1,
				components: [
					button("test_showcase_text_select", "📝 Text & Select").toJSON(),
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
