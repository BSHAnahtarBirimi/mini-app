/**
 * `/api/message` — the endpoint behind the web app (`/message`).
 *
 * `GET`  reports where a message would go: every linked channel this app
 *        maintains, with the channel's name resolved with the bot token so the
 *        page can say `#genel` instead of a snowflake.
 * `POST` takes `{ text }` and posts it into **all** of those channels,
 *        **through each server's lobby** when that server's member has a stored
 *        connection with `sdk.social_layer` — the same call a Social SDK game
 *        makes, so a web message and a player's message arrive the same way —
 *        and into the channel as the **bot** when it cannot (no connection, no
 *        scope, or a lobby Discord has already reaped). Every result says which
 *        path was used. Discord has no broadcast primitive, so a loop over the
 *        links is the only mechanism that exists (see
 *        `src/utils/lobby-broadcast.ts`).
 *
 * Three deliberate decisions:
 *
 * - **The endpoint is open, and rate-limited per IP** (`consumeQuota`, 5 per
 *   minute). Nothing here is a secret and the app has no user accounts, so the
 *   limit — not authentication — is what keeps one visitor from flooding every
 *   server the app is in.
 * - **The message is posted exactly as written** (`checkWebMessage`): no
 *   attribution line, no quote, no name field. Nothing of the app's voice wraps
 *   text the app did not write, so there is nothing to forge either.
 * - **Mentions are off on both paths.** The bot path sends `allowed_mentions:
 *   { parse: [] }`; the lobby path has no such option, so the content is made
 *   unable to form a mention token (`neutraliseMentions`). A stranger can never
 *   `@everyone` a server here, on either path.
 * - **Partial delivery is reported as such.** Each channel's own result is
 *   returned, so a server the bot cannot post in shows up as a failure for that
 *   channel instead of being indistinguishable from success.
 */

import { hasDatabaseConfig } from "../src/utils/database.js";
import { describeError } from "../src/utils/interaction-errors.js";
import { listGuildChannels } from "../src/utils/lobby-api.js";
import { sendToLinkedChannels } from "../src/utils/lobby-broadcast.js";
import type { DeliveryOutcome } from "../src/utils/lobby-broadcast.js";
import { consumeQuota } from "../src/utils/web-rate-limit.js";
import type { QuotaResult } from "../src/utils/web-rate-limit.js";
import { checkWebMessage, MAX_MESSAGE_LENGTH } from "../src/utils/web-message.js";
import { linkedChannelTargets } from "../src/utils/webhook-events.js";
import type { LinkedChannelTarget } from "../src/utils/webhook-events.js";

/** Minimal structural subset of the Vercel node request/response we use. */
type MessageRequest = {
	method?: string;
	headers?: Record<string, string | string[] | undefined>;
	/** Vercel parses a JSON body before the handler runs. */
	body?: unknown;
	on?: (event: string, listener: (chunk?: unknown) => void) => unknown;
};

type MessageResponse = {
	statusCode: number;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
};

/** One linked channel, as `GET` reports it. */
export type ChannelDescription = {
	guildId: string;
	channelId: string;
	/** Resolved with the bot token; null when that lookup was refused. */
	name: string | null;
};

/** Collaborators of {@link handleMessage}, injectable so it can be driven in tests. */
export type MessageDeps = {
	targets: () => Promise<LinkedChannelTarget[]>;
	listChannels: (guildId: string) => Promise<{ id: string; name?: string }[]>;
	broadcast: (content: string) => Promise<DeliveryOutcome[]>;
	quota: (ip: string) => Promise<QuotaResult>;
};

const defaultDeps: MessageDeps = {
	targets: () => linkedChannelTargets(),
	// Normalised on the way in: Discord types a channel's name as `string | null`
	// (a DM has none), and an absent name is what the page falls back to an id
	// for.
	listChannels: async (guildId) =>
		(await listGuildChannels(guildId)).map((channel) => ({
			id: channel.id,
			...(typeof channel.name === "string" && channel.name !== ""
				? { name: channel.name }
				: {}),
		})),
	broadcast: (content) => sendToLinkedChannels(content),
	quota: (ip) => consumeQuota(ip),
};

function sendJson(res: MessageResponse, status: number, payload: unknown): void {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	res.end(JSON.stringify(payload));
}

/** Case-insensitive header lookup on the plain record Vercel passes. */
function headerValue(
	headers: MessageRequest["headers"],
	name: string,
): string | undefined {
	if (!headers) return undefined;
	const direct = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
	return Array.isArray(direct) ? direct[0] : direct;
}

/**
 * The visitor's IP, for the quota.
 *
 * Vercel terminates TLS, so the real client is the first entry of
 * `x-forwarded-for`. `unknown` is a shared bucket rather than "no limit": a
 * deployment where the header is missing still cannot be flooded.
 */
function clientIp(req: MessageRequest): string {
	const forwarded = headerValue(req.headers, "x-forwarded-for");
	const first = forwarded?.split(",")[0]?.trim();
	return first || headerValue(req.headers, "x-real-ip")?.trim() || "unknown";
}

/** Reads the body Vercel already parsed, falling back to the raw stream. */
async function readBody(req: MessageRequest): Promise<Record<string, unknown>> {
	if (req.body && typeof req.body === "object") return req.body as Record<string, unknown>;
	if (typeof req.body === "string") {
		try {
			return JSON.parse(req.body) as Record<string, unknown>;
		} catch {
			return {};
		}
	}
	if (typeof req.on !== "function") return {};

	return await new Promise<Record<string, unknown>>((resolve) => {
		let raw = "";
		req.on?.("data", (chunk) => {
			raw += String(chunk ?? "");
			// Nothing legitimate is this large; stop rather than buffer a flood.
			if (raw.length > 20_000) resolve({});
		});
		req.on?.("end", () => {
			try {
				resolve(JSON.parse(raw) as Record<string, unknown>);
			} catch {
				resolve({});
			}
		});
		req.on?.("error", () => resolve({}));
	});
}

/**
 * The linked channels with their names, one channel list per server.
 *
 * A refused or failed lookup is not an error: the channel is still where the
 * message goes, so the name is reported as null and the page falls back to the
 * id. Naming is presentation, and presentation must not decide whether someone
 * can send.
 */
export async function describeChannels(deps: MessageDeps): Promise<ChannelDescription[]> {
	const targets = await deps.targets();
	const byGuild = new Map<string, LinkedChannelTarget[]>();
	for (const target of targets) {
		const list = byGuild.get(target.guildId) ?? [];
		list.push(target);
		byGuild.set(target.guildId, list);
	}

	const described: ChannelDescription[] = [];
	for (const [guildId, list] of byGuild) {
		const channels = await deps.listChannels(guildId).catch((error) => {
			console.error(`[message] could not list the channels of ${guildId}:`, error);
			return [] as { id: string; name?: string }[];
		});
		for (const target of list) {
			const channel = channels.find((entry) => entry.id === target.channelId);
			described.push({
				guildId,
				channelId: target.channelId,
				name: channel?.name ?? null,
			});
		}
	}
	return described;
}

/** `/api/message` — `GET` reports the reach, `POST` broadcasts. */
export async function handleMessage(
	req: MessageRequest,
	res: MessageResponse,
	deps: MessageDeps = defaultDeps,
): Promise<void> {
	const method = (req.method ?? "GET").toUpperCase();

	if (method === "GET") {
		try {
			const channels = await describeChannels(deps);
			sendJson(res, 200, { ok: true, total: channels.length, channels });
		} catch (error) {
			console.error("[message] could not list the linked channels:", error);
			sendJson(res, 500, { ok: false, error: `Could not read the linked channels: ${describeError(error)}` });
		}
		return;
	}

	if (method !== "POST") {
		res.setHeader("Allow", "GET, POST");
		sendJson(res, 405, { ok: false, error: "Use GET to see the linked channels, POST to send a message." });
		return;
	}

	if (!hasDatabaseConfig()) {
		sendJson(res, 500, {
			ok: false,
			error: "This deployment has no MONGODB_URI, so no channel can be linked yet.",
		});
		return;
	}

	const body = await readBody(req);
	const checked = checkWebMessage({ text: body.text });
	if (!checked.ok) {
		sendJson(res, checked.status, { ok: false, error: checked.error, limit: MAX_MESSAGE_LENGTH });
		return;
	}

	const quota = await deps.quota(clientIp(req));
	if (!quota.allowed) {
		res.setHeader("Retry-After", String(quota.retryAfterSeconds));
		sendJson(res, 429, {
			ok: false,
			error: `Too many messages from this address — wait ${quota.retryAfterSeconds}s and try again.`,
			retryAfterSeconds: quota.retryAfterSeconds,
		});
		return;
	}

	try {
		const outcomes = await deps.broadcast(checked.content);
		const sent = outcomes.filter((outcome) => outcome.ok).length;
		const results = outcomes.map((outcome) => ({
			channelId: outcome.channelId,
			ok: outcome.ok,
			...(outcome.delivery ? { delivery: outcome.delivery } : {}),
			...(outcome.messageId ? { messageId: outcome.messageId } : {}),
			// Present even on success: "it arrived, but via the bot" is how an admin
			// finds out that server's lobby is idle or its member never authorized.
			...(outcome.lobbyFallback ? { lobbyFallback: outcome.lobbyFallback } : {}),
			...(outcome.error ? { error: outcome.error } : {}),
		}));

		if (outcomes.length === 0) {
			sendJson(res, 409, {
				ok: false,
				sent: 0,
				total: 0,
				error: "No channel is linked yet — run /linked-channel in a Discord server first.",
				results,
			});
			return;
		}

		sendJson(res, sent > 0 ? 200 : 502, {
			ok: sent > 0,
			sent,
			total: outcomes.length,
			...(sent > 0 ? {} : { error: "Discord refused the message in every linked channel." }),
			...(quota.enforced ? {} : { warning: "This deployment could not record the rate limit." }),
			results,
		});
	} catch (error) {
		console.error("[message] broadcast failed:", error);
		sendJson(res, 500, { ok: false, error: `Could not send the message: ${describeError(error)}` });
	}
}

export default async function handler(req: MessageRequest, res: MessageResponse): Promise<void> {
	await handleMessage(req, res);
}
