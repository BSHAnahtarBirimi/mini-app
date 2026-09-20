import assert from "node:assert/strict";
import test from "node:test";

import { handleDocs } from "../../api/docs.ts";
import { DOCS_SECTIONS, DOCS_TITLE, countEntries } from "./docs-content.ts";
import { docsAnchors, docsPage, renderInline, searchTextOf, slugify } from "./docs-page.ts";

/**
 * The documentation page itself.
 *
 * Two things are worth a test here rather than trusting the renderer:
 *
 * 1. **Escaping.** The content is mostly code samples — `<@123>`, `@everyone`,
 *    `1 << 0` — and a documentation page that renders a sample as markup is both
 *    wrong and, in the worst case, an injection point.
 * 2. **Completeness.** Every section, group and entry must publish a unique
 *    anchor, because the sidebar is made of them: a duplicate id silently sends a
 *    reader to the wrong place.
 */

type FakeResponse = {
	statusCode: number;
	headers: Record<string, string>;
	body: string;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
};

function fakeResponse(): FakeResponse {
	return {
		statusCode: 0,
		headers: {},
		body: "",
		setHeader(name, value) {
			this.headers[name.toLowerCase()] = value;
		},
		end(body) {
			this.body = body ?? "";
		},
	};
}

test("every section, group and entry gets its own anchor", () => {
	const page = docsPage();
	const anchors = docsAnchors();

	assert.ok(anchors.length > 0, "the page publishes anchors at all");
	assert.equal(new Set(anchors).size, anchors.length, `duplicate anchor ids: ${anchors.join(", ")}`);

	const missing = anchors.filter((anchor) => !page.includes(`id="${anchor}"`));
	assert.deepEqual(missing, [], `these anchors are linked from the sidebar but do not exist:\n${missing.join("\n")}`);
});

test("the header reports how much is documented", () => {
	const page = docsPage();
	assert.match(page, new RegExp(`${countEntries()} entries`));
	assert.match(page, new RegExp(`${DOCS_SECTIONS.length} sections`));
	assert.match(page, new RegExp(DOCS_TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("code samples are escaped, not parsed as markup", () => {
	const page = docsPage();

	// The content deliberately contains all three of these shapes.
	assert.ok(page.includes("&lt;@"), "a <@mention> sample must be escaped");
	assert.ok(page.includes("1 &lt;&lt; 0"), "the 1 << 0 flag sample must be escaped");
	assert.ok(!page.includes("<@"), "no raw mention token may survive into the HTML");
	assert.ok(!page.includes("<userId>"), "the generic <userId> key must be escaped");

	// Exactly one script element: the page's own enhancer, never content.
	assert.equal((page.match(/<script/g) ?? []).length, 1, "content must not be able to add a script element");
});

test("inline markup only ever wraps already-escaped text", () => {
	assert.equal(
		renderInline("use `<@123>` and **bold** text"),
		"use <code>&lt;@123&gt;</code> and <strong>bold</strong> text",
	);
	assert.equal(renderInline("it is *this* server"), "it is <em>this</em> server");
	// A glob inside a code span must not read as an emphasis pair.
	assert.equal(renderInline("`public/**` and *here*"), "<code>public/**</code> and <em>here</em>");
	assert.equal(renderInline("a < b & c"), "a &lt; b &amp; c");
	assert.equal(renderInline('say "hi"'), "say &quot;hi&quot;");
});

test("no stray markdown marks are left in the rendered page", () => {
	// Only prose is inspected: code legitimately contains `*` and backticks
	// (`public/**`, `lc:${guildId}`), and the search index — a `data-docs`
	// attribute — deliberately keeps the raw text so it can be matched against.
	const prose = docsPage()
		.replace(/data-docs="[^"]*"/g, "")
		.replace(/<style>[\s\S]*?<\/style>/g, "")
		.replace(/<script>[\s\S]*?<\/script>/g, "")
		.replace(/<pre[\s\S]*?<\/pre>/g, "")
		.replace(/<code>[\s\S]*?<\/code>/g, "");

	const survivors = prose
		.split("\n")
		.filter((line) => line.includes("**") || line.includes("`"));

	assert.deepEqual(
		survivors,
		[],
		`unmatched inline markdown reaches the reader as literal characters:\n${survivors.join("\n")}`,
	);
});

test("the search index covers the name, the summary and the tags", () => {
	const entry = DOCS_SECTIONS.flatMap((section) => section.groups.flatMap((group) => group.entries)).find(
		(candidate) => (candidate.tags ?? []).length > 0,
	);
	assert.ok(entry, "at least one entry carries tags");

	const haystack = searchTextOf(entry);
	assert.ok(haystack.includes(entry.name.toLowerCase()), "the name is searchable");
	for (const tag of entry.tags ?? []) {
		assert.ok(haystack.includes(tag.toLowerCase()), `the tag ${tag} is searchable`);
	}
	assert.equal(haystack, haystack.toLowerCase(), "the index is lower-cased once, here");
});

test("slugs are anchor-safe", () => {
	assert.equal(slugify("/linked-channel"), "linked-channel");
	assert.equal(slugify("lc:confirm"), "lc-confirm");
	assert.equal(slugify("1 << 0"), "1-0");
	assert.equal(slugify("—"), "");
});

test("GET /api/docs serves the page", () => {
	const res = fakeResponse();
	handleDocs({ method: "GET" }, res);

	assert.equal(res.statusCode, 200);
	assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
	assert.equal(res.body, docsPage());
	assert.ok(res.body.startsWith("<!DOCTYPE html>"));
});

test("any other method is refused with Allow, not with a page", () => {
	const res = fakeResponse();
	handleDocs({ method: "POST" }, res);

	assert.equal(res.statusCode, 405);
	assert.equal(res.headers.allow, "GET, HEAD");
	assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
	assert.deepEqual(JSON.parse(res.body), {
		ok: false,
		error: "Use GET — this endpoint serves the documentation page.",
	});
});
