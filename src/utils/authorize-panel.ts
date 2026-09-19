/**
 * The message `/authorize` sends, built two ways.
 *
 * Authorizing is the one step of the Linked Channels flow that happens outside
 * Discord: the consent screen is a browser page, so the command's whole job is
 * to hand over a link — and to say what the app currently believes about the
 * caller's connection, because a revoked token looks fine in storage until
 * Discord rejects it.
 *
 * Same rules as the Linked Channels payloads (see `linked-channel-panel.ts`):
 * the library's `SectionBuilder` throws when a section has no accessory, so
 * plain text goes *directly* into the container and only a block with a real
 * accessory is wrapped in a section. Both forms are built so a refused edit can
 * still complete with the legacy payload instead of leaving the command on
 * "«bot» is thinking…".
 */

import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	MessageFlags,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
} from "@minesa-org/mini-interaction";
import type { MessageActionRowComponent } from "@minesa-org/mini-interaction";

import { AUTHORIZE_COMMAND } from "./lobby-oauth.ts";

/** Message flags for the V2 completion. */
export const AUTHORIZE_V2_FLAGS = MessageFlags.IsComponentsV2;

/** What the app knows about the caller's stored connection. */
export type AuthorizeStatus = {
	/** A token record exists. */
	connected: boolean;
	/** Scopes that record grants, when it exists. */
	scope?: string | null;
	/** Whether `scope` includes `sdk.social_layer`. */
	hasSocialLayer: boolean;
};

export type AuthorizePanelData = {
	/** `openid sdk.social_layer` consent URL, or null when the env is incomplete. */
	authorizeUrl: string | null;
	/** Why the URL is missing, when it is. */
	missingEnv?: string[];
	status: AuthorizeStatus;
};

export type AuthorizePayloadPair = {
	v2: { flags: number; components: ContainerBuilder[] };
	legacy: { content: string; components: ActionRowBuilder<MessageActionRowComponent>[] };
};

const text = (content: string) => new TextDisplayBuilder().setContent(content);

const divider = () =>
	new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true);

const HEADING = [
	"## 🔐 Authorize Discord",
	"Authorizing this app with **your** Discord account is what lets",
	"it act for you: link a channel to a game lobby, unlink it,",
	"create your lobby invite, and post into the lobby.",
].join("\n");

const SCOPE_NOTE = [
	"### 🔑 What it asks for",
	"`openid sdk.social_layer` — the Social SDK scope. It is",
	"**limited access**: the consent screen only works once Discord",
	"has accepted this application into its Social SDK program.",
].join("\n");

const FALLBACK_NOTE = [
	"### ℹ️ No link to show",
	"The deployment has no `DISCORD_CLIENT_SECRET` / `DISCORD_REDIRECT_URI`,",
	"so it cannot build the authorize URL. Set them and try again.",
].join("\n");

/** One line describing the stored connection, from the caller's point of view. */
export function statusLine(status: AuthorizeStatus): string {
	if (!status.connected) return "**Status:** no connection stored yet.";
	if (!status.hasSocialLayer) {
		return `**Status:** connected, but the granted scopes are \`${status.scope ?? "unknown"}\` — **\`sdk.social_layer\` is missing**, so linking is refused. Re-authorize below.`;
	}
	return `**Status:** connected as \`${status.scope ?? "unknown"}\`. Re-authorize if linking still fails (for example after you removed the app from your Authorized Apps, which revokes the stored token without warning the app).`;
}

/** The `/authorize` message: what is granted now, and the link to fix it. */
export function buildAuthorizePayloads(data: AuthorizePanelData): AuthorizePayloadPair {
	const status = statusLine(data.status);
	const button = () =>
		new ButtonBuilder()
			.setStyle(ButtonStyle.Link)
			.setLabel(data.status.hasSocialLayer ? "🔁 Re-authorize Discord" : "🔐 Authorize Discord")
			.setURL(data.authorizeUrl ?? "");

	const container = new ContainerBuilder().setAccentColor(0x5865f2);
	container.addComponent(text(HEADING));
	container.addComponent(divider());
	container.addComponent(text(status));
	container.addComponent(divider());
	container.addComponent(text(data.authorizeUrl ? SCOPE_NOTE : FALLBACK_NOTE));

	if (data.authorizeUrl) {
		// A link button is the only interactive piece here — no section needed.
		container.addComponent(
			new ActionRowBuilder<MessageActionRowComponent>().addComponents(button()),
		);
	}

	const legacyContent = [
		HEADING,
		"",
		status,
		"",
		data.authorizeUrl ? SCOPE_NOTE : FALLBACK_NOTE,
		...(data.authorizeUrl ? ["", `🔐 ${data.authorizeUrl}`] : []),
		...(data.missingEnv?.length ? ["", `Missing: ${data.missingEnv.join(", ")}`] : []),
	].join("\n");

	return {
		v2: { flags: AUTHORIZE_V2_FLAGS, components: [container] },
		legacy: {
			content: legacyContent,
			components: data.authorizeUrl
				? [
						new ActionRowBuilder<MessageActionRowComponent>().addComponents(
							new ButtonBuilder()
								.setStyle(ButtonStyle.Link)
								.setLabel("🔐 Authorize Discord")
								.setURL(data.authorizeUrl),
						),
					]
				: [],
		},
	};
}

/** The command name users type, exported so docs and tests cannot drift. */
export const AUTHORIZE_COMMAND_NAME = AUTHORIZE_COMMAND.replace(/^\//, "");
