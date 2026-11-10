#!/usr/bin/env node
/**
 * Replace the vendored Biolink prefix map with the one from a Biolink Model release.
 *
 *   npm run update-prefix-map                       # latest release
 *   npm run update-prefix-map -- v4.4.6             # a specific tag
 *   npm run update-prefix-map -- --summary out.md   # also write a Markdown summary
 *
 * The file is written byte-for-byte as published, so `cmp` against upstream stays a valid
 * check, and the tag goes to biolink-prefix-map.version, the one place the release is named.
 * .github/workflows/update-prefix-map.yml runs this weekly and opens a draft PR on a change.
 *
 * Dropped prefixes are deliberately not kept: the map is an exact copy of one release. A
 * prefix Biolink drops while NodeNorm still emits it (orphanet, dropped in v4.4.5) loses
 * its link-out, which is why removals head the summary.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const REPO = 'biolink/biolink-model';
const UPSTREAM_PATH = 'src/biolink_model/prefixmaps/biolink-model-prefix-map.json';
const MAP_FILE = fileURLToPath(new URL('../src/lib/biolink-prefix-map.json', import.meta.url));
const VERSION_FILE = fileURLToPath(new URL('../src/lib/biolink-prefix-map.version', import.meta.url));

function parseArgs(argv) {
  const args = { tag: null, summary: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--summary') args.summary = argv[++i];
    else if (argv[i].startsWith('-')) throw new Error(`Unknown option ${argv[i]}`);
    else args.tag = argv[i];
  }
  if (args.summary === undefined) throw new Error('--summary needs a path');
  return args;
}

async function fetchOk(url, init) {
  const resp = await fetch(url, init);
  if (!resp.ok) throw new Error(`${url} returned HTTP ${resp.status}`);
  return resp;
}

async function latestTag() {
  const headers = { Accept: 'application/vnd.github+json' };
  // In Actions, authenticate to avoid the 60-requests-an-hour anonymous limit.
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const resp = await fetchOk(`https://api.github.com/repos/${REPO}/releases/latest`, { headers });
  return (await resp.json()).tag_name;
}

/** Parse a prefix map, refusing anything that is not a non-empty object of strings. */
function parseMap(text, source) {
  const map = JSON.parse(text);
  const valid =
    map !== null &&
    typeof map === 'object' &&
    !Array.isArray(map) &&
    Object.keys(map).length > 0 &&
    Object.values(map).every((v) => typeof v === 'string');
  if (!valid) throw new Error(`${source} is not a non-empty object of prefix → IRI strings`);
  return map;
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function diffMaps(oldMap, newMap) {
  const keys = (m) => Object.keys(m).sort();
  return {
    removed: keys(oldMap).filter((k) => !(k in newMap)),
    added: keys(newMap).filter((k) => !(k in oldMap)),
    changed: keys(newMap).filter((k) => k in oldMap && oldMap[k] !== newMap[k]),
  };
}

function summarize(oldVersion, tag, oldText, newText, oldMap, newMap, { removed, added, changed }) {
  const code = (k) => `\`${k}\``;
  const lines = [
    `Updates \`web/src/lib/biolink-prefix-map.json\` from Biolink ${oldVersion ?? '(unknown)'} ` +
      `to [${tag}](https://github.com/${REPO}/releases/tag/${tag}), as published.`,
    '',
  ];
  if (removed.length) {
    lines.push(
      `**Removed (${removed.length}) — CURIEs with these prefixes lose their link-outs:**`,
      '',
      ...removed.map((k) => `- **${code(k)}** — was ${oldMap[k]}`),
      '',
    );
  }
  if (added.length) {
    lines.push(`Added (${added.length}):`, '', ...added.map((k) => `- ${code(k)} — ${newMap[k]}`), '');
  }
  if (changed.length) {
    lines.push(
      `Changed (${changed.length}):`,
      '',
      ...changed.map((k) => `- ${code(k)} — ${oldMap[k]} → ${newMap[k]}`),
      '',
    );
  }
  if (oldText === newText) {
    lines.push('The map is unchanged; only the recorded version is new.', '');
  } else if (!removed.length && !added.length && !changed.length) {
    lines.push('No prefix was added, removed or changed; only the file itself differs.', '');
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tag = args.tag ?? (await latestTag());
  const url = `https://raw.githubusercontent.com/${REPO}/${tag}/${UPSTREAM_PATH}`;
  const newText = await (await fetchOk(url)).text();
  const newMap = parseMap(newText, url);

  const oldText = await readOptional(MAP_FILE);
  const oldVersion = (await readOptional(VERSION_FILE))?.trim() || null;

  if (oldText === newText && oldVersion === tag) {
    console.log(`Biolink prefix map already at ${tag}.`);
    return;
  }

  const oldMap = oldText === null ? {} : parseMap(oldText, MAP_FILE);
  const summary = summarize(oldVersion, tag, oldText, newText, oldMap, newMap, diffMaps(oldMap, newMap));

  await writeFile(MAP_FILE, newText);
  await writeFile(VERSION_FILE, `${tag}\n`);
  if (args.summary) await writeFile(args.summary, summary);
  console.log(summary);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
