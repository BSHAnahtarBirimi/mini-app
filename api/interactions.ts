import { MiniInteraction } from "@minesa-org/mini-interaction";

export const mini = new MiniInteraction({
	commandsDirectory: "src/commands",
	componentsDirectory: "src/components",
	debug: true,
});

export default mini.createNodeHandler();
