import assert from "node:assert/strict";
import test from "node:test";

import { handleMessage } from "../../api/message.ts";
import type { MessageDeps } from "../../api/message.ts";
import type { DeliveryOutcome } from "./lobby-broadcast.ts";
import type { LinkedChannelTarget } from "./webhook-events.ts";

/**
 * The web app's endpoint is the one thing here a stranger reaches, so it is
 * driven for real — the same way `authorize-endpoint.test.ts` drives `/api/diag`
 * — instead of being trusted to behave. What matters is the contract: what it
 * says when there is nothing linked, when the quota is gone, when a channel in
 * the middle fails, and that a refusal never reaches Discord.
 */

type FakeResponse = {
	statusCode: number;
	body: string;
	headers: Record<string, string>;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
};

function fakeResponse(): FakeResponse {
	const res: FakeResponse = {
		statusCode: 0,
		body: "",
		headers: {},
		setHeader(name, value) {
			res.headers[name.toLowerCase()] = value;
		},
		end(body) {
			res.body = body ?? "";
		},
	};
	return res;
}

const channels: LinkedChannelTarget[] = [
	{ guildId: "1525905980422885406", lobbyId: "1", channelId: "1525905982000070780" },
	{ guildId: "1550970322860384317", lobbyId: "2", channelId: "1550970323917340694" },
];

const namesByGuild: Record<string, { id: string; name?: string }[]> = {
	"1525905980422885406": [{ id: "1525905982000070780", name: "genel" }],
	"1550970322860384317": [{ id: "1550970323917340694", name: "klipler" }],
};

/** Records what would have been posted, and lets one channel be made to fail. */
function recordingDeps(overrides: Partial<MessageDeps> = {}) {
	const posted: string[] = [];
	const deps: MessageDeps = {
		targets: async () => channels,
		listChannels: async (guildId) => namesByGuild[guildId] ?? [],
		broadcast: async (content) => {
			posted.push(content);
			// Whatever `targets` currently answers is what the real broadcast would
			// have found, so overriding `targets` alone is enough to test the empty
			// case.
			return (await deps.targets()).map(
				(target): DeliveryOutcome => ({
					guildId: target.guildId,
					lobbyId: target.lobbyId,
					channelId: target.channelId,
					ok: true,
					delivery: "lobby",
					messageId: `msg-${target.channelId}`,
				}),
			);
		},
		quota: async () => ({ allowed: true, remaining: 4, retryAfterSeconds: 0, enforced: true }),
		...overrides,
	};
	return { deps, posted };
}

/** Runs one request. `MONGODB_URI` is faked because the handler checks it exists. */
async function call(
	req: Parameters<typeof handleMessage>[0],
	deps: MessageDeps,
	{ withDatabase = true } = {},
): Promise<FakeResponse> {
	const saved = process.env.MONGODB_URI;
	if (withDatabase) process.env.MONGODB_URI = "mongodb://fake";
	else delete process.env.MONGODB_URI;
	const res = fakeResponse();
	try {
		await handleMessage(req, res, deps);
	} finally {
		if (saved !== undefined) process.env.MONGODB_URI = saved;
		else delete process.env.MONGODB_URI;
	}
	return res;
}

const json = (res: FakeResponse) => JSON.parse(res.body) as Record<string, unknown>;

test("GET reports every linked channel with its name", async () => {
	const { deps } = recordingDeps();
	const res = await call({ method: "GET" }, deps);

	assert.equal(res.statusCode, 200);
	assert.deepEqual(json(res), {
		ok: true,
		total: 2,
		channels: [
			{ guildId: "1525905980422885406", channelId: "1525905982000070780", name: "genel" },
			{ guildId: "1550970322860384317", channelId: "1550970323917340694", name: "klipler" },
		],
	});
});

test("a refused channel lookup still lists the channel", async () => {
	// Naming is presentation; it must not decide whether a message can be sent.
	const { deps } = recordingDeps({
		listChannels: async () => {
			throw new Error("403 Missing Access");
		},
	});
	const res = await call({ method: "GET" }, deps);

	assert.equal(res.statusCode, 200);
	const body = json(res);
	assert.equal(body.total, 2);
	assert.deepEqual(
		(body.channels as { name: string | null }[]).map((channel) => channel.name),
		[null, null],
	);
});

test("POST posts the message, as written, into every linked channel", async () => {
	const { deps, posted } = recordingDeps();
	const res = await call(
		{ method: "POST", headers: { "x-forwarded-for": "203.0.113.7" }, body: { text: "hello all" } },
		deps,
	);

	assert.equal(res.statusCode, 200);
	assert.equal(json(res).sent, 2);
	assert.equal(json(res).total, 2);
	assert.deepEqual(posted, ["hello all"], "the text is what goes out — nothing is wrapped around it");
	assert.deepEqual(
		(json(res).results as { messageId?: string }[]).map((entry) => entry.messageId),
		["msg-1525905982000070780", "msg-1550970323917340694"],
		"each channel's own message id is reported",
	);
	assert.deepEqual(
		(json(res).results as { delivery?: string }[]).map((entry) => entry.delivery),
		["lobby", "lobby"],
		"and which path delivered it — through the lobby, or the bot as a fallback",
	);
});

test("an empty message is refused before anything is posted", async () => {
	const { deps, posted } = recordingDeps();
	const res = await call({ method: "POST", body: { text: "   " } }, deps);

	assert.equal(res.statusCode, 400);
	assert.equal(json(res).ok, false);
	assert.deepEqual(posted, [], "nothing reached Discord");
});

test("a refused quota says when to retry and posts nothing", async () => {
	const { deps, posted } = recordingDeps({
		quota: async () => ({ allowed: false, remaining: 0, retryAfterSeconds: 42, enforced: true }),
	});
	const res = await call({ method: "POST", body: { text: "hi" } }, deps);

	assert.equal(res.statusCode, 429);
	assert.equal(res.headers["retry-after"], "42");
	assert.equal(json(res).retryAfterSeconds, 42);
	assert.match(String(json(res).error), /42s/);
	assert.deepEqual(posted, []);
});

test("the quota is keyed by the caller's address", async () => {
	const seen: string[] = [];
	const { deps } = recordingDeps({
		quota: async (ip) => {
			seen.push(ip);
			return { allowed: true, remaining: 1, retryAfterSeconds: 0, enforced: true };
		},
	});

	await call({ method: "POST", headers: { "x-forwarded-for": "203.0.113.7, 70.41.3.18" }, body: { text: "a" } }, deps);
	await call({ method: "POST", headers: { "x-real-ip": "198.51.100.4" }, body: { text: "b" } }, deps);

	assert.deepEqual(seen, ["203.0.113.7", "198.51.100.4"], "the client is the first hop, not the proxy");
});

test("nothing linked is reported as such, not as a failure", async () => {
	const { deps, posted } = recordingDeps({ targets: async () => [] });
	const res = await call({ method: "POST", body: { text: "hi" } }, deps);

	assert.equal(res.statusCode, 409);
	assert.equal(json(res).ok, false);
	assert.match(String(json(res).error), /No channel is linked yet/);
	assert.equal(posted.length, 1, "the message was composed, and there was nowhere to put it");
	assert.deepEqual(json(res).results, []);
});

test("a bot fallback is reported, so an idle lobby is visible rather than silent", async () => {
	const { deps } = recordingDeps({
		broadcast: async () => [
			{
				guildId: channels[0].guildId,
				lobbyId: channels[0].lobbyId,
				channelId: channels[0].channelId,
				ok: true,
				delivery: "channel",
				messageId: "msg-1",
				lobbyFallback: "404 — Unknown Lobby",
			},
		],
	});
	const res = await call({ method: "POST", body: { text: "hi" } }, deps);

	assert.equal(res.statusCode, 200);
	assert.deepEqual(json(res).results, [
		{
			channelId: "1525905982000070780",
			ok: true,
			delivery: "channel",
			messageId: "msg-1",
			lobbyFallback: "404 — Unknown Lobby",
		},
	]);
});

test("one failing channel does not hide the others", async () => {
	const { deps } = recordingDeps({
		broadcast: async () =>
			channels.map((target, index) =>
				index === 0
					? {
							guildId: target.guildId,
							lobbyId: target.lobbyId,
							channelId: target.channelId,
							ok: false,
							error: "403 — Missing Permissions",
							status: 403,
						}
					: {
							guildId: target.guildId,
							lobbyId: target.lobbyId,
							channelId: target.channelId,
							ok: true,
							delivery: "lobby",
							messageId: "msg-2",
						},
			),
	});
	const res = await call({ method: "POST", body: { text: "hi" } }, deps);

	assert.equal(res.statusCode, 200, "a partial delivery is still a delivery");
	assert.equal(json(res).ok, true);
	assert.equal(json(res).sent, 1);
	assert.equal(json(res).total, 2);
	const results = json(res).results as { ok: boolean; error?: string }[];
	assert.equal(results[0]?.ok, false);
	assert.match(String(results[0]?.error), /Missing Permissions/);
});

test("every channel failing is an error, with Discord's reason per channel", async () => {
	const { deps } = recordingDeps({
		broadcast: async () =>
			channels.map((target) => ({
				guildId: target.guildId,
				lobbyId: target.lobbyId,
				channelId: target.channelId,
				ok: false,
				error: "401 — Unauthorized",
				status: 401,
			})),
	});
	const res = await call({ method: "POST", body: { text: "hi" } }, deps);

	assert.equal(res.statusCode, 502);
	assert.equal(json(res).ok, false);
	assert.equal(json(res).sent, 0);
	assert.match(String(json(res).error), /every linked channel/);
});

test("other methods are refused with what is allowed", async () => {
	const { deps, posted } = recordingDeps();
	const res = await call({ method: "DELETE" }, deps);

	assert.equal(res.statusCode, 405);
	assert.equal(res.headers.allow, "GET, POST");
	assert.deepEqual(posted, []);
});

test("without a database the endpoint says so instead of pretending to send", async () => {
	const { deps, posted } = recordingDeps();
	const res = await call({ method: "POST", body: { text: "hi" } }, deps, { withDatabase: false });

	assert.equal(res.statusCode, 500);
	assert.match(String(json(res).error), /MONGODB_URI/);
	assert.deepEqual(posted, []);
});
