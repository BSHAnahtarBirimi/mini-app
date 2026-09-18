import {
	ChannelSelectMenuBuilder,
	ContainerBuilder,
	RoleSelectMenuBuilder,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
	ThumbnailBuilder,
} from "@minesa-org/mini-interaction";
import type { APIComponentInContainer } from "discord-api-types/v10";

const HERO_IMAGE = "https://cdn.discordapp.com/embed/avatars/0.png";

/** The library's container component type is narrower than the Discord API allows. */
const inContainer = (component: unknown) => component as APIComponentInContainer;

/** Builds the original /test container payload. */
export function buildShowcaseContainer() {
	const container = new ContainerBuilder().setAccentColor(0x5865f2);

	// 1. Section: text + thumbnail accessory.
	container.addComponent(
		new SectionBuilder()
			.addComponent(
				new TextDisplayBuilder().setContent(
					[
						"## 🧪 Mini-Interaction Showcase",
						"Modals via the buttons below the container; response modes via the",
						"select menus inside the container.",
					].join("\n"),
				),
			)
			.setAccessory(new ThumbnailBuilder().setMedia({ url: HERO_IMAGE }).setDescription("mini-interaction logo")),
	);

	// 2. Separator.
	container.addComponent(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true));

	// 3. Select menus (inside the container) demoing response modes.
	container.addComponent(
		new TextDisplayBuilder().setContent("### 🎛️ Response modes\nPick a menu — each one responds differently:"),
	);
	container.addComponent(
		inContainer(
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
		inContainer(
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
		inContainer(
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

	// 4. Separator.
	container.addComponent(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

	// 5. Feature list.
	container.addComponent(
		new TextDisplayBuilder().setContent(
			[
				"**This message** — Components V2: container accent, section + thumbnail",
				"accessory, text display, separators, string select menus.",
				"",
				"**Buttons below** — modals: text inputs (short & paragraph), radio &",
				"checkbox groups, file upload with image preview, member/role/channel",
				"modal select menus.",
			].join("\n"),
		),
	);

	// 6. Spoiler text block.
	container.addComponent(new TextDisplayBuilder().setContent("||🤫 Bonus: spoiler-marked text block.||"));

	// 7. Separator.
	container.addComponent(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

	// 8. Member / role / channel select menus (message variants) inside the container.
	container.addComponent(
		inContainer({
			type: 5,
			custom_id: "test_member_select",
			placeholder: "Select a member — replies mentioning them",
			min_values: 1,
			max_values: 3,
		}),
	);
	container.addComponent(
		inContainer(
			new RoleSelectMenuBuilder()
				.setCustomId("test_role_select")
				.setPlaceholder("Select a role — replies with its name")
				.setMinValues(1)
				.setMaxValues(3),
		),
	);
	container.addComponent(
		inContainer(
			new ChannelSelectMenuBuilder()
				.setCustomId("test_channel_select")
				.setPlaceholder("Select a channel — replies with its mention")
				.setMinValues(1)
				.setMaxValues(3),
		),
	);

	return container;
}
