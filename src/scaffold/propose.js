'use strict';

/**
 * Scaffold proposal with a confidence floor (IMPL.md §5 — Cause 3).
 *
 * Proposes a convention-matched structure for a new module — filename in the
 * repo's dominant naming style, the export style to use, and a matching test
 * file — but only when the conventions are consistent enough. Below a hard
 * floor it refuses and surfaces the conflict, because a wrong proposal
 * systematizes bad code. Pure, zero-dependency, bundle-safe; reuses the
 * conventions primitives.
 */

const { toNamingStyle, analyzeConflicts } = require('../conventions/conflicts');

// Soft threshold is configurable; the hard floor is not (IMPL.md §5.1).
const DEFAULT_THRESHOLD = 0.7;
const HARD_FLOOR = 0.5;

/** Tier for a consistency score (matches the conventions tiers). */
function _tier(pct) {
  if (pct >= 0.9) return 'consistent';
  if (pct >= 0.7) return 'mostly';
  return 'inconsistent';
}

/** Strip any extension/compound suffix from a requested name → bare stem. */
function _stem(name) {
  const s = String(name || '').trim();
  const slash = s.lastIndexOf('/');
  const base = slash >= 0 ? s.slice(slash + 1) : s;
  const dot = base.indexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Test file path for a styled stem given the detected framework + ext. */
function _testFile(styledStem, framework, ext) {
  if (framework === 'pytest' || framework === 'unittest') {
    return `test_${toNamingStyle(styledStem, 'snake_case')}.py`;
  }
  return `${styledStem}.test.${ext}`;
}

/**
 * Propose a convention-matched scaffold, gated by a confidence floor.
 * @param {string} name desired module name (any casing; extension ignored)
 * @param {object} conventions an `extractConventions` result
 * @param {object} [opts]
 * @param {number} [opts.threshold=0.7] soft threshold (clamped to ≥ hard floor)
 * @param {boolean} [opts.force=false] allow proposing below the soft threshold
 *   (never below the hard floor)
 * @param {string} [opts.ext='js'] file extension for the proposed files
 * @returns {{ ok:boolean, refused:boolean, name:string, tier:string,
 *   confidence:number, threshold:number, hardFloor:number, forced:boolean,
 *   warning:string|null, reason:string, proposal:object|null, conflicts:object }}
 */
function proposeScaffold(name, conventions, opts = {}) {
  const threshold = Math.max(HARD_FLOOR, opts.threshold != null ? opts.threshold : DEFAULT_THRESHOLD);
  const force = !!opts.force;
  const ext = opts.ext || 'js';
  const fileNaming = (conventions && conventions.fileNaming) || { dominant: null, dominantPct: 0, total: 0 };
  const exportStyle = (conventions && conventions.exportStyle) || { dominant: null };
  const confidence = fileNaming.dominantPct || 0;
  const tier = fileNaming.total > 0 ? _tier(confidence) : 'unknown';
  const conflicts = analyzeConflicts(conventions || {});

  const base = {
    ok: false, refused: true, name: String(name || ''), tier, confidence,
    threshold, hardFloor: HARD_FLOOR, forced: false, warning: null,
    reason: '', proposal: null, conflicts,
  };

  if (!fileNaming.dominant || fileNaming.total === 0) {
    return { ...base, reason: 'no file-naming convention detected — cannot propose a name' };
  }
  if (confidence < HARD_FLOOR) {
    return {
      ...base,
      reason: `file-naming consistency ${(confidence * 100).toFixed(0)}% is below the hard floor ${(HARD_FLOOR * 100).toFixed(0)}% — refusing (not overridable)`,
    };
  }
  if (confidence < threshold && !force) {
    return {
      ...base,
      reason: `file-naming consistency ${(confidence * 100).toFixed(0)}% is below the threshold ${(threshold * 100).toFixed(0)}% — refusing (use --force to override above the ${(HARD_FLOOR * 100).toFixed(0)}% floor)`,
    };
  }

  const styledStem = toNamingStyle(_stem(name), fileNaming.dominant);
  const forced = confidence < threshold && force;
  const proposal = {
    filename: `${styledStem}.${ext}`,
    namingStyle: fileNaming.dominant,
    exportStyle: exportStyle.dominant || 'named',
    testFile: _testFile(styledStem, conventions.testFramework, ext),
    testFramework: conventions.testFramework || null,
  };

  return {
    ...base,
    ok: true,
    refused: false,
    forced,
    warning: forced
      ? `proposed below the ${(threshold * 100).toFixed(0)}% threshold (--force); conventions are only ${tier}`
      : null,
    reason: forced ? 'forced proposal above the hard floor' : `conventions are ${tier} — proposing`,
    proposal,
  };
}

module.exports = { proposeScaffold, DEFAULT_THRESHOLD, HARD_FLOOR };
