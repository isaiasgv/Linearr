#!/usr/bin/env node
/**
 * showcase-build.mjs
 *
 * Regenerates the resolved `:root` / `.dark` token block inside
 * showcase.html's inline <style> from the project's shadcn-style
 * `:root { ... }` + `.dark { ... }` custom-property blocks in a sibling
 * `app.css`, and emits a sibling `tokens.json` — a flat, deterministic
 * `[{ name, light, dark }]` array in `app.css`'s `:root` source order.
 *
 * Node built-ins only (fs / path / url). No npm dependencies, no Tailwind
 * CLI invocation. Every value copied into showcase.html is whatever literal
 * `app.css` already declares (hex / oklch / rgb / calc() / font stack) —
 * never re-resolved or re-written — so the page renders correctly offline /
 * over file://, with zero build step required to preview it.
 *
 * Usage:
 *   node design-system/showcase-build.mjs
 *
 * Contract (relied on by the design-system-auditor and the CI drift guard):
 *   - `showcase.html` and the emitted `tokens.json` live side by side in the
 *     same design-system/ directory. The *source* `app.css`, however, is
 *     scaffolded to a different directory per stack by /setup-design-system
 *     (React/Vite: `frontend/src/app.css` next to `frontend/design-system/`;
 *     Blazor: `wwwroot/css/app.css` next to `wwwroot/design-system/`; plain
 *     HTML: `app.css` next to `design-system/`) — so it is *resolved*, not
 *     assumed to be a sibling of showcase.html. Resolution order: the
 *     `DESIGN_SYSTEM_SOURCE_CSS` env var (an absolute path override) →
 *     `./app.css` → `../src/app.css` → `../css/app.css` → `../app.css`,
 *     each tried relative to the directory passed to `buildTokens`. The
 *     first candidate that exists on disk wins; if none exist, buildTokens
 *     throws, naming every path it tried.
 *   - Color tokens come from `app.css`'s `:root { ... }` / `.dark { ... }`
 *     blocks. Scale/font/radius/motion tokens (--font-sans, --text-*,
 *     --radius*, --ease-quiet, --duration*) instead live inside app.css's
 *     `@theme inline { ... }` block, alongside the `--color-*: var(--*)`
 *     Tailwind mapping lines — buildTokens pulls every `@theme inline`
 *     declaration that does NOT start with `--color-` and folds it into the
 *     regenerated `:root` block (the showcase references these via `var()`
 *     with no other definition site). These scale tokens are never written
 *     to `tokens.json` — that file stays color-only (`{ name, light, dark }`).
 *   - Only the CSS between `/* TOKENS:START *\/` and `/* TOKENS:END *\/`
 *     inside showcase.html's <style> block is touched. Those markers are
 *     CSS comments (not HTML comments) because they live inside <style> —
 *     an HTML comment there would break the CSS parse. The
 *     `<!-- KIT:START -->` / `<!-- KIT:END -->`,
 *     `<!-- BRAND:START -->` / `<!-- BRAND:END -->`, and
 *     `<!-- MOCKUPS:START -->` / `<!-- MOCKUPS:END -->` blocks are
 *     hand-authored HTML and are NEVER modified by this script.
 *   - Output is deterministic: tokens are emitted in `:root` source order,
 *     one property per line, 2-space indent, no timestamps — so re-running
 *     against an unchanged app.css produces byte-identical output for both
 *     showcase.html and tokens.json.
 *   - A token declared in `:root` but not redeclared in `.dark` falls back
 *     to its light value for the dark variant (both in the emitted `.dark`
 *     block and in tokens.json) — not every token needs a dark override.
 *   - The regenerated TOKENS block and tokens.json ARE meant to be
 *     committed (see README.md).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const START_MARKER = '/* TOKENS:START */';
const END_MARKER = '/* TOKENS:END */';

// ---------------------------------------------------------------------------
// 1. Brace-matched block extraction (`:root { ... }`, `.dark { ... }`)
// ---------------------------------------------------------------------------

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Anchored to the start of a line (the `m` flag makes `^` match there) so a
// selector like `:root[data-sidebar-theme="light"] { ... }` never matches —
// `\s*` can't cross the `[data-...]` attribute selector to reach `{`.
const ROOT_BLOCK_RE = /^\s*:root\s*\{/m;
const DARK_BLOCK_RE = /^\s*\.dark\s*\{/m;
// Tailwind v4's `@theme inline { ... }` block — houses both the
// `--color-*: var(--*)` mapping lines (skipped — see filterScaleTokens
// below) AND the scale/font/radius/motion tokens that never appear in
// `:root` (see buildTokens' contract note at the top of this file).
const THEME_INLINE_BLOCK_RE = /^\s*@theme\s+inline\s*\{/m;

function extractBlock(css, selectorRegex) {
  const m = selectorRegex.exec(css);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    i++;
  }
  return css.slice(start, i - 1);
}

// ---------------------------------------------------------------------------
// 2. Parse `--custom-property: value;` declarations, in source order
// ---------------------------------------------------------------------------

function parseTokens(block) {
  const tokens = new Map();
  if (!block) return tokens;
  // CSS allows omitting the semicolon on a block's last declaration (e.g.
  // `.dark{--background:#020617}`) — normalize so the regex below (which
  // terminates each declaration on `;`) still captures it.
  const normalized = block.trimEnd().replace(/;?$/, ';');
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(normalized))) {
    tokens.set(m[1], m[2].trim());
  }
  return tokens;
}

// The `@theme inline` block mixes two kinds of declarations: `--color-*`
// lines that just re-point a Tailwind utility at a `:root`/`.dark` color
// token (already captured by parseTokens(rootBlock) / parseTokens(darkBlock)
// above — skip these here to avoid duplicating them), and everything else
// (--font-*, --text-*, --radius*, --ease-*, --duration*) which has no other
// definition site and must be preserved in the regenerated :root block.
function filterScaleTokens(themeInlineTokens) {
  const scale = new Map();
  for (const [name, value] of themeInlineTokens) {
    if (!name.startsWith('--color-')) scale.set(name, value);
  }
  return scale;
}

// ---------------------------------------------------------------------------
// 3. Emit the resolved :root / .dark block + the tokens.json list
// ---------------------------------------------------------------------------

function renderTokenLines(names, tokens) {
  return names.map((name) => `  ${name}: ${tokens.get(name)};`).join('\n');
}

const TOKENS_HEADER = [
  '/*',
  "  Auto-generated by showcase-build.mjs from the project's `:root` / `.dark`",
  '  tokens in app.css — DO NOT hand-edit. Run `npm run showcase:build` to',
  '  regenerate.',
  '',
  '  NOTE: the two TOKENS marker lines around this block are CSS comments',
  '  (not HTML comments) because they live inside <style>.',
  '*/',
].join('\n');

// `scaleNames`/`scaleTokens` (the non-`--color-*` declarations pulled from
// `@theme inline` — see filterScaleTokens) are appended after the color
// tokens in `:root`. They have no `.dark` counterpart: Tailwind v4 scales
// aren't re-themed per mode, and since `:root` custom properties are
// visible everywhere (including under `.dark`), there's no need to redeclare
// them there.
function buildTokensBlock(lightNames, lightTokens, darkTokens, scaleNames = [], scaleTokens = new Map()) {
  const rootNames = [...lightNames, ...scaleNames];
  const rootTokens = new Map([...lightTokens, ...scaleTokens]);
  const lightCss = renderTokenLines(rootNames, rootTokens);
  const darkNames = lightNames.filter((name) => darkTokens.has(name));
  const darkCss = renderTokenLines(darkNames, darkTokens);
  return `${TOKENS_HEADER}\n:root {\n${lightCss}\n}\n\n.dark {\n${darkCss}\n}`;
}

function replaceBetweenMarkers(html, newInner) {
  const startIdx = html.indexOf(START_MARKER);
  const endIdx = html.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `showcase-build: markers "${START_MARKER}" / "${END_MARKER}" not found (or out of order) in showcase.html`,
    );
  }
  const before = html.slice(0, startIdx + START_MARKER.length);
  const after = html.slice(endIdx);
  return `${before}\n${newInner}\n${after}`;
}

// ---------------------------------------------------------------------------
// 4. Source app.css resolution
// ---------------------------------------------------------------------------

// Tried in order, relative to the showcase directory, after the env
// override. Covers every shape /setup-design-system scaffolds (see the
// contract note at the top of this file) plus the plain-sibling test/
// fixture shape (`./app.css`).
// NOTE: Linearr's Tailwind entry is `src/index.css` (not `app.css`), so
// `../src/index.css` is included below (added by /setup-design-system).
const SOURCE_CSS_CANDIDATES = ['./app.css', '../src/app.css', '../src/index.css', '../css/app.css', '../app.css'];

/**
 * Locates the project's `app.css` relative to the showcase directory.
 * `/setup-design-system` scaffolds the token file to a different sibling
 * per stack (see contract note above), so the showcase dir alone doesn't
 * pin it down — this tries each known shape and returns the first hit.
 *
 * @param {string} dir - the design-system/ (showcase) directory
 * @returns {string} absolute path to the resolved app.css
 */
function resolveSourceCss(dir) {
  const tried = [];

  const envOverride = process.env.DESIGN_SYSTEM_SOURCE_CSS;
  if (envOverride) {
    const resolved = path.resolve(envOverride);
    tried.push(resolved);
    if (existsSync(resolved)) return resolved;
  }

  for (const candidate of SOURCE_CSS_CANDIDATES) {
    const resolved = path.resolve(dir, candidate);
    tried.push(resolved);
    if (existsSync(resolved)) return resolved;
  }

  throw new Error(
    [
      `showcase-build: could not find a source app.css for ${dir}. Tried:`,
      ...tried.map((p) => `  - ${p}`),
      'Set DESIGN_SYSTEM_SOURCE_CSS to an absolute path to override.',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// 5. buildTokens(dir) — the exported contract
// ---------------------------------------------------------------------------

/**
 * Resolves the project's `app.css` (see resolveSourceCss), rewrites the
 * TOKENS marker block in `<dir>/showcase.html` with resolved `:root` /
 * `.dark` literals (colors from app.css's `:root`/`.dark`, plus
 * scale/font/radius/motion tokens from its `@theme inline` block), and
 * writes `<dir>/tokens.json` (`[{ name, light, dark }]`, color tokens only,
 * in `:root` source order).
 *
 * @param {string} dir - directory containing showcase.html (app.css is resolved, not assumed sibling)
 * @returns {{ light: number, dark: number }} color token counts, for CLI logging
 */
export function buildTokens(dir) {
  const appCssPath = resolveSourceCss(dir);
  const showcasePath = path.join(dir, 'showcase.html');
  const tokensJsonPath = path.join(dir, 'tokens.json');

  const css = stripComments(readFileSync(appCssPath, 'utf8'));

  const rootBlock = extractBlock(css, ROOT_BLOCK_RE);
  if (rootBlock === null) {
    throw new Error(`showcase-build: no :root { ... } block found in ${appCssPath}`);
  }
  const darkBlock = extractBlock(css, DARK_BLOCK_RE);
  const themeInlineBlock = extractBlock(css, THEME_INLINE_BLOCK_RE);

  const lightTokens = parseTokens(rootBlock);
  const darkTokens = parseTokens(darkBlock);
  const lightNames = [...lightTokens.keys()];

  const scaleTokens = filterScaleTokens(parseTokens(themeInlineBlock));
  const scaleNames = [...scaleTokens.keys()];

  if (lightNames.length === 0) {
    console.warn('showcase-build: WARNING — :root { ... } block found but no --tokens parsed inside it.');
  }

  const tokensBlock = buildTokensBlock(lightNames, lightTokens, darkTokens, scaleNames, scaleTokens);
  const html = readFileSync(showcasePath, 'utf8');
  const nextHtml = replaceBetweenMarkers(html, tokensBlock);
  writeFileSync(showcasePath, nextHtml, 'utf8');

  const tokensList = lightNames.map((name) => ({
    name,
    light: lightTokens.get(name),
    dark: darkTokens.has(name) ? darkTokens.get(name) : lightTokens.get(name),
  }));
  writeFileSync(tokensJsonPath, `${JSON.stringify(tokensList, null, 2)}\n`, 'utf8');

  return { light: lightTokens.size, dark: darkTokens.size };
}

// ---------------------------------------------------------------------------
// 6. CLI entry — only runs when this file is executed directly, not when
//    imported (e.g. by showcase-build.test.mjs).
// ---------------------------------------------------------------------------

const thisFile = fileURLToPath(import.meta.url);
const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(thisFile);

if (invokedAsScript) {
  const dir = path.dirname(thisFile);
  const { light, dark } = buildTokens(dir);
  console.log(
    `showcase-build: regenerated TOKENS block + tokens.json (${light} light / ${dark} dark props) in ${dir}`,
  );
}
