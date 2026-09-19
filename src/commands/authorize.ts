import { CommandBuilder } from "@minesa-org/mini-interaction";

import { AUTHORIZE_COMMAND_NAME } from "../utils/authorize-panel.ts";
import { createAuthorizeHandler } from "../utils/authorize-command.ts";

/**
 * `/authorize` — grants (or restores) this app's connection to your account.
 *
 * Deliberately a wrapper and nothing more: the behaviour lives in
 * `src/utils/authorize-command.ts`, because a module in this directory is
 * **imported by the framework at runtime** and importing it from anywhere else
 * (as `/api/diag` does, to prove the recovery path works in a deployment) makes
 * the bundler emit a compiled copy beside it — after which the directory scan
 * finds the command twice and the registration payload contains a duplicate
 * name, which Discord rejects as a whole.
 */
export const authorizeCommand = {
	data: new CommandBuilder()
		.setName(AUTHORIZE_COMMAND_NAME)
		.setDescription("Authorize (or re-authorize) this app with your Discord account"),

	handler: createAuthorizeHandler(),
};
