'use strict';

/**
 * v6.12.0 — Token Reduction dashboard panel (Surface A).
 * The panel reads benchmarks/reports/token-reduction.json — numbers are never hand-typed.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { generateDashboardHtml } = require('../../src/format/dashboard');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}: ${err.message}`);
    failed++;
  }
}

function withTempProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-tokpanel-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function seedReport(dir, repos) {
  const p = path.join(dir, 'benchmarks', 'reports');
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, 'token-reduction.json'), JSON.stringify({ version: '6.12.0', repos }));
}

const HEALTH = { grade: 'A', score: 90, daysSinceRegen: 0 };

console.log('\ntoken-savings-panel: dashboard Token Reduction panel\n');

test('panel renders aggregated baseline vs signatures from the benchmark', () => {
  withTempProject((dir) => {
    seedReport(dir, [
      { repo: 'express', language: 'JavaScript', rawTokens: 70000, finalTokens: 1000, reductionPct: 98.6 },
      { repo: 'flask', language: 'Python', rawTokens: 30000, finalTokens: 2000, reductionPct: 93.3 },
    ]);
    const { html, data } = generateDashboardHtml(dir, HEALTH);
    assert.ok(html.includes('Token Reduction'), 'panel title present');
    assert.ok(html.includes('Whole-file baseline'), 'baseline tier present');
    assert.strictEqual(data.tokenReduction.baseline, 100000, 'baseline = sum of rawTokens');
    assert.strictEqual(data.tokenReduction.signatures, 3000, 'signatures = sum of finalTokens');
    assert.strictEqual(data.tokenReduction.savedPct, 97, 'savedPct computed from real numbers');
    assert.ok(html.includes('express') && html.includes('flask'), 'per-repo rows rendered');
  });
});

test('panel renders a surgical tier when the benchmark provides surgicalTokens', () => {
  withTempProject((dir) => {
    seedReport(dir, [
      { repo: 'express', language: 'JavaScript', rawTokens: 70000, finalTokens: 1000, surgicalTokens: 300, reductionPct: 98.6 },
    ]);
    const { html, data } = generateDashboardHtml(dir, HEALTH);
    assert.strictEqual(data.tokenReduction.surgical, 300, 'surgical aggregate present');
    assert.ok(html.includes('Surgical (index + delta)'), 'surgical tier rendered');
  });
});

test('panel degrades gracefully when no benchmark report exists', () => {
  withTempProject((dir) => {
    const { html, data } = generateDashboardHtml(dir, HEALTH);
    assert.strictEqual(data.tokenReduction, null, 'no benchmark → null data');
    assert.ok(html.includes('Token Reduction'), 'panel still renders a placeholder');
    assert.ok(html.includes('No token-reduction benchmark found'), 'placeholder message present');
  });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
