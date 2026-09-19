import assert from "node:assert/strict";
import test from "node:test";

import {
	PENDING_LINK_TTL_MS,
	isFreshPendingLink,
	parsePendingLink,
} from "./linked-channel-state.js";
import type { PendingLink } from "./linked-channel-state.js";

const record = (overrides: Partial<PendingLink> = {}): PendingLink => ({
	channelId: "1525905982000070780",
	channelName: "general",
	privacy: "public",
	createdAt: 1_000,
	...overrides,
});

test("parses a well-formed stored record", () => {
	assert.deepEqual(parsePendingLink({ ...record() }), record());
});

test("rejects records without a usable channel id", () => {
	assert.equal(parsePendingLink(null), undefined);
	assert.equal(parsePendingLink({}), undefined);
	assert.equal(parsePendingLink({ channelId: "" }), undefined);
	assert.equal(parsePendingLink({ channelId: 42 }), undefined);
});

test("treats an unrecognised privacy value as unknown", () => {
	assert.equal(parsePendingLink({ ...record(), privacy: "maybe" })?.privacy, "unknown");
	assert.equal(parsePendingLink({ channelId: "1", privacy: "private" })?.privacy, "private");
});

test("drops a non-string channel name but keeps the pick", () => {
	const parsed = parsePendingLink({ ...record(), channelName: 7 });
	assert.equal(parsed?.channelId, "1525905982000070780");
	assert.equal(parsed?.channelName, undefined);
});

test("a pending pick is fresh inside its TTL and stale after it", () => {
	assert.equal(isFreshPendingLink(record(), 1_000 + PENDING_LINK_TTL_MS), true);
	assert.equal(isFreshPendingLink(record(), 1_000 + PENDING_LINK_TTL_MS + 1), false);
	assert.equal(isFreshPendingLink(undefined, 1_000), false);
});
