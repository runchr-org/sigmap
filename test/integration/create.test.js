'use strict';

/**
 * Integration tests for `sigmap create` (Gap 2 capstone — the orchestrator).
 *   orchestrate: ordering / numbering / skip / pass-fail aggregation · CLI
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'gen-context.js');
const { orchestrate, TOTAL } = require(path.join(ROOT, 'src/create/orchestrate'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.error(`  FAIL  ${name}`); console.error(`        ${err.message}`); failed++; }
}

// A consistent conventions result so the scaffold stage can propose.
const consistentConventions = {
  fileNaming: { dominant: 'camelCase', dominantPct: 0.95, total: 10, tier: 'consistent',
    variants: [{ label: 'camelCase', count: 10, pct: 1, examples: ['fooBar.js'] }] },
  exportStyle: { dominant: 'named', dominantPct: 1, total: 10,
    variants: [{ label: 'named', count: 10, pct: 1, examples: ['fooBar.js'] }] },
  testFramework: 'jest',
};

// ── orchestrate (pure) ──────────────────────────────────────────────────────
test('all stages skipped with empty ctx → 4 skipped, ok', () => {
  const r = orchestrate({}, ROOT);
  assert.strictEqual(r.steps.length, 4);
  assert.strictEqual(r.summary.ran, 0);
  assert.strictEqual(r.summary.skipped, 4);
  assert.strictEqual(r.summary.ok, true); // nothing ran → nothing failed
});
test('steps are numbered 1/4..4/4 in pipeline order', () => {
  const r = orchestrate({}, ROOT);
  assert.deepStrictEqual(r.steps.map((s) => s.n), [1, 2, 3, 4]);
  assert.deepStrictEqual(r.steps.map((s) => s.name),
    ['scaffold', 'verify-plan', 'verify-ai-output', 'review-pr']);
  assert.ok(r.steps.every((s) => s.total === TOTAL));
});
test('scaffold runs when name + conventions present', () => {
  const r = orchestrate({ name: 'user widget', conventions: consistentConventions }, ROOT);
  const sc = r.steps[0];
  assert.strictEqual(sc.ran, true);
  assert.strictEqual(sc.ok, true);
  assert.strictEqual(sc.detail.proposal.filename, 'userWidget.js');
});
test('verify-plan failure makes summary not ok', () => {
  const r = orchestrate({ plan: 'Edit `src/does-not-exist.js`.' }, ROOT);
  const vp = r.steps[1];
  assert.strictEqual(vp.ran, true);
  assert.strictEqual(vp.ok, false);
  assert.strictEqual(r.summary.ok, false);
  assert.strictEqual(r.summary.failed, 1);
});
test('review-pr runs from changedFiles', () => {
  const r = orchestrate({ changedFiles: [{ path: '.env', status: 'M' }] }, ROOT);
  const rp = r.steps[3];
  assert.strictEqual(rp.ran, true);
  assert.strictEqual(rp.ok, false); // .env is a security finding
});
test('skipped stages never fail the run', () => {
  // scaffold ok, others skipped → ok true
  const r = orchestrate({ name: 'thing', conventions: consistentConventions }, ROOT);
  assert.strictEqual(r.summary.ran, 1);
  assert.strictEqual(r.summary.skipped, 3);
  assert.strictEqual(r.summary.ok, true);
});

// ── CLI ─────────────────────────────────────────────────────────────────────
function withGitRepo(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-'));
  const g = (a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  try {
    g(['init', '-q']); g(['config', 'user.email', 't@t.t']); g(['config', 'user.name', 'T']);
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'fooBar.js'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(dir, 'src', 'bazQux.js'), 'export const b = 2;\n');
    execFileSync(process.execPath, [SCRIPT], { cwd: dir, stdio: 'ignore' });
    g(['add', '-A']); g(['commit', '-q', '-m', 'base']);
    fn(dir, g);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('CLI: create with --name + --plan runs 2 stages (exit 0)', () => {
  withGitRepo((dir) => {
    fs.writeFileSync(path.join(dir, 'plan.md'), 'Reference `src/fooBar.js`.');
    const res = spawnSync('node', [SCRIPT, 'create', 'demo', '--name', 'new thing', '--plan', 'plan.md'],
      { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.ok(/1\/4 . scaffold/.test(res.stdout), res.stdout);
    assert.ok(/2\/4 . verify-plan/.test(res.stdout));
  });
});
test('CLI: create --json emits the pipeline result', () => {
  withGitRepo((dir) => {
    const res = spawnSync('node', [SCRIPT, 'create', 'demo', '--name', 'thing', '--json'],
      { cwd: dir, encoding: 'utf8' });
    const data = JSON.parse(res.stdout.trim().split('\n').pop());
    assert.strictEqual(data.summary.total, 4);
    assert.strictEqual(data.steps.length, 4);
  });
});
test('CLI: create exits 1 when a ran stage fails', () => {
  withGitRepo((dir) => {
    fs.writeFileSync(path.join(dir, 'plan.md'), 'Call `totallyFakeSymbol(...)` in `src/ghost.js`.');
    const res = spawnSync('node', [SCRIPT, 'create', 'demo', '--plan', 'plan.md'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(res.status, 1, res.stdout);
    assert.ok(/FAILED/.test(res.stdout));
  });
});

console.log(`\ncreate: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
