/**
 * The documentation site at `/docs`, rendered from `docs-content.ts`.
 *
 * Why this is a module and not a file in `public/`: Vercel serves `index.html`
 * and `public/**` as *static output* and does not put them inside a function
 * bundle, so a page a function reads from disk answers
 * `FUNCTION_INVOCATION_FAILED` — `src/utils/deployment-files.test.ts` fails the
 * build if a function goes back to `readFile`. The same reason the OAuth pages
 * live in `oauth-pages.ts`.
 *
 * Two details are deliberate:
 *
 * 1. **Every interpolated string is escaped** (`escapeHtml`, reused from
 *    `oauth-pages.ts`), and only then is a tiny subset of inline markup applied
 *    (`` `code` ``, `**bold**`). Documentation is mostly code samples — this page
 *    contains `<@123>`, `@everyone` and `1 << 0` — so escaping first, in one
 *    place, is what keeps a sample from being parsed as markup.
 * 2. **It works without JavaScript.** The page is complete as HTML; the script
 *    only adds filtering and highlight-the-current-section. A documentation page
 *    that needs a script to show its text is a bad trade.
 */

import { DOCS_SECTIONS, DOCS_SUBTITLE, DOCS_TITLE, countEntries } from "./docs-content.ts";
import type { DocsEntry, DocsGroup, DocsSection } from "./docs-content.ts";
import { escapeHtml } from "./oauth-pages.ts";

/** Anchor-safe id for a title (`/mesaj` → `mesaj`, `lc:confirm` → `lc-confirm`). */
export function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** The anchor of one entry, namespaced by its group so names cannot collide. */
export function entryAnchor(groupId: string, name: string): string {
	return `${groupId}--${slugify(name)}`;
}

/** Every anchor the page publishes, so the tests can prove they are unique. */
export function docsAnchors(sections: DocsSection[] = DOCS_SECTIONS): string[] {
	return sections.flatMap((section) => [
		section.id,
		...section.groups.flatMap((group) => [
			group.id,
			...group.entries.map((entry) => entryAnchor(group.id, entry.name)),
		]),
	]);
}

/**
 * Escapes text and then applies the inline marks the content uses: `` `code` ``,
 * `**bold**` and `*italic*`.
 *
 * Escaping happens **first**, and the marks are applied innermost-first (code
 * spans before emphasis), so the replacements below only ever wrap text that is
 * already inert and a code sample cannot become markup. `public/**` inside a
 * code span is an example of why the order matters: it must not read as an
 * emphasis pair.
 */
export function renderInline(text: string): string {
	// Split on code spans first, so emphasis is only ever applied to the text
	// *between* them: a `*` inside a code span (`public/**`) must not be able to
	// pair with one outside it.
	return escapeHtml(text)
		.split(/(`[^`]+`)/g)
		.map((part) =>
			part.length > 2 && part.startsWith("`") && part.endsWith("`")
				? `<code>${part.slice(1, -1)}</code>`
				: part
						.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
						.replace(/\*([^*]+)\*/g, "<em>$1</em>"),
		)
		.join("");
}

const paragraph = (text: string) => `<p>${renderInline(text)}</p>`;

function renderEntry(entry: DocsEntry, groupId: string): string {
	const parts = [
		`<article class="entry" id="${escapeHtml(entryAnchor(groupId, entry.name))}"` +
			` data-docs="${escapeHtml(searchTextOf(entry))}">`,
		`<header><h4>${renderInline(entry.name)}</h4><span class="kind">${escapeHtml(entry.kind)}</span></header>`,
		entry.signature ? `<pre class="signature"><code>${escapeHtml(entry.signature)}</code></pre>` : "",
		`<p class="summary">${renderInline(entry.summary)}</p>`,
		...(entry.details ?? []).map((detail) => paragraph(detail)),
		entry.example
			? `<pre class="example"><code>${escapeHtml(entry.example)}</code></pre>`
			: "",
		entry.where ? `<p class="where">${renderInline(entry.where)}</p>` : "",
		"</article>",
	];

	return parts.filter(Boolean).join("\n\t\t\t\t");
}

/**
 * The text a search matches against: name, kind, summary, details, tags and the
 * file it lives in. Lower-cased here so the client only has to lower-case the
 * query.
 */
export function searchTextOf(entry: DocsEntry): string {
	return [
		entry.name,
		entry.kind,
		entry.summary,
		...(entry.details ?? []),
		entry.where ?? "",
		...(entry.tags ?? []),
	]
		.join(" ")
		.toLowerCase()
		.replace(/\s+/g, " ");
}

function renderGroup(group: DocsGroup): string {
	return [
		`<section class="group" data-group="${escapeHtml(group.id)}">`,
		`<h3 id="${escapeHtml(group.id)}">${renderInline(group.title)}</h3>`,
		group.blurb ? `<p class="blurb">${renderInline(group.blurb)}</p>` : "",
		...group.entries.map((entry) => renderEntry(entry, group.id)),
		"</section>",
	]
		.filter(Boolean)
		.join("\n\t\t\t");
}

function renderSection(section: DocsSection): string {
	return [
		`<section class="section" id="${escapeHtml(section.id)}">`,
		`<h2>${renderInline(section.title)}</h2>`,
		`<p class="blurb">${renderInline(section.blurb)}</p>`,
		...section.groups.map(renderGroup),
		"</section>",
	]
		.filter(Boolean)
		.join("\n\t\t");
}

/** The sidebar: one entry per section, with its groups underneath. */
function renderNav(sections: DocsSection[]): string {
	return sections
		.map((section) =>
			[
				`<li class="nav-section">`,
				`<a href="#${escapeHtml(section.id)}">${renderInline(section.title)}</a>`,
				"<ul>",
				...section.groups.map(
					(group) =>
						`<li><a href="#${escapeHtml(group.id)}">${renderInline(group.title)}</a></li>`,
				),
				"</ul>",
				"</li>",
			].join("\n\t\t\t\t"),
		)
		.join("\n\t\t\t");
}

const STYLE = `
			:root {
				--bg: #1e1f22;
				--surface: #2b2d31;
				--surface-2: #313338;
				--border: #3f4147;
				--text: #dbdee1;
				--muted: #949ba4;
				--accent: #5865f2;
				--accent-soft: rgba(88, 101, 242, 0.16);
				--ok: #23a55a;
				--warn: #f0b232;
			}

			* { box-sizing: border-box; }

			body {
				margin: 0;
				min-height: 100vh;
				background:
					radial-gradient(1100px 460px at 20% -200px, rgba(88, 101, 242, 0.20), transparent 70%),
					var(--bg);
				color: var(--text);
				font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
				font-size: 15px;
				line-height: 1.6;
			}

			a { color: #b7c0ff; text-decoration: none; }
			a:hover { text-decoration: underline; }

			code {
				font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
				font-size: 0.88em;
				background: var(--bg);
				border: 1px solid var(--border);
				border-radius: 5px;
				padding: 1px 5px;
			}

			header.top {
				position: sticky;
				top: 0;
				z-index: 3;
				backdrop-filter: blur(10px);
				background: rgba(30, 31, 34, 0.9);
				border-bottom: 1px solid var(--border);
				padding: 14px 20px;
				display: flex;
				flex-wrap: wrap;
				gap: 10px 18px;
				align-items: center;
				justify-content: space-between;
			}

			header.top h1 { margin: 0; font-size: 17px; letter-spacing: -0.01em; }
			header.top p { margin: 2px 0 0; color: var(--muted); font-size: 12.5px; max-width: 62ch; }
			header.top .meta { color: var(--muted); font-size: 12px; }

			#search {
				width: min(320px, 100%);
				padding: 9px 12px;
				border-radius: 9px;
				border: 1px solid var(--border);
				background: var(--surface);
				color: var(--text);
				font: inherit;
				font-size: 13.5px;
			}

			#search:focus { outline: 2px solid var(--accent); outline-offset: 1px; }

			.layout {
				max-width: 1240px;
				margin: 0 auto;
				padding: 22px 20px 72px;
				display: grid;
				grid-template-columns: 268px minmax(0, 1fr);
				gap: 34px;
				align-items: start;
			}

			nav.toc { position: sticky; top: 84px; max-height: calc(100vh - 110px); overflow-y: auto; }
			nav.toc ul { list-style: none; margin: 0; padding: 0; }
			nav.toc > ul > li { margin-bottom: 10px; }
			nav.toc > ul > li > a { font-weight: 600; color: var(--text); font-size: 14px; }
			nav.toc ul ul { margin: 3px 0 0 10px; border-left: 1px solid var(--border); padding-left: 10px; }
			nav.toc ul ul a { color: var(--muted); font-size: 13px; }
			nav.toc a.active { color: #fff; }
			nav.toc a.active::before { content: "▍"; color: var(--accent); margin-right: 5px; }
			nav.toc ul ul a.active { color: var(--text); }

			main { min-width: 0; }

			.section { margin-bottom: 54px; scroll-margin-top: 86px; }
			.section > h2 {
				margin: 0 0 6px;
				font-size: 27px;
				letter-spacing: -0.02em;
				color: #fff;
			}
			.section > .blurb { margin: 0 0 22px; color: var(--muted); max-width: 84ch; }

			.group { margin-bottom: 34px; }
			.group > h3 {
				margin: 0 0 4px;
				font-size: 19px;
				scroll-margin-top: 86px;
				padding-bottom: 8px;
				border-bottom: 1px solid var(--border);
			}
			.group > .blurb { margin: 8px 0 16px; color: var(--muted); max-width: 84ch; font-size: 14px; }

			.entry {
				background: linear-gradient(var(--surface-2), var(--surface));
				border: 1px solid var(--border);
				border-radius: 12px;
				padding: 14px 16px;
				margin-bottom: 12px;
				scroll-margin-top: 86px;
			}

			.entry > header { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
			.entry h4 {
				margin: 0;
				font-size: 15.5px;
				font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
				color: #fff;
				word-break: break-word;
			}
			.entry h4 code { background: none; border: none; padding: 0; }

			.kind {
				font-size: 11px;
				text-transform: uppercase;
				letter-spacing: 0.06em;
				color: #c9cdff;
				background: var(--accent-soft);
				border: 1px solid rgba(88, 101, 242, 0.5);
				border-radius: 999px;
				padding: 1px 8px;
			}

			.entry .summary { margin: 8px 0 0; }
			.entry p { margin: 8px 0 0; color: #cfd2d6; }
			.entry p code, .entry .summary code { color: #e6e7ff; }
		.entry em { color: #fff; font-style: italic; }
		.entry strong { color: #fff; }

			.entry pre {
				margin: 10px 0 0;
				padding: 10px 12px;
				overflow-x: auto;
				background: #17181b;
				border: 1px solid var(--border);
				border-radius: 9px;
			}
			.entry pre code { background: none; border: none; padding: 0; color: #e3e4e8; }
			.entry pre.signature code { color: #a5d6ff; }
			.entry .where { color: var(--muted); font-size: 12.5px; }
			.entry .where code { color: var(--muted); }

			#empty { display: none; padding: 18px 0; color: var(--warn); }

			footer.bottom {
				max-width: 1240px;
				margin: 0 auto;
				padding: 0 20px 60px;
				color: var(--muted);
				font-size: 12.5px;
			}

			@media (max-width: 900px) {
				.layout { grid-template-columns: minmax(0, 1fr); gap: 20px; }
				nav.toc { position: static; max-height: none; }
				nav.toc ul ul { display: none; }
				.section > h2 { font-size: 23px; }
			}
`;

/**
 * The documentation page.
 *
 * The header carries the entry count, so the page says how much it covers and
 * `docs-content.test.ts` can assert the number does not silently go stale.
 */
export function docsPage(sections: DocsSection[] = DOCS_SECTIONS): string {
	const total = countEntries(sections);

	return `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<meta name="description" content="${escapeHtml(DOCS_SUBTITLE)}" />
		<title>${escapeHtml(DOCS_TITLE)}</title>
		<style>${STYLE}</style>
	</head>
	<body>
		<header class="top">
			<div>
				<h1>📖 ${escapeHtml(DOCS_TITLE)}</h1>
				<p>${escapeHtml(DOCS_SUBTITLE)}</p>
			</div>
			<div>
				<label for="search" class="meta">Filter</label>
				<input id="search" type="search" placeholder="Search commands, functions, endpoints…" autocomplete="off" />
				<p class="meta">${total} entries · ${sections.length} sections</p>
			</div>
		</header>

		<div class="layout">
			<nav class="toc" aria-label="Contents">
				<ul>
					${renderNav(sections)}
				</ul>
			</nav>

			<main>
				<p id="empty">No entry matches that filter. Clear the box to see everything.</p>
				${sections.map(renderSection).join("\n\t\t\t\t")}
			</main>
		</div>

		<footer class="bottom">
			Rendered from <code>src/utils/docs-content.ts</code> by
			<code>src/utils/docs-page.ts</code> — the same deployment serves it, so it cannot drift
			from the code without a test failing. <a href="/api/diag">/api/diag</a> reports what this
			particular deployment is configured with.
		</footer>

		<script>
			// Filtering and the current-section highlight. The page is complete
			// without this: nothing here is needed to read the documentation.
			(function () {
				var search = document.getElementById("search");
				var empty = document.getElementById("empty");
				var entries = Array.prototype.slice.call(document.querySelectorAll("[data-docs]"));
				var groups = Array.prototype.slice.call(document.querySelectorAll("[data-group]"));
				var sections = Array.prototype.slice.call(document.querySelectorAll("section.section"));

				function applyFilter() {
					var query = (search.value || "").trim().toLowerCase();
					var terms = query.split(/\\s+/).filter(Boolean);
					var visible = 0;

					entries.forEach(function (entry) {
						var haystack = entry.getAttribute("data-docs") || "";
						var matches = terms.every(function (term) {
							return haystack.indexOf(term) !== -1;
						});
						entry.hidden = !matches;
						if (matches) visible += 1;
					});

					groups.forEach(function (group) {
						group.hidden = !group.querySelector("[data-docs]:not([hidden])");
					});
					sections.forEach(function (section) {
						section.hidden = !section.querySelector("[data-docs]:not([hidden])");
					});

					empty.style.display = visible === 0 ? "block" : "none";
				}

				search.addEventListener("input", applyFilter);

				// Highlight the section being read. Purely decorative.
				var links = Array.prototype.slice.call(document.querySelectorAll("nav.toc a"));
				var byId = {};
				links.forEach(function (link) {
					byId[link.getAttribute("href").slice(1)] = link;
				});
				var visibleSections = sections;
				function highlight() {
					var current = null;
					visibleSections.forEach(function (section) {
						if (section.hidden) return;
						if (section.getBoundingClientRect().top <= 120) current = section.id;
					});
					links.forEach(function (link) {
						link.classList.remove("active");
					});
					if (current && byId[current]) byId[current].classList.add("active");
				}

				if (typeof IntersectionObserver === "function") {
					var observer = new IntersectionObserver(highlight, {
						rootMargin: "-90px 0px -75% 0px",
					});
					sections.forEach(function (section) {
						observer.observe(section);
					});
				}
				window.addEventListener("scroll", function () {
					visibleSections = sections;
					highlight();
				}, { passive: true });
			})();
		</script>
	</body>
</html>
`;
}
