'use strict';

/**
 * Integration test: the star nudge counts plain `sigmap` context-generation runs,
 * not just `ask`/`squeeze` (v7.0.1). Most users only ever run `sigmap` to build the
 * context file — they must still reach the one-time GitHub-star nudge.
 *
 * Verifies, by spawning the real CLI:
 *   - a default generation run increments usage.json
 *   - the nudge fires once at the 10-run / 8-success threshold
 *   - --json generation still counts but stays silent
 *   - a monorepo run counts once, at the repo root (not per package)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(ROOT, 'gen-context.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.error(`  FAIL  ${name}`); console.error(`        ${err.message}`); failed++; }
}

function makeRepo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sigmap-gennudge-'));
  fs.mkdirSync(path.join(d, 'src'));
  fs.writeFileSync(path.join(d, 'src', 'm.js'),
    'function login(user, pass) { return token; }\nmodule.exports = { login };\n');
  return d;
}

function seedUsage(d, totalRuns) {
  fs.mkdirSync(path.join(d, '.context'), { recursive: true });
  fs.writeFileSync(path.join(d, '.context', 'usage.json'), JSON.stringify({
    totalRuns, successfulRuns: totalRuns, squeezeOffered: 0, squeezeAccepted: 0,
    starNudgeShown: false, machineId: '', firstRunDate: '2026-06-13', lastRunDate: '2026-06-13',
  }));
}

function readUsage(d) {
  return JSON.parse(fs.readFileSync(path.join(d, '.context', 'usage.json'), 'utf8'));
}

function runGen(cwd, args = []) {
  return spawnSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
}

test('generation: a default run increments the usage counter', () => {
  const d = makeRepo();
  seedUsage(d, 0);
  runGen(d);
  const u = readUsage(d);
  assert.strictEqual(u.totalRuns, 1, 'totalRuns should advance to 1');
  assert.strictEqual(u.successfulRuns, 1, 'successfulRuns should advance to 1');
});

test('generation: fires the star nudge once at the 10-run threshold', () => {
  const d = makeRepo();
  seedUsage(d, 9);
  runGen(d);
  const u = readUsage(d);
  assert.strictEqual(u.totalRuns, 10, 'should reach 10 runs');
  assert.strictEqual(u.starNudgeShown, true, 'nudge should have fired');
});

test('generation: --json run still counts toward the nudge', () => {
  const d = makeRepo();
  seedUsage(d, 5);
  runGen(d, ['--json']);
  assert.strictEqual(readUsage(d).totalRuns, 6, '--json run must still count');
});

test('generation: monorepo counts once at the root, not per package', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sigmap-gennudge-mono-'));
  for (const pkg of ['a', 'b']) {
    fs.mkdirSync(path.join(d, 'packages', pkg, 'src'), { recursive: true });
    fs.writeFileSync(path.join(d, 'packages', pkg, 'package.json'), JSON.stringify({ name: pkg }));
    fs.writeFileSync(path.join(d, 'packages', pkg, 'src', `${pkg}.js`),
      `function f${pkg}() {}\nmodule.exports = { f${pkg} };\n`);
  }
  seedUsage(d, 0);
  runGen(d, ['--monorepo']);
  assert.strictEqual(readUsage(d).totalRuns, 1, 'monorepo run should count exactly once');
  // and it must not scatter a usage.json into the package dirs
  assert.ok(!fs.existsSync(path.join(d, 'packages', 'a', '.context', 'usage.json')),
    'no per-package usage.json should be written');
});

console.log(`\nnudge-generation: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
