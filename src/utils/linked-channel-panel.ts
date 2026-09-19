/**
 * The wire payloads of the Linked Channels flow, built two ways.
 *
 * The primary form is a Components V2 container. It is sent as the completion
 * of a deferred response, which means the message is *edited*; the legacy form
 * exists so a refused edit can still be completed instead of leaving the admin
 * on "«bot» is thinking…" forever.
 *
 * Two rules this module exists to enforce:
 *
 * 1. The library's `SectionBuilder` throws when a section has no accessory
 *    (`[SectionBuilder] accessory is required for sections`), so plain text goes
 *    *directly* into the container and only blocks with a real accessory (the
 *    Reconnect button, a channel select) are wrapped in a section. Building a
 *    payload that throws is what made `/linked-channel` acknowledge and then
 *    die silently, so every payload here is exercised by unit tests.
 * 2. A container payload must not mix legacy fields (content/embeds) with the
 *    Components V2 flag, and a legacy payload must not set that flag.
 */

import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	MessageFlags,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
} from "@minesa-org/mini-interaction";
import type { MessageActionRowComponent } from "@minesa-org/mini-interaction";

import { buildChannelMenuOptions } from "./lobby-channels.ts";
import type { ClassifiedChannel } from "./lobby-channels.ts";

/** Message flags for the V2 completion. */
export const PANEL_V2_FLAGS = MessageFlags.IsComponentsV2;

/** The two editable forms of one message: V2 first, legacy as the fallback. */
export type EditablePayloadPair = {
	v2: { flags: number; components: ContainerBuilder[] };
	legacy: { content: string; components: ActionRowBuilder<MessageActionRowComponent>[] };
};

const text = (content: string) => new TextDisplayBuilder().setContent(content);

const divider = () =>
	new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true);

const row = (...components: Parameters<ActionRowBuilder<MessageActionRowComponent>["addComponents"]>) =>
	new ActionRowBuilder<MessageActionRowComponent>().addComponents(...components);

const linkButton = () =>
	new ButtonBuilder().setStyle(ButtonStyle.Success).setCustomId("lc:link").setLabel("🔗 Link a channel");

const unlinkButton = () =>
	new ButtonBuilder().setStyle(ButtonStyle.Danger).setCustomId("lc:unlink").setLabel("✖️ Unlink");

const joinButton = () =>
	new ButtonBuilder().setStyle(ButtonStyle.Primary).setCustomId("lc:join").setLabel("🏠 Join Discord server");

/**
 * Posts a message through the lobby, as a game does.
 *
 * The linked-channel experience itself lives inside a Social SDK client, so
 * this is the only way to see the link work from Discord: the message is sent
 * with the calling user's token and lands in the linked channel. It is also the
 * quickest "is this link actually alive?" check — a lobby without a linked
 * channel is refused by Discord.
 */
const testButton = () =>
	new ButtonBuilder()
		.setStyle(ButtonStyle.Secondary)
		.setCustomId("lc:test")
		.setLabel("✉️ Send a test message");

const reconnectButton = (url: string) =>
	new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("🔁 Reconnect Discord").setURL(url);

const cancelButton = () =>
	new ButtonBuilder().setStyle(ButtonStyle.Secondary).setCustomId("lc:cancel").setLabel("Cancel");

// ---------------------------------------------------------------- /linked-channel

export type LinkedChannelPanelData = {
	lobbyId: string;
	/** Present only while the caller's connection lacks `sdk.social_layer`. */
	reconnectUrl: string | null;
};

const HEADING = [
	"## 🔗 Linked Channels",
	"Connect this server's game lobby to a text channel —",
	"lobby members can read **and post** messages in the",
	"linked channel from inside the game.",
].join("\n");

const RECONNECT = [
	"### ⚠️ Reconnect required",
	"Channel linking needs a Discord connection with the",
	"**Social SDK** scope (`openid sdk.social_layer`). Your",
	"current connection is missing it — reconnect, otherwise",
	"linking will fail.",
].join("\n");

const COMMUNITY = ["### 💬 Community", "Join our Discord server to meet other players."].join("\n");

const manageText = (lobbyId: string) =>
	[
		"### 🛠️ Manage the link",
		`**Lobby:** \`${lobbyId}\``,
		"Linking requires Manage Channels, View Channel and Send",
		"Messages permissions on the chosen channel. **Send a test",
		"message** posts into the linked channel from the lobby — the",
		"same call a game makes.",
	].join("\n");

/** The `/linked-channel` panel: link, unlink, join, and Reconnect when needed. */
export function buildPanelPayloads(data: LinkedChannelPanelData): EditablePayloadPair {
	const container = new ContainerBuilder().setAccentColor(0x57f287);

	// Plain text: a section would require an accessory.
	container.addComponent(text(HEADING));
	container.addComponent(divider());

	if (data.reconnectUrl) {
		container.addComponent(
			new SectionBuilder()
				.addComponent(text(RECONNECT))
				.setAccessory(reconnectButton(data.reconnectUrl)),
		);
		container.addComponent(divider());
	}

	container.addComponent(text(manageText(data.lobbyId)));
	container.addComponent(row(linkButton(), unlinkButton(), testButton()));

	container.addComponent(divider());
	container.addComponent(text(COMMUNITY));
	container.addComponent(row(joinButton()));

	const legacyContent = [
		HEADING,
		...(data.reconnectUrl ? ["", RECONNECT, `🔁 ${data.reconnectUrl}`] : []),
		"",
		manageText(data.lobbyId),
		"",
		COMMUNITY,
	].join("\n");

	return {
		v2: { flags: PANEL_V2_FLAGS, components: [container] },
		legacy: {
			content: legacyContent,
			components: [
				row(linkButton(), unlinkButton(), testButton()),
				...(data.reconnectUrl ? [row(reconnectButton(data.reconnectUrl))] : []),
				row(joinButton()),
			],
		},
	};
}

// ---------------------------------------------------------------------- lc:link

export type ChannelMenuData = {
	lobbyId: string;
	channels: ClassifiedChannel[];
};

/**
 * The channel picker (`lc:link`).
 *
 * Discord's native channel select has no per-option labels, so this is a
 * labelled StringSelect built from the guild's channel list, with privacy
 * badges from `permission_overwrites`. The mandatory warning step (`lc:pick`)
 * stays in place regardless of what the badge says.
 */
export function buildChannelMenuPayloads(data: ChannelMenuData): EditablePayloadPair {
	const select = new StringSelectMenuBuilder()
		.setCustomId("lc:pick")
		.setPlaceholder("Select a text channel to link…")
		.setMinValues(1)
		.setMaxValues(1)
		.addOptions(...buildChannelMenuOptions(data.channels));

	const heading = [
		"### 🔗 Link a channel",
		`Pick the text channel to link to lobby \`${data.lobbyId}\`.`,
		"Lobby members will be able to read **and post** in it",
		"from inside the game.",
	].join("\n");
	const legend =
		"✅ provably public · 🔒 private · ❓ unknown — **every** pick gets a final confirmation step.";

	const container = new ContainerBuilder().setAccentColor(0x5865f2);
	container.addComponent(text(heading));
	container.addComponent(divider());
	container.addComponent(text(legend));
	container.addComponent(row(select));
	container.addComponent(row(cancelButton()));

	return {
		v2: { flags: PANEL_V2_FLAGS, components: [container] },
		legacy: {
			content: [heading, "", legend].join("\n"),
			components: [row(select), row(cancelButton())],
		},
	};
}
