import assert from "node:assert/strict";
import test from "node:test";

import {
	appendEvent,
	hasSeenDelivery,
	hasSeenEvent,
	getRecentEvents,
	recordWebhookEvent,
} from "./event-log.ts";
import type { WebhookEventRecord } from "./event-log.ts";

/**
 * Webhook Events are redelivered with backoff when an ack is lost, and the log
 * is what makes a retry recognisable — but only for a delivery that already
 * *succeeded*, otherwise a transient failure would be marked done and the
 * notification would never happen.
 */

const entry = (overrides: Partial<WebhookEventRecord> = {}): WebhookEventRecord => ({
	at: "2026-09-19T20:30:00.000Z",
	type: "APPLICATION_DEAUTHORIZED",
	summary: "deauthorized by tester (1)",
	key: "APPLICATION_DEAUTHORIZED:t:1",
	...overrides,
});

test("the log keeps the newest entries first and stays bounded", () => {
	let events: WebhookEventRecord[] = [];
	for (let index = 0; index < 25; index += 1) {
		events = appendEvent(events, entry({ summary: `event ${index}` }), 20);
	}

	assert.equal(events.length, 20);
	assert.equal(events[0]?.summary, "event 24");
	assert.ok(
		!events.some((event) => event.summary === "event 0"),
		"the oldest entries fall out of the window",
	);
});

test("long summaries are truncated so one event cannot bloat the log", () => {
	const [stored] = appendEvent([], entry({ summary: "x".repeat(500) }));
	assert.equal(stored?.summary.length, 240);
});

test("a redelivery is recognised, a new delivery is not", () => {
	const events = [entry()];
	assert.equal(hasSeenEvent(events, "APPLICATION_DEAUTHORIZED:t:1"), true);
	assert.equal(hasSeenEvent(events, "APPLICATION_DEAUTHORIZED:t:2"), false);
	assert.equal(hasSeenEvent(events, undefined), false, "entries without a key are never deduped");
	assert.equal(hasSeenEvent([], "anything"), false);
});

test("without a database the log degrades to 'nothing seen, nothing stored'", async () => {
	const previous = process.env.MONGODB_URI;
	delete process.env.MONGODB_URI;
	try {
		assert.deepEqual(await getRecentEvents(), []);
		assert.equal(await hasSeenDelivery("key"), false);
		// Must not throw: losing a log line may never fail a delivery.
		await recordWebhookEvent(entry());
	} finally {
		if (previous === undefined) delete process.env.MONGODB_URI;
		else process.env.MONGODB_URI = previous;
	}
});
