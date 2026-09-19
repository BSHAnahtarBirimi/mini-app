/**
 * Channel menu assembly for the Linked Channels flow.
 *
 * Discord's channel select menus carry no per-option labels, so there is no
 * way to mark individual channels as private inside a native channel select.
 * Instead we fetch the guild's channels with the BOT token
 * (`DiscordRestClient.listGuildChannels`), keep the linkable text channels,
 * and build a StringSelect whose labels/classifications are computed via
 * classifyChannelPrivacy(). The post-selection warning step stays as the
 * safety net ("warn unless provably public").
 */

import { ChannelType } from "@minesa-org/mini-interaction";

import { classifyChannelPrivacy } from "./channel-privacy.js";
import type { ChannelPrivacy } from "./channel-privacy.js";
import { listGuildChannels } from "./lobby-api.js";

/** Minimal structural shape of the guild channel payload we classify. */
export type ClassifiableGuildChannel = {
	id: string;
	name?: string;
	type: number;
	permission_overwrites?: Parameters<typeof classifyChannelPrivacy>[0];
};

/** Discord caps select menus at 25 options; leave room for the hint entry. */
export const MAX_MENU_CHANNELS = 24;

export type ClassifiedChannel = {
	id: string;
	name: string;
	privacy: ChannelPrivacy;
};

/** Fetches and classifies a guild's text channels for the select menu. */
export async function listGuildChannelsForMenu(guildId: string): Promise<ClassifiedChannel[]> {
	const channels = await listGuildChannels(guildId);

	return channels
		.filter((channel) => channel.type === ChannelType.GuildText)
		.map((channel) => ({
			id: channel.id,
			name: channel.name ?? channel.id,
			privacy: classifyChannelPrivacy(channel, guildId),
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

const privacyBadge = (privacy: ChannelPrivacy): string =>
	privacy === "public" ? "✅" : privacy === "private" ? "🔒" : "❓";

/** Builds the (label, value, description) triples for the channel menu. */
export function buildChannelMenuOptions(channels: ClassifiedChannel[]): {
	label: string;
	value: string;
	description?: string;
}[] {
	return channels.slice(0, MAX_MENU_CHANNELS).map((channel) => ({
		label: `${privacyBadge(channel.privacy)} ${channel.name}`.slice(0, 100),
		value: channel.id,
		description:
			channel.privacy === "public"
				? "Provably public — everyone can read & post"
				: channel.privacy === "private"
					? "Private — a warning will be shown"
					: "Privacy unknown — a warning will be shown",
	}));
}
