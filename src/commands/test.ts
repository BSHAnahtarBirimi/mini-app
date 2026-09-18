import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelSelectMenuBuilder,
	CommandBuilder,
	ContainerBuilder,
	MessageFlags,
	RoleSelectMenuBuilder,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
	ThumbnailBuilder,
} from "@minesa-org/mini-interaction";
import type { MessageActionRowComponent } from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

const HERO_IMAGE = "https://cdn.discordapp.com/embed/avatars/0.png";

/** `/test` — full Components V2 showcase built with mini-interaction builders only. */
export const testCommand = {
	data: new CommandBuilder().setName("test").setDescription("Showcases every mini-interaction feature"),

	handler: (async (interaction) => {
		const container = new ContainerBuilder().setAccentColor(0x5865f2);

		// 1. Section: heading text + thumbnail accessory.
		container.addComponent(
			new SectionBuilder()
				.addComponent(
					new TextDisplayBuilder().setContent(
						[
							"## 🧪 Mini-Interaction Showcase",
							"Select menus inside this container demo response modes;",
							"buttons below it open feature modals.",
						].join("\n"),
					),
				)
				.setAccessory(
					new ThumbnailBuilder().setMedia({ url: HERO_IMAGE }).setDescription("mini-interaction logo"),
				),
		);

		// 2. Section with button accessory.
		container.addComponent(
			new SectionBuilder()
				.addComponent(
					new TextDisplayBuilder().setContent(
						"✨ **Accessory button section** — this section's accessory is a button, not a thumbnail.",
					),
				)
				.setAccessory(
					new ButtonBuilder()
						.setStyle(ButtonStyle.Secondary)
						.setCustomId("test_accessory_button")
						.setLabel("Try a modal"),
				),
		);

		// 3. Separator.
		container.addComponent(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true));

		// 4. Separator.
		container.addComponent(
			new TextDisplayBuilder().setContent("### 🎛️ Response modes\nPick a menu — each one responds differently:"),
		);
		container.addComponent(
			new ActionRowBuilder<MessageActionRowComponent>().addComponents(
				new StringSelectMenuBuilder()
					.setCustomId("test_mode_followup")
					.setPlaceholder("Send a follow-up reply")
					.setMinValues(1)
					.setMaxValues(1)
					.addOptions(
						{ label: "Follow-up reply", value: "followup", description: "Replies with a new message" },
						{ label: "Ephemeral follow-up", value: "ephemeral", description: "Only you can see it" },
					),
			),
		);
		container.addComponent(
			new ActionRowBuilder<MessageActionRowComponent>().addComponents(
				new StringSelectMenuBuilder()
					.setCustomId("test_mode_update")
					.setPlaceholder("Update this message")
					.setMinValues(1)
					.setMaxValues(1)
					.addOptions(
						{ label: "Update container", value: "update", description: "Rewrites the container in place" },
						{ label: "Reset demo", value: "reset", description: "Restores the original showcase" },
					),
			),
		);
		container.addComponent(
			new ActionRowBuilder<MessageActionRowComponent>().addComponents(
				new StringSelectMenuBuilder()
					.setCustomId("test_mode_edit")
					.setPlaceholder("Edit the container (deferUpdate + editReply)")
					.setMinValues(1)
					.setMaxValues(1)
					.addOptions(
						{ label: "Edit via editReply", value: "edit", description: "Defers update, then edits" },
						{ label: "Swap accent color", value: "accent", description: "Changes the container color" },
					),
			),
		);

		// 5. Separator.
		container.addComponent(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

		// 6. Feature list.
		container.addComponent(
			new TextDisplayBuilder().setContent(
				[
					"**This message** — Components V2: container accent, section + thumbnail",
					"accessory, text displays, separators, select menus in action rows.",
					"",
					"**Buttons below** — modals: text inputs (short & paragraph), radio &",
					"checkbox groups, file upload with image preview, member/role/channel",
					"modal select menus.",
				].join("\n"),
			),
		);

		// 7. Spoiler text block.
		container.addComponent(new TextDisplayBuilder().setContent("||🤫 Bonus: spoiler-marked text block.||"));

		// 8. Separator.
		container.addComponent(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

		// 9. Member / role / channel select menus (message variants) in ActionRows.
		container.addComponent(				new ActionRowBuilder<MessageActionRowComponent>().addComponents({
					type: 5,
					custom_id: "test_member_select",
					placeholder: "Select a member — replies mentioning them",
					min_values: 1,
					max_values: 3,
				}),
		);
		container.addComponent(
			new ActionRowBuilder<MessageActionRowComponent>().addComponents(
				new RoleSelectMenuBuilder()
					.setCustomId("test_role_select")
					.setPlaceholder("Select a role — replies with its name")
					.setMinValues(1)
					.setMaxValues(3),
			),
		);
		container.addComponent(
			new ActionRowBuilder<MessageActionRowComponent>().addComponents(
				new ChannelSelectMenuBuilder()
					.setCustomId("test_channel_select")
					.setPlaceholder("Select a channel — replies with its mention")
					.setMinValues(1)
					.setMaxValues(3),
			),
		);

		return interaction.reply({
			flags: MessageFlags.IsComponentsV2,
			components: [
				container,
				// 9. Modal-launcher buttons below the container.
				new ActionRowBuilder<MessageActionRowComponent>().addComponents(
					new ButtonBuilder().setStyle(ButtonStyle.Primary).setCustomId("test_showcase_inputs").setLabel("✏️ Inputs"),
					new ButtonBuilder().setStyle(ButtonStyle.Primary).setCustomId("test_showcase_radio_check").setLabel("📻 Radio & Checkbox"),
					new ButtonBuilder().setStyle(ButtonStyle.Primary).setCustomId("test_showcase_resolved").setLabel("🎯 Select Menus"),
				),
				new ActionRowBuilder<MessageActionRowComponent>().addComponents(
					new ButtonBuilder().setStyle(ButtonStyle.Primary).setCustomId("test_showcase_upload").setLabel("📎 Upload"),
				),
			],
		});
	}) satisfies SlashCommandHandler,
};
