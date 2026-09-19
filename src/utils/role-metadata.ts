/**
 * Linked-roles metadata published next to the commands.
 *
 * Both registration paths (`scripts/register.ts` for local runs and
 * `scripts/register-deploy.ts` for production deploys) must send the same
 * payload, so it lives here once. `is_miniapp` is always true — everyone who
 * connects through the OAuth flow gets it.
 */

import { RoleConnectionMetadataTypes } from "@minesa-org/mini-interaction";
import type { RoleConnectionMetadataInput } from "@minesa-org/mini-interaction";

export const LINKED_ROLE_METADATA: RoleConnectionMetadataInput[] = [
	{
		key: "is_miniapp",
		name: "Is Mini App?",
		description: "Is the user an assistant?",
		type: RoleConnectionMetadataTypes.BooleanEqual,
	},
];
