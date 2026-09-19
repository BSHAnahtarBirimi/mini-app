/**
 * Shared access to `MiniInteraction`'s handler discovery.
 *
 * `loadModules()` is `private` in the package's types, so every caller (the
 * interaction endpoint, `scripts/register.ts`, `scripts/register-deploy.ts`
 * and `/api/diag`) would otherwise repeat the same cast. It also gives the
 * registration scripts one place to ask "did discovery actually find anything?"
 * — a `PUT` with an empty list would **wipe every registered command**, which
 * is the worst thing a broken deploy could do.
 */

import { MiniInteraction } from "@minesa-org/mini-interaction";

/** Shape of a discovered command module (`{ data, handler }`). */
export type CommandModule = {
	data?: { name?: string; toJSON?: () => Record<string, unknown> };
};

export type LoadedModules = {
	commands: CommandModule[];
	components: unknown[];
	modals: unknown[];
};

/** Resolves the private `loadModules()` on an existing instance (cached there). */
export function loadModulesOf(mini: MiniInteraction): Promise<LoadedModules> {
	return (mini as unknown as { loadModules: () => Promise<LoadedModules> }).loadModules();
}

/** Discord command names discovered in `src/commands`. */
export function commandNames(modules: LoadedModules): string[] {
	return modules.commands.map((command) => {
		const name = command.data?.toJSON?.().name ?? command.data?.name;
		return typeof name === "string" ? name : "(unnamed)";
	});
}

/** Registration payloads — exactly what `registerCommands()` sends to Discord. */
export function commandPayloads(modules: LoadedModules): unknown[] {
	return modules.commands.map((command) =>
		typeof command.data?.toJSON === "function" ? command.data.toJSON() : command.data,
	);
}
