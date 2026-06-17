'use strict';

/**
 * Integration tests for `sigmap scaffold` (Layer 4 — confidence floor).
 *   proposeScaffold: propose / refuse / hard-floor / force / pytest · CLI
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'gen-context.js');
const { proposeScaffold, HARD_FLOOR, DEFAULT_THRESHOLD } =
  require(path.join(ROOT, 'src/scaffold/propose'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.error(`  FAIL  ${name}`); console.error(`        ${err.message}`); failed++; }
}

function withRepo(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-'));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// Build a conventions result with a specific file-naming consistency.
function conv(pct, { framework = 'jest' } = {}) {
  const major = Math.round(pct * 10);
  const minor = 10 - major;
  return {
    fileNaming: {
      dominant: 'camelCase', dominantPct: pct, total: 10,
      tier: pct >= 0.9 ? 'consistent' : pct >= 0.7 ? 'mostly' : 'inconsistent',
      variants: [
        { label: 'camelCase', count: major, pct, examples: ['fooBar.js'] },
        { label: 'kebab-case', count: minor, pct: minor / 10, examples: ['user-service.js'] },
      ],
    },
    exportStyle: { dominant: 'named', dominantPct: 1, total: 10,
      variants: [{ label: 'named', count: 10, pct: 1, examples: ['fooBar.js'] }] },
    testFramework: framework,
  };
}

// ── proposeScaffold ─────────────────────────────────────────────────────────
test('consistent → proposes convention-matched filename + export + test', () => {
  const d = proposeScaffold('user profile loader', conv(0.95));
  assert.strictEqual(d.ok, true);
  assert.strictEqual(d.refused, false);
  assert.strictEqual(d.proposal.filename, 'userProfileLoader.js');
  assert.strictEqual(d.proposal.namingStyle, 'camelCase');
  assert.strictEqual(d.proposal.exportStyle, 'named');
  assert.strictEqual(d.proposal.testFile, 'userProfileLoader.test.js');
});
test('below threshold (0.6) without force → refuses + surfaces conflicts', () => {
  const d = proposeScaffold('newWidget', conv(0.6));
  assert.strictEqual(d.ok, false);
  assert.strictEqual(d.refused, true);
  assert.strictEqual(d.proposal, null);
  assert.ok(/below the threshold/.test(d.reason));
  assert.strictEqual(d.conflicts.hasConflicts, true);
});
test('hard floor is non-overridable — below 0.5 refuses even with force', () => {
  const d = proposeScaffold('newWidget', conv(0.33), { force: true });
  assert.strictEqual(d.ok, false);
  assert.ok(/hard floor/.test(d.reason));
  assert.strictEqual(d.proposal, null);
});
test('force allows a proposal between hard floor and threshold (with warning)', () => {
  const d = proposeScaffold('newWidget', conv(0.6), { force: true });
  assert.strictEqual(d.ok, true);
  assert.strictEqual(d.forced, true);
  assert.ok(d.warning && /force/.test(d.warning));
  assert.strictEqual(d.proposal.filename, 'newWidget.js');
});
test('no file-naming convention → refuses', () => {
  const d = proposeScaffold('x', { fileNaming: { dominant: null, dominantPct: 0, total: 0, variants: [] } });
  assert.strictEqual(d.ok, false);
  assert.ok(/no file-naming convention/.test(d.reason));
});
test('pytest framework → test_<snake>.py test file', () => {
  const d = proposeScaffold('UserProfile', conv(0.95, { framework: 'pytest' }), { ext: 'py' });
  assert.strictEqual(d.proposal.testFile, 'test_user_profile.py');
});
test('threshold is clamped to the hard floor', () => {
  // asking for a 0.3 threshold cannot drop below the 0.5 hard floor
  const d = proposeScaffold('w', conv(0.4), { threshold: 0.3 });
  assert.strictEqual(d.threshold, HARD_FLOOR);
  assert.strictEqual(d.ok, false); // 0.4 < 0.5 floor
});
test('custom ext is honored', () => {
  const d = proposeScaffold('myThing', conv(0.95), { ext: 'ts' });
  assert.strictEqual(d.proposal.filename, 'myThing.ts');
  assert.strictEqual(d.proposal.testFile, 'myThing.test.ts');
});

// ── CLI ─────────────────────────────────────────────────────────────────────
function writeRepo(dir, files) {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'src', f), c);
}

test('CLI: scaffold proposes on a consistent repo (exit 0)', () => {
  withRepo((dir) => {
    // 9 camelCase + 1 kebab → 90% consistent
    const files = {};
    for (let i = 0; i < 9; i++) files[`fooBar${i}.js`] = 'export const a = 1;\n';
    files['user-service.js'] = 'export const b = 2;\n';
    writeRepo(dir, files);
    const res = spawnSync('node', [SCRIPT, 'scaffold', 'new thing'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(/newThing\.js/.test(res.stdout), 'proposes styled filename');
  });
});
test('CLI: scaffold refuses on an inconsistent repo (exit 1 + conflict)', () => {
  withRepo((dir) => {
    writeRepo(dir, {
      'fooBar.js': 'export const a=1;\n',
      'user-service.js': 'export const b=2;\n',
      'some_thing.js': 'export const c=3;\n',
    });
    const res = spawnSync('node', [SCRIPT, 'scaffold', 'new widget'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(res.status, 1, 'refusal exits 1');
    assert.ok(/REFUSED/.test(res.stdout), 'prints REFUSED');
  });
});
test('CLI: scaffold --json emits the decision', () => {
  withRepo((dir) => {
    const files = {};
    for (let i = 0; i < 9; i++) files[`fooBar${i}.js`] = 'export const a = 1;\n';
    files['user-service.js'] = 'export const b = 2;\n';
    writeRepo(dir, files);
    const res = spawnSync('node', [SCRIPT, 'scaffold', 'myThing', '--json'], { cwd: dir, encoding: 'utf8' });
    const data = JSON.parse(res.stdout.trim().split('\n').pop());
    assert.strictEqual(typeof data.ok, 'boolean');
    assert.strictEqual(data.hardFloor, HARD_FLOOR);
    assert.ok(data.proposal);
  });
});
test('CLI: scaffold with no name exits 1 with usage', () => {
  withRepo((dir) => {
    writeRepo(dir, { 'a.js': 'export const a=1;\n' });
    const res = spawnSync('node', [SCRIPT, 'scaffold'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(res.status, 1);
    assert.ok(/usage/.test(res.stderr));
  });
});

console.log(`\nscaffold: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
