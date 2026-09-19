import assert from "node:assert/strict";
import { generateKeyPairSync, sign as signWithKey } from "node:crypto";
import test from "node:test";

import handleEvents from "../../api/discord-events.ts";

/**
 * The contract Discord enforces on a Webhook Events URL.
 *
 * Discord validates the endpoint with a `PING` (empty `204`, valid
 * `Content-Type`), routinely re-checks it with deliberately invalid signatures
 * (which must be rejected with `401`, or it removes the URL and emails you), and
 * retries anything it cannot acknowledge for up to 10 minutes. Every branch is
 * driven here through the real handler, with a real Ed25519 signature.
 */

type FakeResponse = {
	statusCode: number;
	body: string;
	contentType?: string;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
};

function fakeResponse(): FakeResponse {
	const res: FakeResponse = {
		statusCode: 0,
		body: "",
		setHeader(name: string, value: string) {
			if (name.toLowerCase() === "content-type") res.contentType = value;
		},
		end(body?: string) {
			res.body = body ?? "";
		},
	};
	return res;
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyHex = Buffer.from(
	(publicKey.export({ format: "jwk" }) as { x: string }).x,
	"base64url",
).toString("hex");

/** The signature Discord would send for this body and timestamp. */
const signatureFor = (body: string, timestamp: string, key = privateKey): string =>
	signWithKey(null, Buffer.from(timestamp + body), key).toString("hex");

const previousKey = process.env.DISCORD_PUBLIC_KEY;
process.env.DISCORD_PUBLIC_KEY = publicKeyHex;

/** One delivery, signed the way Discord signs it (over `timestamp + body`). */
async function deliver(
	body: string,
	options: { signature?: string; timestamp?: string; method?: string } = {},
): Promise<FakeResponse> {
	const timestamp = options.timestamp ?? "1700000000";
	const res = fakeResponse();
	await handleEvents(
		{
			method: options.method ?? "POST",
			headers: {
				"x-signature-ed25519": options.signature ?? signatureFor(body, timestamp),
				"x-signature-timestamp": timestamp,
				host: "mini-app.example.com",
			},
			// The raw bytes are what the signature covers; Vercel parses JSON.
			rawBody: body,
		} as never,
		res as never,
	);
	return res;
}

const pingId = JSON.stringify({ version: 1, application_id: "1530890351101874277", type: 0 });
const deauthorized = JSON.stringify({
	version: 1,
	application_id: "1530890351101874277",
	type: 1,
	event: {
		type: "APPLICATION_DEAUTHORIZED",
		timestamp: "2026-09-19T20:30:00.000000",
		data: { user: { id: "285118390031351809", username: "tester" } },
	},
});

test("a signed PING is acknowledged with an empty 204 and a Content-Type", async () => {
	const captured = await deliver(pingId);
	assert.equal(captured.statusCode, 204);
	assert.equal(captured.body, "", "Discord requires an empty body here");
	assert.match(captured.contentType ?? "", /application\/json/, "Discord requires a valid Content-Type");
	assert.equal(process.env.DISCORD_PUBLIC_KEY, publicKeyHex);
});

test("an invalid signature is rejected with 401 (or Discord drops the endpoint)", async () => {
	const { privateKey: otherKey } = generateKeyPairSync("ed25519");
	const wrongSignature = signatureFor(pingId, "1700000000", otherKey);

	assert.equal((await deliver(pingId, { signature: wrongSignature })).statusCode, 401);
	assert.equal((await deliver(pingId, { signature: "not-hex" })).statusCode, 401);
	// A signature over the old timestamp must not be replayable with a new one.
	assert.equal(
		(await deliver(pingId, { signature: signatureFor(pingId, "1700000000"), timestamp: "1800000000" })).statusCode,
		401,
		"the timestamp is covered by the signature",
	);
	assert.match((await deliver(pingId, { signature: wrongSignature })).body, /Invalid request signature/);
});

test("anything but POST is refused without touching Discord's payload", async () => {
	const captured = await deliver(pingId, { method: "GET" });
	assert.equal(captured.statusCode, 405);
	assert.match(captured.body, /POST/);
});

test("a handler failure answers 500 so Discord retries the delivery", async () => {
	// No database in the test environment: the deauthorize handler cannot drop
	// the stored connection, and the delivery must not be acknowledged as done.
	const previousDb = process.env.MONGODB_URI;
	delete process.env.MONGODB_URI;
	try {
		const captured = await deliver(deauthorized);
		assert.equal(captured.statusCode, 500);
		assert.match(captured.body, /retry/);
	} finally {
		if (previousDb === undefined) delete process.env.MONGODB_URI;
		else process.env.MONGODB_URI = previousDb;
	}
});

test("without the public key everything is refused rather than trusted", async () => {
	delete process.env.DISCORD_PUBLIC_KEY;
	try {
		const captured = await deliver(pingId);
		assert.equal(captured.statusCode, 500);
		assert.match(captured.body, /DISCORD_PUBLIC_KEY/);
	} finally {
		process.env.DISCORD_PUBLIC_KEY = publicKeyHex;
	}
});

test.after(() => {
	if (previousKey === undefined) delete process.env.DISCORD_PUBLIC_KEY;
	else process.env.DISCORD_PUBLIC_KEY = previousKey;
});
