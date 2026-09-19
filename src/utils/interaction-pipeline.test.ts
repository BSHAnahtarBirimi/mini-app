import assert from "node:assert/strict";
import { generateKeyPairSync, sign as signPayload } from "node:crypto";
import test from "node:test";

/**
 * End-to-end guard for the interaction response pipeline.
 *
 * A deferred interaction shows "«bot» is thinking…" until the follow-up edit
 * arrives. If the deferral is sent but the edit is not — a wrong webhook path,
 * a throwing payload normaliser, an exception after the acknowledgement — the
 * message stays stuck on "thinking…" forever, which is invisible in logs and
 * looks like a hung command.
 *
 * This drives the real endpoint from `api/interactions.ts` with a Discord
 * ed25519 signature and a stubbed `fetch`, so it observes the deferred
 * acknowledgement and the exact request that completes it.
 */

/** ed25519 SPKI DER is a fixed prefix followed by the raw 32-byte key. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function rawPublicKeyHex(publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"]): string {
	const der = publicKey.export({ type: "spki", format: "der" }) as Buffer;
	return der.subarray(ED25519_SPKI_PREFIX.length).toString("hex");
}

type Captured = { method: string; url: string; body?: string };

test("a slash command is acknowledged first and completed with a webhook edit", async () => {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const publicKeyHex = rawPublicKeyHex(publicKey);

	const calls: Captured[] = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
		const url = typeof input === "string" ? input : String((input as { url?: string }).url);
		calls.push({
			method: init.method ?? "GET",
			url,
			body: typeof init.body === "string" ? init.body : undefined,
		});
		return new Response(JSON.stringify({ id: "1", channel_id: "2" }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;

	// The endpoint builds its client at import time; the handler itself stops
	// right after acknowledging because no database is configured here.
	process.env.DISCORD_APPLICATION_ID = "1530890351101874277";
	process.env.DISCORD_BOT_TOKEN = "test-bot-token";
	process.env.DISCORD_PUBLIC_KEY = publicKeyHex;
	const previousMongo = process.env.MONGODB_URI;
	delete process.env.MONGODB_URI;

	try {
		const { default: handler } = (await import("../../api/interactions.ts")) as {
			default: (req: unknown, res: unknown) => Promise<void>;
		};

		const payload = JSON.stringify({
			id: "111111111111111111",
			application_id: "1530890351101874277",
			type: 2,
			token: "interaction-token",
			guild_id: "1525905980422885406",
			member: { user: { id: "285118390031351809" } },
			data: { id: "222222222222222222", name: "linked-channel", type: 1, options: [] },
		});
		const timestamp = String(Math.floor(Date.now() / 1000));
		const signature = signPayload(
			null,
			Buffer.from(timestamp + payload),
			privateKey,
		).toString("hex");

		let initial: { type?: number; data?: { flags?: number } } | null = null;
		const res = {
			statusCode: 0,
			setHeader() {},
			end(body?: string) {
				initial = JSON.parse(body ?? "null");
			},
		};

		await handler(
			{
				method: "POST",
				headers: {
					"x-signature-ed25519": signature,
					"x-signature-timestamp": timestamp,
				},
				rawBody: payload,
			},
			res,
		);

		// Read through an explicit type: TypeScript does not track assignments
		// made inside the response stub, so `initial` stays narrowed to null.
		const seen = initial as { type?: number; data?: { flags?: number } } | null;
		assert.equal(seen?.type, 5, "the first response must be a deferred acknowledgement");
		assert.equal(seen?.data?.flags, 64, "the deferral must be ephemeral");

		// The completion runs as a background task after the acknowledgement.
		await new Promise((resolve) => setTimeout(resolve, 250));

		const edit = calls.find((call) => call.method === "PATCH");
		assert.ok(
			edit,
			`expected the deferred response to be completed by a webhook edit, saw: ${JSON.stringify(calls)}`,
		);
		assert.match(
			edit.url,
			/\/webhooks\/1530890351101874277\/interaction-token\/messages\/@original$/,
			"the edit must target the interaction's original response",
		);
		assert.ok(edit.body, "the edit must carry a payload");
	} finally {
		globalThis.fetch = originalFetch;
		if (previousMongo === undefined) delete process.env.MONGODB_URI;
		else process.env.MONGODB_URI = previousMongo;
	}
});
