import assert from "node:assert/strict";
import test from "node:test";

import {
	MAX_PER_WINDOW,
	WINDOW_MS,
	consumeQuota,
	decideQuota,
	pruneTimestamps,
	rateKeyFor,
} from "./web-rate-limit.ts";

/**
 * One visitor, one submission, every linked channel. The quota is what keeps
 * that from being a flood button, so the boundary — the message that is refused
 * and what `Retry-After` promises — is pinned here rather than discovered.
 */

test("timestamps outside the window are forgotten", () => {
	const now = 1_000_000;
	assert.deepEqual(
		pruneTimestamps([now - WINDOW_MS - 1, now - WINDOW_MS, now - 1], now),
		[now - 1],
		"a timestamp exactly one window old has expired",
	);
});

test("a future timestamp cannot buy extra quota", () => {
	// Timestamps are written by the server, so a skewed one only ever consumes
	// the window — it never grants room in it.
	const now = 1_000_000;
	const four = [now - 50_000, now - 40_000, now - 30_000, now - 20_000];
	assert.equal(decideQuota([...four, now + 5_000], now).allowed, false);
});

test("up to the limit is allowed, then refused until the window frees up", () => {
	const now = 1_000_000;
	// Oldest first, so the wait it reports is unambiguous: 50s of the window has
	// already elapsed when the fifth message arrives.
	const four = [now - 50_000, now - 40_000, now - 30_000, now - 20_000];

	const last = decideQuota(four, now);
	assert.equal(last.allowed, true);
	assert.equal(last.remaining, 0, "the message being decided is the last one of the window");

	const refused = decideQuota([...four, now], now);
	assert.equal(refused.allowed, false);
	assert.equal(
		refused.retryAfterSeconds,
		10,
		"it waits for the oldest message to leave the window, not for the window to end",
	);

	// Sliding, not fixed: five seconds later there is still less to wait.
	const stillRefused = decideQuota([...four, now], now + 5_000);
	assert.equal(stillRefused.allowed, false);
	assert.equal(stillRefused.retryAfterSeconds, 5);

	assert.equal(
		decideQuota([...four, now], now + 10_000).allowed,
		true,
		"and it frees up exactly one window after the oldest message",
	);
});

test("a burst old enough to fall out of the window no longer counts", () => {
	const now = 1_000_000;
	const burst = Array.from({ length: MAX_PER_WINDOW + 3 }, (_, index) => now - WINDOW_MS - 1 - index);
	assert.equal(decideQuota(burst, now).allowed, true);
});

test("the quota key is per visitor", () => {
	assert.equal(rateKeyFor("1.2.3.4"), "web-msg-rate:1.2.3.4");
	assert.notEqual(rateKeyFor("1.2.3.4"), rateKeyFor("1.2.3.5"));
});

test("with no database the quota reports itself as unenforced instead of throwing", async () => {
	// No MONGODB_URI in the test environment: the point is that a storage outage
	// or a missing variable cannot turn a submission into a 500.
	const saved = process.env.MONGODB_URI;
	delete process.env.MONGODB_URI;
	try {
		const quota = await consumeQuota("1.2.3.4");
		assert.equal(quota.allowed, true);
		assert.equal(quota.enforced, false);
	} finally {
		if (saved !== undefined) process.env.MONGODB_URI = saved;
	}
});
