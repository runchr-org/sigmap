'use strict';

/**
 * Standalone-bundle smoke test.
 *
 * Copies gen-context.js into a temp dir with NO src/ beside it, then runs it on
 * a fixture project. This forces the bundled __factories path (the same code the
 * SEA binaries use) instead of requireSourceOrBundled finding the repo's src/.
 * It catches a bundle that can't actually run — the functional complement to
 * scripts/check-bundle.mjs (which only checks factory presence).
 *
 * Runs in the Node 18/20/22 CI matrix via test/integration/all.js.
 * Run directly: node test/integration/bundle-smoke.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
}

/** Build an isolated bundle dir (gen-context.js only) + a fixture project. */
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-smoke-'));
  const bundle = path.join(dir, 'gen-context.js');
  fs.copyFileSync(path.join(ROOT, 'gen-context.js'), bundle);
  // sanity: no src/ next to the bundle → factories are the only resolution path
  assert.ok(!fs.existsSync(path.join(dir, 'src')), 'bundle dir must not contain src/');

  const proj = path.join(dir, 'proj');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'a.js'),
    'function alpha(x){ return x + 1; }\nclass Beta { go(){ return 2; } }\nmodule.exports = { alpha, Beta };\n');
  fs.writeFileSync(path.join(proj, 'gen-context.config.json'),
    JSON.stringify({ outputs: ['claude'], srcDirs: ['src'] }, null, 2));
  return { dir, bundle, proj };
}

test('standalone bundle: generate produces output (no src/ beside bundle)', () => {
  const { dir, bundle, proj } = setup();
  try {
    execFileSync(process.execPath, [bundle], { cwd: proj, stdio: 'ignore' });
    const out = path.join(proj, 'CLAUDE.md');
    assert.ok(fs.existsSync(out), 'CLAUDE.md not generated');
    const body = fs.readFileSync(out, 'utf8');
    assert.ok(/alpha|Beta/.test(body), 'generated context missing fixture signatures');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('standalone bundle: --health --json runs through factories', () => {
  const { dir, bundle, proj } = setup();
  try {
    execFileSync(process.execPath, [bundle], { cwd: proj, stdio: 'ignore' }); // generate first
    const out = execFileSync(process.execPath, [bundle, '--health', '--json'], { cwd: proj, encoding: 'utf8' });
    const health = JSON.parse(out);
    assert.ok(typeof health.score === 'number' && health.score >= 0 && health.score <= 100, `score=${health.score}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('standalone bundle: gain runs (gain modules load from factories)', () => {
  const { dir, bundle, proj } = setup();
  try {
    execFileSync(process.execPath, [bundle], { cwd: proj, stdio: 'ignore' });
    // gain with no log yet → empty-state, must still exit 0
    const out = execFileSync(process.execPath, [bundle, 'gain', '--json'], { cwd: proj, encoding: 'utf8' });
    const agg = JSON.parse(out);
    assert.ok(agg.totals && typeof agg.totals.count === 'number', 'gain --json missing totals');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\nbundle-smoke: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
