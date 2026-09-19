import assert from "node:assert/strict";
import test from "node:test";

import { MessageFlags } from "@minesa-org/mini-interaction";

import {
	PANEL_V2_FLAGS,
	buildChannelMenuPayloads,
	buildPanelPayloads,
} from "./linked-channel-panel.ts";
import type { ClassifiedChannel } from "./lobby-channels.ts";

/**
 * The payloads the Linked Channels flow *edits* into a deferred response.
 *
 * Building one of these is not a safe operation: the library's `SectionBuilder`
 * throws when a section has no accessory, and a throw here happens after the
 * deferral — the admin is left on "«bot» is thinking…" with nothing in the logs
 * but a console.error. That is exactly how `/linked-channel` broke, so every
 * payload is constructed and inspected here.
 */

const data = { lobbyId: "1550935772356681729", reconnectUrl: null };
const withReconnect = { ...data, reconnectUrl: "https://discord.com/oauth2/authorize?x=1" };

const channels: ClassifiedChannel[] = [
	{ id: "1525905982000070780", name: "genel", privacy: "public" },
	{ id: "1525905982000070781", name: "staff", privacy: "private" },
];

type AnyComponent = {
	type?: number;
	content?: string;
	custom_id?: string;
	style?: number;
	accessory?: { type?: number; style?: number; url?: string };
	components?: AnyComponent[];
};

/** Serialises a payload the way the request builder will send it. */
function jsonOf(payload: { components: { toJSON(): unknown }[] }): AnyComponent[] {
	return payload.components.map((component) => component.toJSON() as AnyComponent);
}

/** Every custom id anywhere in a component tree. */
function customIds(components: unknown[]): string[] {
	const found: string[] = [];
	const visit = (value: unknown) => {
		if (Array.isArray(value)) {
			value.forEach(visit);
			return;
		}
		if (!value || typeof value !== "object") return;
		const node = value as AnyComponent;
		if (typeof node.custom_id === "string") found.push(node.custom_id);
		if (Array.isArray(node.components)) node.components.forEach(visit);
	};
	visit(components);
	return found;
}

function sections(components: AnyComponent[]): AnyComponent[] {
	return components.flatMap((component) =>
		component.type === 9 ? [component] : sections(component.components ?? []),
	);
}

test("the panel payloads can be built at all, with and without the reconnect button", () => {
	// The regression this guards: building a payload used to throw, and the
	// throw landed after the deferral.
	for (const input of [data, withReconnect]) {
		const payloads = buildPanelPayloads(input);
		assert.equal(payloads.v2.flags, MessageFlags.IsComponentsV2);
		assert.equal(jsonOf(payloads.v2)[0]?.type, 17, "the V2 panel is a container (type 17)");
		assert.ok(payloads.legacy.content.length > 0, "the legacy edit needs a content body");
	}
});

test("the V2 panel exposes link, unlink, test and join", () => {
	const ids = customIds(jsonOf(buildPanelPayloads(data).v2)).filter((id) => id.startsWith("lc:"));
	assert.deepEqual(ids, ["lc:link", "lc:unlink", "lc:test", "lc:join"]);
});

test("every section carries an accessory — the library throws otherwise", () => {
	for (const input of [data, withReconnect]) {
		for (const section of sections(jsonOf(buildPanelPayloads(input).v2))) {
			assert.ok(section.accessory, "a section without an accessory cannot be serialised");
		}
	}
	for (const section of sections(jsonOf(buildChannelMenuPayloads({ lobbyId: "1", channels }).v2))) {
		assert.ok(section.accessory, "a section without an accessory cannot be serialised");
	}
});

test("the reconnect button is a link button inside the panel section", () => {
	const found = sections(jsonOf(buildPanelPayloads(withReconnect).v2));
	assert.equal(found.length, 1);
	assert.equal(found[0]?.accessory?.style, 5, "reconnect must be a link button (style 5)");
	assert.match(found[0]?.accessory?.url ?? "", /oauth2\/authorize/);
	assert.match(JSON.stringify(found[0]), /Reconnect/);
});

test("the legacy panel is a legal edit: no V2 flag, a content body, same actions", () => {
	const legacy = buildPanelPayloads(withReconnect).legacy;
	assert.equal((legacy as { flags?: number }).flags, undefined, "legacy payloads must not set flags");
	assert.match(legacy.content, /Linked Channels/);
	assert.match(legacy.content, /oauth2\/authorize/, "the reconnect URL must still be reachable");
	assert.deepEqual(
		customIds(legacy.components).filter((id) => id.startsWith("lc:")),
		["lc:link", "lc:unlink", "lc:test", "lc:join"],
	);
});

test("the channel menu offers every channel with its privacy badge and stays cancellable", () => {
	const payloads = buildChannelMenuPayloads({ lobbyId: data.lobbyId, channels });

	const selects = JSON.stringify(jsonOf(payloads.v2));
	assert.match(selects, /"custom_id":"lc:pick"/);
	assert.match(selects, /✅ genel/);
	assert.match(selects, /🔒 staff/);
	assert.deepEqual(customIds(jsonOf(payloads.v2)), ["lc:pick", "lc:cancel"]);
	assert.deepEqual(customIds(payloads.legacy.components), ["lc:pick", "lc:cancel"]);
	assert.equal((payloads.legacy as { flags?: number }).flags, undefined);
});
