import {
	ContainerBuilder,
	GalleryBuilder,
	GalleryItemBuilder,
	MessageFlags,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
	ThumbnailBuilder,
} from "@minesa-org/mini-interaction";
import type { ModalHandler } from "@minesa-org/mini-interaction";

/** `test_showcase_upload_modal` — previews uploaded attachments in a Components V2 container. */
export const showcaseUploadModal = {
	customId: "test_showcase_upload_modal",

	handler: (async (interaction) => {
		const uploads = interaction.getFileUploadValues("sc_upload");
		const first = interaction.getAttachment("sc_upload");

		const summary = new TextDisplayBuilder().setContent(
			uploads.length
				? [
						"## 📎 Upload showcase",
						`**Uploaded:** ${uploads.length} file(s)`,
						first
							? `**First file:** \`${first.filename}\` (${first.size} bytes)${first.content_type ? ` — \`${first.content_type}\`` : ""}`
							: "",
					]
						.filter(Boolean)
						.join("\n")
				: "## 📎 Upload showcase\nNo files were uploaded.",
		);

		const container = new ContainerBuilder().addComponent(summary);

		if (first?.content_type?.startsWith("image/")) {
			// Section with the image as a thumbnail accessory.
			container.addComponent(
				new SectionBuilder()
					.addComponent(
						new TextDisplayBuilder().setContent(
							`**${first.filename}** rendered as a section thumbnail accessory:`,
						),
					)
					.setAccessory(
						new ThumbnailBuilder()
							.setMedia({ url: first.url })
							.setDescription(first.description ?? `Uploaded image: ${first.filename}`),
					),
			);

			if (uploads.length > 1) {
				// Media gallery with every uploaded image.
				const gallery = new GalleryBuilder();
				for (const id of uploads) {
					const att = interaction.data.resolved?.attachments?.[id];
					if (att?.content_type?.startsWith("image/")) {
						gallery.addItem(
							new GalleryItemBuilder().setMedia({ url: att.url }).setDescription(att.description ?? att.filename),
						);
					}
				}
				if (gallery.toJSON().items.length) {
					container.addComponent(
						new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
					);
					container.addComponent(gallery);
				}
			}
		} else if (first) {
			container.addComponent(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
			);
			container.addComponent(
				new TextDisplayBuilder().setContent(
					`Non-image upload — open it here: ${first.url}`,
				),
			);
		}

		return interaction.reply({
			flags: MessageFlags.IsComponentsV2,
			components: [container.toJSON()],
		});
	}) satisfies ModalHandler,
};
