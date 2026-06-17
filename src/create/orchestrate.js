'use strict';

/**
 * create orchestrator (IMPL.md §6.2 — the capstone of the grounded-creation loop).
 *
 * Sequences the four guard stages — scaffold → verify-plan → verify-ai-output →
 * review-pr — in one pass with `n/4` numbering and a single pass/fail summary.
 * The agent does the LLM writing between stages; `create` runs the deterministic
 * guards it owns. A stage runs only when its input is present (else it is
 * skipped, which does not fail the run). Zero-dependency, bundle-safe; delegates
 * to the real stage modules.
 */

const { proposeScaffold } = require('../scaffold/propose');
const { verifyPlan } = require('../plan/verify-plan');
const { verify } = require('../verify/hallucination-guard');
const { reviewPr } = require('../review/review-pr');

const TOTAL = 4;

/**
 * Run the create pipeline over whatever inputs are available.
 * @param {object} ctx
 * @param {string} [ctx.task] free-text task label (echoed back)
 * @param {string} [ctx.name] module name → enables the scaffold stage
 * @param {object} [ctx.conventions] an `extractConventions` result (for scaffold)
 * @param {object} [ctx.scaffoldOpts] options forwarded to `proposeScaffold`
 * @param {string} [ctx.plan] plan markdown → enables verify-plan
 * @param {string} [ctx.answer] AI answer markdown → enables verify-ai-output
 * @param {Array<{path:string,status:string}>} [ctx.changedFiles] → enables review-pr
 * @param {string} cwd repo root
 * @returns {{ task: string|null, steps: object[], summary: object }}
 */
function orchestrate(ctx = {}, cwd) {
  const steps = [];

  // 1/4 — scaffold (needs a name + conventions)
  if (ctx.name && ctx.conventions) {
    const d = proposeScaffold(ctx.name, ctx.conventions, ctx.scaffoldOpts || {});
    steps.push({ n: 1, total: TOTAL, name: 'scaffold', ran: true, ok: !!d.ok, skipped: false, detail: d });
  } else {
    steps.push({ n: 1, total: TOTAL, name: 'scaffold', ran: false, ok: null, skipped: true, reason: 'no --name' });
  }

  // 2/4 — verify-plan (needs a plan)
  if (ctx.plan != null && String(ctx.plan).trim() !== '') {
    const r = verifyPlan(ctx.plan, cwd);
    steps.push({ n: 2, total: TOTAL, name: 'verify-plan', ran: true, ok: !!r.summary.ok, skipped: false, detail: r });
  } else {
    steps.push({ n: 2, total: TOTAL, name: 'verify-plan', ran: false, ok: null, skipped: true, reason: 'no --plan' });
  }

  // 3/4 — verify-ai-output (needs an answer)
  if (ctx.answer != null && String(ctx.answer).trim() !== '') {
    const r = verify(ctx.answer, cwd);
    steps.push({ n: 3, total: TOTAL, name: 'verify-ai-output', ran: true, ok: r.summary.total === 0, skipped: false, detail: r });
  } else {
    steps.push({ n: 3, total: TOTAL, name: 'verify-ai-output', ran: false, ok: null, skipped: true, reason: 'no --answer' });
  }

  // 4/4 — review-pr (needs changed files)
  if (Array.isArray(ctx.changedFiles) && ctx.changedFiles.length) {
    const r = reviewPr(ctx.changedFiles, cwd);
    steps.push({ n: 4, total: TOTAL, name: 'review-pr', ran: true, ok: !!r.summary.ok, skipped: false, detail: r });
  } else {
    steps.push({ n: 4, total: TOTAL, name: 'review-pr', ran: false, ok: null, skipped: true, reason: 'no changes' });
  }

  const ran = steps.filter((s) => s.ran);
  const passed = ran.filter((s) => s.ok).length;
  const failed = ran.length - passed;
  return {
    task: ctx.task || null,
    steps,
    summary: {
      total: TOTAL,
      ran: ran.length,
      skipped: steps.length - ran.length,
      passed,
      failed,
      ok: failed === 0,
    },
  };
}

module.exports = { orchestrate, TOTAL };
