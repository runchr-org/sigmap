'use strict';

/**
 * README + version.json metrics sync (scripts/sync-metrics.mjs).
 * Every public number reads from benchmarks/latest.json via markers (H1).
 * Run: node test/integration/readme-metrics.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts', 'sync-metrics.mjs');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
}

(async () => {
  const mod = await import('url').then((u) => import(u.pathToFileURL(SCRIPT).href));
  const { renderTokens, applyTokens, findDrift } = mod;

  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

  test('committed README + version.json are in sync with latest.json', () => {
    assert.deepStrictEqual(findDrift(ROOT), []);
  });

  test('CLI --check passes (exit 0) on the committed repo', () => {
    const out = execFileSync(process.execPath, [SCRIPT, '--check'], { cwd: ROOT, encoding: 'utf8' });
    assert.ok(/in sync/.test(out), out);
  });

  test('README declares every marker key that renderTokens produces', () => {
    for (const key of Object.keys(renderTokens(ROOT))) {
      assert.ok(readme.includes(`<!--SM:${key}-->`), `missing open marker for ${key}`);
      assert.ok(readme.includes(`<!--/SM:${key}-->`), `missing close marker for ${key}`);
    }
  });

  test('renderTokens derives values from latest.json, not hand-typed', () => {
    const latest = require(path.join(ROOT, 'benchmarks/latest.json'));
    const t = renderTokens(ROOT);
    assert.strictEqual(t.hitWhole, `${Math.round(latest.metrics.hit_at_5 * 100)}%`);
    assert.ok(t.benchmarkBlock.includes(latest.benchmark_id), 'benchmark block carries the id');
    assert.ok(t.whyMetrics.includes(`${(latest.metrics.hit_at_5 * 100).toFixed(1)}%`), 'bullets carry hit@5');
  });

  test('applyTokens replaces marker content and is idempotent', () => {
    const sample = 'x <!--SM:hitWhole-->OLD<!--/SM:hitWhole--> y';
    const once = applyTokens(sample, { hitWhole: '81%' });
    assert.strictEqual(once, 'x <!--SM:hitWhole-->81%<!--/SM:hitWhole--> y');
    assert.strictEqual(applyTokens(once, { hitWhole: '81%' }), once);
  });

  test('applyTokens throws when a declared marker is absent', () => {
    assert.throws(() => applyTokens('no markers here', { hitWhole: '81%' }), /marker missing/);
  });

  test('no stale pre-Trust-Hygiene metric survives in README', () => {
    for (const stale of ['75.6%', '97.0%', '52.2%', '1.72 prompts', '5.6× lift', '31 languages']) {
      assert.ok(!readme.includes(stale), `stale metric still present: ${stale}`);
    }
  });

  console.log(`\nreadme-metrics: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
