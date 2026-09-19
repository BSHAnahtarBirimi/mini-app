import assert from "node:assert/strict";
import test from "node:test";

import { MessageFlags } from "@minesa-org/mini-interaction";

import {
	AUTHORIZE_V2_FLAGS,
	buildAuthorizePayloads,
	statusLine,
} from "./authorize-panel.ts";
import type { AuthorizeStatus } from "./authorize-panel.ts";

/**
 * `/authorize` is the only command whose whole job is to hand over a link, and
 * it is sent as the completion of a deferred response — so the payload has to be
 * constructible (a `SectionBuilder` without an accessory throws and leaves the
 * user on "«bot» is thinking…") and must not set legacy fields alongside the
 * Components V2 flag.
 */

const url = "https://discord.com/oauth2/authorize?client_id=1&scope=openid+sdk.social_layer";

type AnyComponent = {
	type?: number;
	custom_id?: string;
	style?: number;
	url?: string;
	content?: string;
	accessory?: { style?: number };
	components?: AnyComponent[];
};

const jsonOf = (payload: { components: { toJSON(): unknown }[] }) =>
	payload.components.map((component) => component.toJSON() as AnyComponent);

function visit(components: unknown[], onNode: (node: AnyComponent) => void): void {
	for (const value of components) {
		if (Array.isArray(value)) {
			visit(value, onNode);
			continue;
		}
		if (!value || typeof value !== "object") continue;
		const node = value as AnyComponent;
		onNode(node);
		if (Array.isArray(node.components)) visit(node.components, onNode);
	}
}

const statuses: Record<string, AuthorizeStatus> = {
	none: { connected: false, hasSocialLayer: false },
	partial: { connected: true, scope: "identify", hasSocialLayer: false },
	ready: {
		connected: true,
		scope: "sdk.social_layer_presence sdk.social_layer openid",
		hasSocialLayer: true,
	},
	// Discord answered 401: the record has been cleared and the message has to
	// say so, because nothing else in the app can tell the user this happened.
	revoked: { connected: false, hasSocialLayer: false, revoked: true },
	// Discord was asked and did not answer: a connection that cannot be
	// confirmed is reported as unconfirmed rather than as working.
	unverified: {
		connected: true,
		scope: "openid sdk.social_layer",
		hasSocialLayer: true,
		verified: false,
		verifyError: "Discord did not answer within 5s.",
	},
};

test("the payloads can be built for every connection state, link or no link", () => {
	for (const status of Object.values(statuses)) {
		for (const authorizeUrl of [url, null]) {
			const payloads = buildAuthorizePayloads({ authorizeUrl, status });
			assert.equal(payloads.v2.flags, AUTHORIZE_V2_FLAGS);
			assert.equal(jsonOf(payloads.v2)[0]?.type, 17, "the V2 message is a container");
			assert.ok(payloads.legacy.content.length > 0, "the legacy edit needs a content body");
			assert.equal((payloads.legacy as { flags?: number }).flags, undefined);
		}
	}
});

test("the link button is a link button, and the URL is never empty", () => {
	const withLink = buildAuthorizePayloads({ authorizeUrl: url, status: statuses.ready });
	let buttons = 0;
	visit(jsonOf(withLink.v2), (node) => {
		if (node.type === 2) {
			buttons += 1;
			assert.equal(node.style, 5, "only a link button may carry a URL");
			assert.match(node.url ?? "", /^https:\/\/discord\.com\/oauth2\/authorize/);
		}
	});
	assert.equal(buttons, 1);
	assert.match(JSON.stringify(jsonOf(withLink.v2)), /oauth2\/authorize/);
	assert.equal(
		JSON.stringify(jsonOf(withLink.v2)).includes('"url":""'),
		false,
		"Discord rejects a link button with an empty URL",
	);
});

test("with no URL the message explains the missing environment instead of a dead button", () => {
	const payloads = buildAuthorizePayloads({
		authorizeUrl: null,
		missingEnv: ["DISCORD_CLIENT_SECRET"],
		status: statuses.none,
	});
	let buttons = 0;
	visit(jsonOf(payloads.v2), (node) => {
		if (node.type === 2) buttons += 1;
	});
	assert.equal(buttons, 0, "no button without a URL");
	assert.match(payloads.legacy.content, /DISCORD_CLIENT_SECRET/);
	assert.match(payloads.legacy.content, /No link to show/);
	assert.equal(payloads.legacy.components.length, 0);
});

test("no section is ever built without an accessory", () => {
	for (const status of Object.values(statuses)) {
		for (const authorizeUrl of [url, null]) {
			visit(jsonOf(buildAuthorizePayloads({ authorizeUrl, status }).v2), (node) => {
				if (node.type === 9) {
					assert.ok(node.accessory, "the library throws on a section without an accessory");
				}
			});
		}
	}
});

test("the status line says what is actually wrong with the connection", () => {
	assert.match(statusLine(statuses.none!), /no connection stored/i);
	assert.match(statusLine(statuses.partial!), /sdk\.social_layer` is missing/);
	assert.match(statusLine(statuses.partial!), /Re-authorize/);
	assert.match(statusLine(statuses.ready!), /connected as/);
	assert.match(statusLine(statuses.ready!), /confirmed by Discord/);
	assert.match(statusLine(statuses.ready!), /Authorized Apps/, "it explains how a token dies silently");
	assert.match(statusLine(statuses.revoked!), /revoked/);
	assert.match(statusLine(statuses.revoked!), /record has been cleared/);
	assert.doesNotMatch(statusLine(statuses.revoked!), /connected as/, "a revoked record is not a connection");
	assert.match(statusLine(statuses.unverified!), /could not be confirmed/);
	assert.match(statusLine(statuses.unverified!), /within 5s/);
	assert.equal(MessageFlags.Ephemeral & AUTHORIZE_V2_FLAGS, 0, "the V2 payload must not carry Ephemeral");
});
