import { mini } from "./interactions.js";

/**
 * Linked-roles landing page. Renders `index.html` and redirects the visitor
 * to Discord's OAuth consent screen.
 */
export default mini.discordOAuthVerificationPage({ htmlFile: "index.html" });
