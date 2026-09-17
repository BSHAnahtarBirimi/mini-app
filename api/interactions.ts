import { MiniInteraction } from "@minesa-org/mini-interaction";

export const mini = new MiniInteraction({
	commandsDirectory: "src/commands",
	componentsDirectory: "src/components",
	debug: true,
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

export default mini.createNodeHandler();
