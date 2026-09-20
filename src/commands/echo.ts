import { CommandBuilder } from "@minesa-org/mini-interaction";

import { ECHO_OPTION, createEchoHandler } from "../utils/echo-command.ts";

/**
 * `/echo text:…` — your text, posted into the **lobby chat** of every linked
 * channel.
 *
 * Through the lobby and not the bot: `POST /lobbies/{id}/messages` with your own
 * OAuth2 token is the call a Social SDK client makes when a player sends a
 * message, so the text lands in the in-game chat and is mirrored into that
 * lobby's linked channel. `/mesaj` is the broadcast that always arrives (lobby
 * first, bot as the fallback); this one is the game's own path, and says so when
 * a lobby refuses it.
 *
 * Deliberately a wrapper and nothing more: the behaviour lives in
 * `src/utils/echo-command.ts`, because a module in this directory is **imported
 * by the framework at runtime**, and importing it from anywhere else (a
 * diagnostic, a test helper) makes the bundler emit a compiled copy beside it —
 * after which the directory scan finds the command twice and Discord rejects the
 * whole registration `PUT`.
 */
export const echoCommand = {
	data: new CommandBuilder()
		.setName("echo")
		.setDescription("Post your text into the lobby chat of every linked channel")
		.addStringOption((option) =>
			option
				.setName(ECHO_OPTION)
				.setDescription("The text every linked lobby receives")
				.setRequired(true),
		),

	handler: createEchoHandler(),
};
