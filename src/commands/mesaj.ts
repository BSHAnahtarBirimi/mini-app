import { CommandBuilder } from "@minesa-org/mini-interaction";

import { MESAJ_OPTION, createMesajHandler } from "../utils/mesaj-command.ts";

/**
 * `/mesaj` — type a message, and it goes out to **every** linked channel this app
 * maintains, across all servers, the same way the web app sends one.
 *
 * The behaviour lives in `src/utils/mesaj-command.ts`; this file is only the
 * command's declaration. That split is deliberate: the framework discovers
 * commands by importing everything in `src/commands`, so a command file that is
 * also imported by an API endpoint (or by a diagnostic) makes the bundler emit a
 * second copy, and the earlier `/authorize` was registered **twice** because of
 * it — one duplicate name is enough for Discord to reject the whole `PUT`, which
 * leaves the command list unchanged and the reason only in the build log.
 */
export const mesajCommand = {
	data: new CommandBuilder()
		.setName("mesaj")
		.setDescription("Send one message to every linked channel")
		.addStringOption((option) =>
			option
				.setName(MESAJ_OPTION)
				.setDescription("The message every linked channel receives")
				.setRequired(true),
		),

	handler: createMesajHandler(),
};
