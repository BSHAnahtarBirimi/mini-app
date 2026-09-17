import { CommandBuilder, MessageFlags } from "@minesa-org/mini-interaction";
import type { APIContainerComponent } from "discord-api-types/v10";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";
import { buildShowcaseContainer } from "../components/test_showcase_container.js";

/** `/test` — Components V2 showcase with modal buttons and response-mode select menus. */
export const testCommand = {
	data: new CommandBuilder().setName("test").setDescription("Showcases every mini-interaction feature"),

	handler: (async (interaction) => {
		const container = buildShowcaseContainer();

		return interaction.reply({
			flags: MessageFlags.IsComponentsV2,
			components: [
				// Select menus (types 3/5/6/8) are valid in containers at runtime; the
				// library's TopLevelComponent type is narrower than the API allows.
				container.toJSON() as unknown as APIContainerComponent,
				{
					type: 1,
					components: [
						{ type: 2, style: 1, custom_id: "test_showcase_inputs", label: "✏️ Inputs" },
						{ type: 2, style: 1, custom_id: "test_showcase_radio_check", label: "📻 Radio & Checkbox" },
						{ type: 2, style: 1, custom_id: "test_showcase_resolved", label: "🎯 Select Menus" },
					],
				},
				{
					type: 1,
					components: [{ type: 2, style: 1, custom_id: "test_showcase_upload", label: "📎 Upload" }],
				},
			],
		});
	}) satisfies SlashCommandHandler,
};
