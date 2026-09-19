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

/** One command's registration payload, as Discord receives it. */
export function payloadOf(command: CommandModule): unknown {
	return typeof command.data?.toJSON === "function" ? command.data.toJSON() : command.data;
}

/** Discord command names discovered in `src/commands`, in discovery order. */
export function commandNames(modules: LoadedModules): string[] {
	return modules.commands.map((command) => {
		const name = command.data?.toJSON?.().name ?? command.data?.name;
		return typeof name === "string" ? name : "(unnamed)";
	});
}

/** Registration payloads — exactly what `registerCommands()` sends to Discord. */
export function commandPayloads(modules: LoadedModules): unknown[] {
	return modules.commands.map(payloadOf);
}

/**
 * Why this module list must not be sent to Discord.
 *
 * Registering commands replaces the whole list in one `PUT`, so a payload
 * Discord rejects leaves the application with **no** command updates at all —
 * silently, because the failure only shows in the build log. Two shapes do that
 * and have both been seen here:
 *
 * - a module with no `{ data, handler }` — the scan accepts any importable file
 *   in `src/commands`, so a helper or a test file lands in the payload as
 *   `undefined` (`resolveCommandPayload` dereferences `data`);
 * - the same command twice. This happens when something outside the runtime
 *   scan imports a command module: the bundler emits a compiled copy beside the
 *   source, and the scan finds both. Discord rejects the duplicate name and the
 *   real commands are left untouched, which looks exactly like "registration did
 *   nothing".
 *
 * Returning these as problems rather than throwing keeps the decision with the
 * caller (`scripts/register*.ts` skip the `PUT` and log).
 */
export function registrationProblems(modules: LoadedModules): string[] {
	const problems: string[] = [];

	if (modules.commands.length === 0) {
		problems.push("no command modules were discovered");
		return problems;
	}

	modules.commands.forEach((command, index) => {
		const payload = payloadOf(command) as { name?: unknown } | undefined;
		if (!payload || typeof payload !== "object" || typeof payload.name !== "string") {
			problems.push(
				`module #${index + 1} in the commands directory has no command payload — a non-command file (a helper or a *.test.ts) is being discovered`,
			);
		}
	});

	const names = commandNames(modules);
	const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
	if (duplicates.length > 0) {
		problems.push(
			`duplicate command name(s): ${duplicates.join(", ")} — the bundler emitted a compiled copy of a command module into the scanned directory`,
		);
	}

	return problems;
}
