/**
 * `POST /api/discord-events` — Discord Webhook Events.
 *
 * This is the URL to paste into the Developer Portal's **Webhooks** page
 * (Endpoint URL field), then enable events and tick the ones you want. Discord
 * validates it by sending a `PING` and expects an empty `204` with a valid
 * `Content-Type`; it also routinely re-checks the endpoint with deliberately
 * invalid signatures, and removes the URL if they are not rejected.
 *
 * The payload is signed with the same Ed25519 headers as interactions, and the
 * signature covers the **raw** body — so nothing here may re-serialise the JSON
 * before verification. Handlers run *before* the acknowledgement (there is no
 * `waitUntil`), because for the example this app implements —
 * `APPLICATION_DEAUTHORIZED` — a lost notification is worse than a slow ack:
 * Discord retries an unanswered delivery for up to 10 minutes, and the handler
 * is written to be idempotent (see `src/utils/webhook-events.ts`).
 */

import { buildWebhookEventEndpoint } from "../src/utils/webhook-events.js";

type EventsRequest = {
	method?: string;
	headers?: Record<string, string | string[] | undefined>;
	/** Vercel may hand the parsed JSON back instead of the raw bytes. */
	body?: unknown;
	rawBody?: string | Uint8Array;
	[Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
};

type EventsResponse = {
	statusCode: number;
	setHeader?: (name: string, value: string) => void;
	end: (body?: string) => void;
};

function header(
	headers: EventsRequest["headers"],
	name: string,
): string | undefined {
	if (!headers) return undefined;
	const direct =
		headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
	if (Array.isArray(direct)) return direct[0];
	return direct;
}

/**
 * The exact bytes Discord signed.
 *
 * Mirrors `MiniInteraction.readRawBody`: the signature is computed over the raw
 * body, so a re-serialised `JSON.stringify(req.body)` would only verify while it
 * happens to reproduce Discord's own formatting. Vercel exposes the untouched
 * payload on `req.rawBody` when available, and the stream is the last resort.
 */
async function readRawBody(req: EventsRequest): Promise<string> {
	if (typeof req.rawBody === "string") return req.rawBody;
	if (req.rawBody instanceof Uint8Array) return Buffer.from(req.rawBody).toString("utf8");
	if (typeof req.body === "string") return req.body;
	if (req.body instanceof Uint8Array) return Buffer.from(req.body).toString("utf8");
	if (req.body && typeof req.body === "object") return JSON.stringify(req.body);
	if (typeof req[Symbol.asyncIterator] === "function") {
		const chunks: Buffer[] = [];
		for await (const chunk of req as AsyncIterable<unknown>) {
			chunks.push(Buffer.from(chunk as Uint8Array));
		}
		return Buffer.concat(chunks).toString("utf8");
	}
	return "";
}

function send(res: EventsResponse, statusCode: number, body?: Record<string, unknown>): void {
	res.statusCode = statusCode;
	res.setHeader?.("Content-Type", "application/json; charset=utf-8");
	res.end(body ? JSON.stringify(body) : undefined);
}

export default async function handler(req: EventsRequest, res: EventsResponse): Promise<void> {
	if (req.method && req.method !== "POST") {
		send(res, 405, { error: "Discord posts webhook events here; use POST." });
		return;
	}

	const publicKey = process.env.DISCORD_PUBLIC_KEY?.trim();
	if (!publicKey) {
		// Without the public key nothing can be verified, so never ack anything.
		send(res, 500, { error: "DISCORD_PUBLIC_KEY is not set." });
		return;
	}

	const body = await readRawBody(req);
	const { status } = await buildWebhookEventEndpoint(publicKey).handle({
		body,
		signature: header(req.headers, "x-signature-ed25519"),
		timestamp: header(req.headers, "x-signature-timestamp"),
	});

	if (status === 204) {
		// Empty body, but Discord requires a Content-Type to accept the ack.
		send(res, 204);
		return;
	}

	send(res, status, {
		error:
			status === 401
				? "Invalid request signature."
				: status === 400
					? "Unparseable event payload."
					: "Event handler failed — Discord will retry this delivery.",
	});
}
