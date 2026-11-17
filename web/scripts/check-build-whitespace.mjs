// Fails if the built site runs words into inline elements: "using the<a>NodeNormalization API</a>".
//
// Astro 7 changed `compressHTML`'s default to 'jsx', which drops the whitespace between a line
// of text and an inline element that starts the next line. The pages' prose is written that
// way, so astro.config.mjs sets `compressHTML: true` to keep Astro 6's behaviour. Nothing else
// notices if that option is removed or changes meaning: Vitest, the type check and the build
// all still pass. It runs as `postbuild`, so every `npm run build` checks its own output,
// the deploy included.
//
// Usage: node scripts/check-build-whitespace.mjs [dist-dir]   (default: dist)
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const INLINE = 'a|code|em|strong|b|i|kbd';
// A letter or digit directly before an inline element's opening tag, or directly after its
// closing tag. Punctuation is allowed on either side ("<a>Babel</a>," or "(<code>").
const RUN_TOGETHER = new RegExp(`[\\p{L}\\p{N}]<(?:${INLINE})[\\s>]|</(?:${INLINE})>[\\p{L}\\p{N}]`, 'gu');

const dist = process.argv[2] ?? 'dist';

function* htmlFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(path);
    else if (entry.name.endsWith('.html')) yield path;
  }
}

// Scripts and styles are not prose, and minified code is full of these sequences.
const stripCode = (html) => html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');

let failures = 0;
let files = 0;
for (const file of htmlFiles(dist)) {
  files++;
  const html = stripCode(readFileSync(file, 'utf8'));
  for (const match of html.matchAll(RUN_TOGETHER)) {
    failures++;
    const context = html.slice(Math.max(0, match.index - 40), match.index + 60).replace(/\s+/g, ' ');
    console.error(`${relative(dist, file)}: no space around an inline element: …${context}…`);
  }
}

if (files === 0) {
  console.error(`No HTML files under ${dist}/; run \`npm run build\` first.`);
  process.exit(1);
}
if (failures > 0) {
  console.error(
    `\n${failures} place(s) where text runs into an inline element. ` +
      'Check that astro.config.mjs still sets `compressHTML: true`; see the comment there.',
  );
  process.exit(1);
}
console.log(`${files} built page(s) keep the whitespace around inline elements.`);
