import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { ChannelType, MiniPermFlags } from "@minesa-org/mini-interaction";

import {
	classifyChannelPrivacy,
	classifyEveryoneOverwrite,
	hasRestrictiveOverwrites,
} from "./channel-privacy.ts";
import type { ChannelOverwrite } from "./channel-privacy.ts";

const GUILD_ID = "123456789012345678";
const VIEW = MiniPermFlags.ViewChannel.toString();
const SEND = MiniPermFlags.SendMessages.toString();
const VIEW_SEND = (MiniPermFlags.ViewChannel | MiniPermFlags.SendMessages).toString();

const overwrite = (partial: Partial<ChannelOverwrite>): ChannelOverwrite => ({
	id: GUILD_ID,
	type: 0,
	...partial,
});

describe("classifyEveryoneOverwrite", () => {
	it("private when @everyone deny blocks VIEW_CHANNEL", () => {
		assert.equal(
			classifyEveryoneOverwrite(overwrite({ deny: VIEW }), GUILD_ID),
			"private",
		);
	});

	it("private when @everyone deny blocks SEND_MESSAGES", () => {
		assert.equal(
			classifyEveryoneOverwrite(overwrite({ deny: SEND }), GUILD_ID),
			"private",
		);
	});

	it("public when @everyone allows both VIEW_CHANNEL and SEND_MESSAGES", () => {
		assert.equal(
			classifyEveryoneOverwrite(overwrite({ allow: VIEW_SEND }), GUILD_ID),
			"public",
		);
	});

	it("unknown when @everyone only allows VIEW_CHANNEL", () => {
		assert.equal(
			classifyEveryoneOverwrite(overwrite({ allow: VIEW }), GUILD_ID),
			"unknown",
		);
	});

	it("unknown for missing or mismatched overwrite", () => {
		assert.equal(classifyEveryoneOverwrite(undefined, GUILD_ID), "unknown");
		assert.equal(
			classifyEveryoneOverwrite(overwrite({ id: "999" }), GUILD_ID),
			"unknown",
		);
		assert.equal(
			classifyEveryoneOverwrite(overwrite({ type: 1 }), GUILD_ID),
			"unknown",
		);
	});
});

describe("hasRestrictiveOverwrites", () => {
	it("detects role denies", () => {
		const overwrites = [overwrite({ id: "999", deny: VIEW })];
		assert.equal(hasRestrictiveOverwrites(overwrites), true);
	});

	it("detects member denies", () => {
		const overwrites = [overwrite({ id: "555", type: 1, deny: SEND })];
		assert.equal(hasRestrictiveOverwrites(overwrites), true);
	});

	it("ignores allow-only overwrites", () => {
		const overwrites = [overwrite({ id: "999", allow: VIEW_SEND })];
		assert.equal(hasRestrictiveOverwrites(overwrites), false);
	});

	it("handles missing arrays", () => {
		assert.equal(hasRestrictiveOverwrites(undefined), false);
		assert.equal(hasRestrictiveOverwrites([]), false);
	});
});

describe("classifyChannelPrivacy", () => {
	it("public with no overwrites (defaults apply)", () => {
		assert.equal(
			classifyChannelPrivacy({ type: ChannelType.GuildText, permission_overwrites: [] }, GUILD_ID),
			"public",
		);
		assert.equal(
			classifyChannelPrivacy({ type: ChannelType.GuildText }, GUILD_ID),
			"public",
		);
	});

	it("private when @everyone is denied read or write", () => {
		assert.equal(
			classifyChannelPrivacy(
				{ type: ChannelType.GuildText, permission_overwrites: [overwrite({ deny: VIEW })] },
				GUILD_ID,
			),
			"private",
		);
		assert.equal(
			classifyChannelPrivacy(
				{ type: ChannelType.GuildText, permission_overwrites: [overwrite({ deny: SEND })] },
				GUILD_ID,
			),
			"private",
		);
	});

	it("private when any role or member overwrite denies read/write", () => {
		assert.equal(
			classifyChannelPrivacy(
				{
					type: ChannelType.GuildText,
					permission_overwrites: [
						overwrite({ id: "999", allow: VIEW_SEND }),
						overwrite({ id: "555", type: 1, deny: VIEW }),
					],
				},
				GUILD_ID,
			),
			"private",
		);
	});

	it("public with an allow-only role overwrite and intact @everyone defaults", () => {
		assert.equal(
			classifyChannelPrivacy(
				{
					type: ChannelType.GuildText,
					permission_overwrites: [overwrite({ id: "999", allow: VIEW_SEND })],
				},
				GUILD_ID,
			),
			"public",
		);
	});

	it("unknown when @everyone grants are incomplete", () => {
		assert.equal(
			classifyChannelPrivacy(
				{ type: ChannelType.GuildText, permission_overwrites: [overwrite({ allow: VIEW })] },
				GUILD_ID,
			),
			"unknown",
		);
	});

	it("unknown for non-text channels", () => {
		assert.equal(
			classifyChannelPrivacy(
				{ type: ChannelType.GuildVoice, permission_overwrites: [overwrite({ deny: VIEW })] },
				GUILD_ID,
			),
			"unknown",
		);
	});

	it("unknown without a channel type", () => {
		assert.equal(classifyChannelPrivacy({}, GUILD_ID), "unknown");
		assert.equal(classifyChannelPrivacy(undefined, GUILD_ID), "unknown");
	});
});
