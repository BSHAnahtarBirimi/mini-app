/**
 * Webhook Events (Discord's "outgoing webhooks").
 *
 * Discord posts these to the endpoint configured on the app's **Webhooks** page
 * in the Developer Portal, signed with the same Ed25519 headers as
 * interactions. Unlike Gateway events they are neither realtime nor ordered, and
 * a delivery that is not acknowledged with an empty `204` inside 3 seconds is
 * retried with exponential backoff for up to 10 minutes — so handlers have to be
 * idempotent.
 *
 * The example this app implements is `APPLICATION_DEAUTHORIZED`: for a Social SDK
 * app that event is the **only** out-of-game signal that a user's link state
 * changed, and every revocation is mechanically an unmerge — the OAuth2 tokens
 * become invalid. So the handler
 *
 * 1. drops the stored connection, so the panel stops claiming one, and
 * 2. posts a notice in the linked channel of every lobby that user owns, so the
 *    server knows linking will fail until they reconnect.
 *
 * Every received event is also logged (`src/utils/event-log.ts`) and reported by
 * `GET /api/diag`, which is how the endpoint and a subscribed event can be
 * verified without dashboard access.
 */

import {
	WebhookEventEndpoint,
	WebhookEventRouter,
	WebhookEventType,
} from "@minesa-org/mini-interaction";
import type { WebhookEventPayload, WebhookEventPingPayload } from "@minesa-org/mini-interaction";

import { hasSeenDelivery, recordWebhookEvent } from "./event-log.ts";
import { describeError, recordInteractionError } from "./interaction-errors.ts";
import {
	describeLobbyError,
	getLobby,
	linkedChannelIdOf,
	sendChannelMessage,
} from "./lobby-api.ts";
import { getLobbyRecord, listLobbyGuilds } from "./lobby-store.ts";
import { deleteUserToken } from "./lobby-tokens.ts";

// ------------------------------------------------------------------ summaries

type Loose = Record<string, unknown>;

const text = (value: unknown): string | undefined =>
	typeof value === "string" && value !== "" ? value : undefined;

const loose = (value: unknown): Loose | undefined =>
	typeof value === "object" && value !== null ? (value as Loose) : undefined;

/** `name (id)` for whatever user object the event carries. */
function who(value: unknown): string {
	const user = loose(value);
	const name = text(user?.username) ?? text(user?.global_name);
	const id = text(user?.id);
	if (name && id) return `${name} (${id})`;
	return name ?? id ?? "an unknown user";
}

/**
 * One line describing an event, for the log and `/api/diag`.
 *
 * Deliberately loose about the payload: the point is to recognise what arrived
 * while testing the endpoint, so an unknown or slightly different shape must
 * still produce something readable rather than throw.
 */
export function summarizeEvent(payload: WebhookEventPayload): string {
	const event = payload.event;
	const data = event?.data as Loose | undefined;

	switch (event?.type) {
		case WebhookEventType.ApplicationAuthorized: {
			const guild = loose(data?.guild);
			const where = text(guild?.name)
				? `in server ${text(guild?.name)}`
				: data?.integration_type === 1
					? "to their account"
					: "to a server";
			const scopes = Array.isArray(data?.scopes) ? (data?.scopes as string[]).join(", ") : "none";
			return `authorized by ${who(data?.user)} ${where} — scopes: ${scopes}`;
		}
		case WebhookEventType.ApplicationDeauthorized:
			return `deauthorized by ${who(data?.user)}`;
		case WebhookEventType.LobbyMessageCreate:
			return `lobby message in <#${text(data?.channel_id) ?? "?"}> by ${who(data?.author)}: ${text(data?.content) ?? ""}`;
		case WebhookEventType.LobbyMessageUpdate:
			return `lobby message edited in <#${text(data?.channel_id) ?? "?"}>: ${text(data?.content) ?? ""}`;
		case WebhookEventType.LobbyMessageDelete:
			return `lobby message ${text(data?.id) ?? "?"} deleted from lobby ${text(data?.lobby_id) ?? "?"}`;
		case WebhookEventType.GameDirectMessageCreate:
			return `game direct message by ${who(data?.author)}: ${text(data?.content) ?? ""}`;
		case WebhookEventType.GameDirectMessageUpdate:
			return `game direct message edited: ${text(data?.content) ?? ""}`;
		case WebhookEventType.GameDirectMessageDelete:
			return `game direct message ${text(data?.id) ?? "?"} deleted`;
		case WebhookEventType.EntitlementCreate:
			return `entitlement ${text(data?.id) ?? "?"} created for user ${text(data?.user_id) ?? "?"}`;
		case WebhookEventType.EntitlementUpdate:
			return `entitlement ${text(data?.id) ?? "?"} updated`;
		case WebhookEventType.EntitlementDelete:
			return `entitlement ${text(data?.id) ?? "?"} deleted`;
		default:
			return "";
	}
}

/**
 * Stable identity of one delivery, so a retry is recognised.
 *
 * Discord does not give an event id, but a retried delivery repeats the payload
 * byte for byte — including `event.timestamp` — so type + timestamp + subject
 * identifies it.
 */
export function deliveryKeyOf(payload: WebhookEventPayload | WebhookEventPingPayload): string | undefined {
	if (!("event" in payload) || !payload.event) return undefined;
	const data = loose(payload.event.data);
	const subject = text(loose(data?.user)?.id) ?? text(loose(data?.author)?.id) ?? text(data?.id) ?? "";
	return `${payload.event.type}:${payload.event.timestamp}:${subject}`;
}

// ---------------------------------------------------------------- deauthorize

/** The message posted in a linked channel when its lobby's owner disconnects. */
export function deauthorizationMessage(user: { id: string; username?: string }): string {
	const name = user.username ? `**${user.username}**` : "The account that linked this channel";
	return [
		`👋 ${name} disconnected this app from Discord.`,
		"Channel linking and lobby invites need their Discord connection, so those actions will fail until they reconnect — `/linked-channel` → **🔁 Reconnect Discord**.",
		"Lobby members can still read and post in this channel.",
	].join("\n");
}

/** Collaborators of {@link notifyLinkedChannelsOfDeauthorization}, injectable for tests. */
export type DeauthorizeDeps = {
	listGuilds: () => Promise<string[]>;
	getLobbyRecord: (guildId: string) => Promise<{ lobbyId: string; creatorId: string } | null>;
	readLinkedChannelId: (lobbyId: string) => Promise<string | null>;
	sendChannelMessage: (channelId: string, content: string) => Promise<unknown>;
	deleteUserToken: (userId: string) => Promise<void>;
};

export type DeauthorizeOutcome = {
	/** `guildId → channelId` for the links that were notified. */
	notified: { guildId: string; channelId: string }[];
	/** Guilds owned by the user whose link has no channel to post in. */
	withoutLinkedChannel: string[];
	/** Lobbies owned by the user, whether or not they had a channel. */
	ownedGuilds: string[];
	/** The stored connection was dropped (always attempted first). */
	connectionDeleted: boolean;
};

const defaultDeps: DeauthorizeDeps = {
	listGuilds: listLobbyGuilds,
	getLobbyRecord,
	readLinkedChannelId: async (lobbyId) => linkedChannelIdOf(await getLobby(lobbyId)),
	sendChannelMessage: (channelId, content) => sendChannelMessage(channelId, content),
	deleteUserToken,
};

/**
 * Handles `APPLICATION_DEAUTHORIZED` for one user.
 *
 * Drops the stored connection first: the tokens are invalid the moment this
 * event fires, and that step is idempotent, so it must not depend on the
 * notification succeeding. Then each lobby the user owns gets a notice in its
 * linked channel — the only server that cared was the one whose link that user
 * set up (other members' connections are unaffected, and announcing a user in
 * servers they merely visited would leak their presence).
 */
export async function notifyLinkedChannelsOfDeauthorization(
	user: { id: string; username?: string },
	deps: DeauthorizeDeps = defaultDeps,
): Promise<DeauthorizeOutcome> {
	await deps.deleteUserToken(user.id);

	const outcome: DeauthorizeOutcome = {
		notified: [],
		withoutLinkedChannel: [],
		ownedGuilds: [],
		connectionDeleted: true,
	};

	for (const guildId of await deps.listGuilds()) {
		const record = await deps.getLobbyRecord(guildId);
		if (!record || record.creatorId !== user.id) continue;
		outcome.ownedGuilds.push(guildId);

		// A lobby without a linked channel has nowhere to post, and its id may
		// have been reaped — neither is a failure of this delivery.
		const channelId = await deps.readLinkedChannelId(record.lobbyId).catch(() => null);
		if (!channelId) {
			outcome.withoutLinkedChannel.push(guildId);
			continue;
		}

		await deps.sendChannelMessage(channelId, deauthorizationMessage(user));
		outcome.notified.push({ guildId, channelId });
	}

	return outcome;
}

// --------------------------------------------------------------------- router

/**
 * The event router this app serves.
 *
 * `onAny` logs every subscribed event, so subscribing to e.g.
 * `LOBBY_MESSAGE_CREATE` shows up in `/api/diag` as proof that a linked channel
 * is live, and `onError` records failures and rethrows: Discord then retries the
 * delivery, which is what we want for an at-least-once notification.
 */
export function buildEventRouter(): WebhookEventRouter {
	return new WebhookEventRouter()
		.onPing(async (payload: WebhookEventPingPayload) => {
			await recordWebhookEvent({
				at: new Date().toISOString(),
				type: "PING",
				summary: `endpoint validation for app ${payload.application_id}`,
				handled: "acknowledged with 204",
			});
		})
		.on(WebhookEventType.ApplicationDeauthorized, async (payload) => {
			const key = deliveryKeyOf(payload);
			const summary = summarizeEvent(payload);

			// Recorded *after* the work: a failed delivery must be retried, so it
			// must not look "already handled".
			if (await hasSeenDelivery(key)) return;

			const user = payload.event.data?.user;
			const outcome = await notifyLinkedChannelsOfDeauthorization({
				id: user?.id ?? "",
				username: user?.username,
			});

			await recordWebhookEvent({
				at: new Date().toISOString(),
				type: payload.event.type,
				summary,
				key,
				handled: [
					outcome.connectionDeleted ? "connection dropped" : "",
					`${outcome.notified.length} linked channel(s) notified`,
					outcome.withoutLinkedChannel.length > 0
						? `${outcome.withoutLinkedChannel.length} without a linked channel`
						: "",
				]
					.filter(Boolean)
					.join("; "),
			});
		})
		.onAny(async (payload) => {
			const key = deliveryKeyOf(payload);
			if (await hasSeenDelivery(key)) return;
			await recordWebhookEvent({
				at: new Date().toISOString(),
				type: payload.event?.type ?? "UNKNOWN",
				summary: summarizeEvent(payload),
				key,
				handled: "logged only",
			});
		})
		.onError(async (error, request) => {
			console.error("[webhook-events] handler failed:", error);
			const type = "event" in request ? (request.event?.type ?? "unknown") : "PING";
			await recordInteractionError(error, `webhook-events:${type}`);
			// Rethrowing turns the ack into a 500 so Discord retries the delivery.
			throw new Error(`[webhook-events] ${describeError(error)}`);
		});
}

/** Verifies and dispatches Webhook Events for this app's endpoint URL. */
export function buildWebhookEventEndpoint(publicKey: string): WebhookEventEndpoint {
	return new WebhookEventEndpoint({ publicKey, router: buildEventRouter() });
}

/** Re-exported so the endpoint can describe a rejected delivery without parsing it. */
export { describeLobbyError };
