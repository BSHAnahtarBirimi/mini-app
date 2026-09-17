import {
	ButtonBuilder,
	ButtonStyle,
	CommandBuilder,
	ContainerBuilder,
	GalleryBuilder,
	GalleryItemBuilder,
	MessageFlags,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
	ThumbnailBuilder,
} from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

const button = (customId: string, label: string) =>
	new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle.Primary);

const HERO_IMAGE =
	"https://cdn.discordapp.com/attachments/1254153896198537216/1416368210605555774/mini-interaction.png";

/** `/test` — full Components V2 + modal feature showcase. */
export const testCommand = {
	data: new CommandBuilder().setName("test").setDescription("Showcases every mini-interaction feature"),

	handler: (async (interaction) => {
		const container = new ContainerBuilder().setAccentColor(0x5865f2);

		// 1. Section: text + thumbnail accessory.
		container.addComponent(
			new SectionBuilder()
				.addComponent(
					new TextDisplayBuilder().setContent(
						[
							"## 🧪 Mini-Interaction Showcase",
							"Every Components V2 feature in one message, plus buttons that open",
							"modals demoing every modal component.",
						].join("\n"),
					),
				)
				.setAccessory(
					new ThumbnailBuilder()
						.setMedia({ url: HERO_IMAGE })
						.setDescription("mini-interaction logo"),
				),
		);

		// 2. Separator.
		container.addComponent(
			new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true),
		);

		// 3. Media gallery.
		container.addComponent(
			new GalleryBuilder()
				.addItem(
					new GalleryItemBuilder().setMedia({ url: HERO_IMAGE }).setDescription("Gallery item 1"),
				)
				.addItem(
					new GalleryItemBuilder().setMedia({ url: HERO_IMAGE }).setDescription("Gallery item 2"),
				),
		);

		// 4. Separator.
		container.addComponent(
			new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
		);

		// 5. Feature list.
		container.addComponent(
			new TextDisplayBuilder().setContent(
				[
					"**This message** — Components V2: container, section + thumbnail accessory,",
					"media gallery, text display, separators, spoiler block & link button.",
					"",
					"**The buttons below** — modals: legacy ActionRow, radio group, checkbox",
					"group, single checkbox, text input, string select, user & role select,",
					"file upload with attachment preview.",
				].join("\n"),
			),
		);

		// 6. Spoiler text block (Discord masks spoiler-marked content in Components V2).
		container.addComponent(
			new TextDisplayBuilder().setContent("||🤫 Bonus: this text is wrapped in spoiler markup.||"),
		);

		// 7. Separator.
		container.addComponent(
			new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
		);

		// 8. Action rows: 4 modal buttons + 1 link button.
		container.addComponent({
			type: 1,
			components: [
				button("test_showcase_legacy", "🧱 Legacy").toJSON(),
				button("test_showcase_inputs", "📻 Inputs").toJSON(),
				button("test_showcase_text_select", "📝 Text & Select").toJSON(),
			],
		});
		container.addComponent({
			type: 1,
			components: [
				button("test_showcase_resolved", "👥 Resolved").toJSON(),
				button("test_showcase_upload", "📎 Upload").toJSON(),
				new ButtonBuilder()
					.setStyle(ButtonStyle.Link)
					.setLabel("📚 Docs")
					.setURL("https://docs.discord.com/developers/components/reference")
					.toJSON(),
			],
		});

		return interaction.reply({
			flags: MessageFlags.IsComponentsV2,
			components: [container.toJSON()],
		});
	}) satisfies SlashCommandHandler,
};
