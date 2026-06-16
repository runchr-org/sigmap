#!/usr/bin/env node
/**
 * check-bundle.mjs — bundle integrity gate
 *
 * The shipped `gen-context.js` embeds a `__factories` copy of every `src/`
 * module so it can run standalone (no `src/` present) — e.g. the SEA binaries.
 * A new `src/` module that isn't registered there breaks the standalone build.
 * This script verifies every `src/` module is present in `__factories`.
 *
 * Usage:
 *   node scripts/check-bundle.mjs          # check; exit 1 if any module is missing
 *   node scripts/check-bundle.mjs --fix    # generate + insert factories for missing modules
 *
 * Exit codes: 0 = in sync, 1 = missing factories (check mode) or write error.
 *
 * Zero dependencies. Used by CI (every PR), prepublishOnly, and build-binary.mjs.
 */

import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUNDLE = join(ROOT, 'gen-context.js');

/** Recursively list .js files under a directory. */
function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile() && e.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Bundle key for a src file relative to `root`, e.g. "./src/tracking/logger". */
function keyFor(file, root) {
  return './' + file.slice(root.length).replace(/\.js$/, '').replace(/\\/g, '/').replace(/^\//, '');
}

/**
 * Return the list of src/ module keys missing from gen-context.js __factories.
 * @param {string} [root]
 * @returns {string[]}
 */
export function findMissingFactories(root = ROOT) {
  const bundle = readFileSync(join(root, 'gen-context.js'), 'utf8');
  const missing = [];
  for (const file of walk(join(root, 'src'))) {
    const key = keyFor(file, root);
    if (!bundle.includes(`"${key}"`)) missing.push(key);
  }
  return missing;
}

/** Generate a factory block for a module key, from its source file. */
export function generateFactory(key) {
  const file = join(ROOT, key.replace(/^\.\//, '') + '.js');
  let body = readFileSync(file, 'utf8');
  body = body.replace(/^'use strict';\s*\n+/, '');
  const dir = dirname(key); // e.g. ./src/tracking
  // Rewrite local (./ or ../) requires to bundle __require keys.
  body = body.replace(/require\((['"])(\.\.?\/[^'"]+)\1\)/g, (_m, _q, rel) => {
    const parts = (dir + '/' + rel).split('/');
    const resolved = [];
    for (const p of parts) {
      if (p === '.' || p === '') continue;
      if (p === '..') resolved.pop();
      else resolved.push(p);
    }
    return `__require('./${resolved.join('/')}')`;
  });
  body = body.replace(/\s+$/, '');
  const indented = body.split('\n').map((l) => (l.length ? '  ' + l : l)).join('\n');
  return `// ── ${key} ──\n__factories["${key}"] = function(module, exports) {\n  \n${indented}\n  \n};`;
}

/** Insert factory blocks for the given missing keys into gen-context.js. */
function insertFactories(missing) {
  let content = readFileSync(BUNDLE, 'utf8');
  // Anchor: insert right before the last factory's closing so new blocks land
  // inside the factory section. Use the first factory header as the anchor and
  // prepend new blocks just after it.
  const anchor = content.indexOf('\n__factories[');
  if (anchor === -1) throw new Error('no __factories section found in gen-context.js');
  const blocks = missing.map(generateFactory).join('\n\n');
  content = content.slice(0, anchor + 1) + blocks + '\n\n' + content.slice(anchor + 1);
  writeFileSync(BUNDLE, content);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const fix = process.argv.includes('--fix');
  const missing = findMissingFactories();

  if (missing.length === 0) {
    console.log('✓ bundle integrity: all src/ modules present in gen-context.js __factories');
    return 0;
  }

  if (fix) {
    insertFactories(missing);
    console.log(`✓ bundle: inserted ${missing.length} missing factor${missing.length === 1 ? 'y' : 'ies'}:`);
    for (const k of missing) console.log(`    + ${k}`);
    // re-check
    const still = findMissingFactories();
    if (still.length) {
      console.error('ERROR: still missing after --fix:', still.join(', '));
      return 1;
    }
    return 0;
  }

  console.error('ERROR: the following src/ modules are missing from gen-context.js __factories:');
  for (const k of missing) console.error(`  ${k}`);
  console.error('\nRun `node scripts/check-bundle.mjs --fix` to add them, then commit gen-context.js.');
  return 1;
}

// Run as CLI only when invoked directly (not when imported).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
