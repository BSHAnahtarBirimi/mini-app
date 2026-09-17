import { CommandBuilder } from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

/**
 * `/rawradio` — bypasses every mini-interaction builder and returns the raw
 * modal payload from Discord's docs verbatim. If this opens while the
 * builder-based `/radio` fails, the framework serialization is at fault;
 * if both fail, the payload structure (or client/install support) is.
 */
export const rawRadioCommand = {
	data: new CommandBuilder().setName("rawradio").setDescription("Raw docs JSON: single RadioGroup modal"),

	handler: (async () => {
		// Raw interaction response, sent to Discord exactly as written.
		return {
			type: 9,
			data: {
				custom_id: "raw_radio_modal",
				title: "Raw Radio Test",
				components: [
					{
						type: 18,
						label: "Pick one",
						component: {
							type: 21,
							custom_id: "raw_radio_choice",
							required: true,
							options: [
								{ label: "Option A", value: "a" },
								{ label: "Option B", value: "b" },
							],
						},
					},
				],
			},
		};
	}) satisfies SlashCommandHandler,
};
