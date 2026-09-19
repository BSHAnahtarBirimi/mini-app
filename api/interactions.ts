import { MiniInteraction } from "@minesa-org/mini-interaction";

import { recordInteractionError } from "../src/utils/interaction-errors.js";

export const mini = new MiniInteraction({
	commandsDirectory: "src/commands",
	componentsDirectory: "src/components",
	debug: true,
	// Guard against accidental whitespace/newlines in the env var, which make
	// ed25519 verification fail with "invalid interaction signature".
	publicKey: process.env.DISCORD_PUBLIC_KEY?.trim(),
});

type LoadedModules = { commands: unknown[]; components: unknown[]; modals: unknown[] };
const loader = mini as unknown as { loadModules?: () => Promise<LoadedModules> };

/**
 * Warm the module cache at instance boot so the first button press does not
 * pay the dynamic-import cost, and surface any loading failure in the logs
 * instead of swallowing it during dispatch.
 */
if (typeof loader.loadModules === "function") {
	loader
		.loadModules()
		.then((m) =>
			console.log(
				`[warmup] modules loaded: commands=${m.commands.length} components=${m.components.length} modals=${m.modals.length}`,
			),
		)
		.catch((err) => console.error("[warmup] module loading FAILED:", err));
}

type DispatchFn = (
	interaction: { type?: unknown },
	commitInitialResponse: (response: unknown) => boolean,
) => Promise<unknown>;
const dispatchable = mini as unknown as { dispatch?: DispatchFn };

/**
 * Everything a command, component or modal handler does goes through this one
 * method, and the framework answers deferred interactions from the background:
 * a handler that acknowledges first and then fails has its error swallowed into
 * `console.error` (readable only in the Vercel dashboard). That is exactly the
 * "«bot» is thinking…" state with nothing to inspect, so record the failure in
 * the database instead — `GET /api/diag` reports it — and rethrow so the
 * framework's own handling is unchanged.
 *
 * `dispatch` is private in the package's types but is present at runtime; if a
 * future version renames it this degrades to "no recording", never to a broken
 * dispatch.
 */
if (typeof dispatchable.dispatch === "function") {
	const originalDispatch = dispatchable.dispatch.bind(mini) as DispatchFn;
	dispatchable.dispatch = async (interaction, commitInitialResponse) => {
		try {
			return await originalDispatch(interaction, commitInitialResponse);
		} catch (error) {
			await recordInteractionError(error, `dispatch:type${String(interaction?.type ?? "?")}`);
			throw error;
		}
	};
}

export default mini.createNodeHandler();
