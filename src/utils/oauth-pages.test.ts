import assert from "node:assert/strict";
import test from "node:test";

import { connectPage, connectedPage, escapeHtml, failedPage } from "./oauth-pages.ts";

/**
 * The OAuth pages are returned as strings by the functions.
 *
 * They are not files: Vercel bundles `src/**` into a function but serves
 * `index.html` and `public/**` as static output, so reading them at request time
 * fails and turns every OAuth request into `FUNCTION_INVOCATION_FAILED`.
 * `src/utils/deployment-files.test.ts` guards the bundling rule; these tests
 * guard the markup itself.
 */

test("the connect page redirects to the OAuth URL", () => {
	const html = connectPage("https://discord.com/oauth2/authorize?client_id=1&state=abc");
	assert.match(html, /<title>Mini App — Connect<\/title>/);
	assert.match(html, /window\.location\.replace\("https:\/\/discord\.com\/oauth2\/authorize/);
	assert.match(html, /linked roles/);
});

test("the connect page explains a missing OAuth URL instead of redirecting", () => {
	const html = connectPage(null);
	assert.doesNotMatch(html, /window\.location\.replace\(/);
	assert.match(html, /OAuth URL is not configured/);
});

test("an OAuth URL cannot break out of the script element", () => {
	const html = connectPage("https://discord.com/oauth2/authorize?x=</script><script>alert(1)</script>");
	assert.doesNotMatch(html, /<\/script><script>alert/);
	assert.match(html, /\\u003c\/script>/);
});

test("the success page reports whether the Social SDK scope was granted", () => {
	const linked = connectedPage({ scope: "openid sdk.social_layer identify", hasSocialLayer: true });
	assert.match(linked, /Account connected/);
	assert.match(linked, /can link channels/);
	assert.doesNotMatch(linked, /lim(.*)ited access/);

	const legacy = connectedPage({ scope: "identify guilds", hasSocialLayer: false });
	assert.match(legacy, /still needs the Social SDK scope/);
	assert.match(legacy, /identify guilds/, "the granted scopes must be shown");
	assert.match(legacy, /openid sdk\.social_layer/);
});

test("the failure page shows the reason and escapes it", () => {
	const html = failedPage({
		message: "Discord rejected the code",
		detail: '<img src=x onerror="alert(1)">',
	});
	assert.match(html, /Discord rejected the code/);
	assert.doesNotMatch(html, /<img/);
	assert.match(html, /&lt;img/);
	assert.match(html, /api\/diag/, "it should point at the diagnostics endpoint");
});

test("escapeHtml covers the characters that matter in markup", () => {
	assert.equal(escapeHtml(`<&">`), "&lt;&amp;&quot;&gt;");
});
