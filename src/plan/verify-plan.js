'use strict';

/**
 * verify-plan (IMPL.md §6.1 — Gap 2, step 2 of the `create` pipeline).
 *
 * Checks a plan (markdown) against the LIVE index before execution: do the
 * referenced files and symbols exist, is the blast radius acceptable, is the
 * scope in bounds? Catches Cause 1+2 at plan time — cheaper than after the
 * code is written. Reuses the verify primitives + the impact graph.
 * Zero-dependency, bundle-safe.
 */

const fs = require('fs');
const path = require('path');
const { extractFilePaths, extractSymbols } = require('../verify/parsers');
const { buildSymbolSet } = require('../verify/hallucination-guard');
const { closestMatch } = require('../verify/closest-match');
const { analyzeImpact } = require('../graph/impact');

const DEFAULT_BLAST_THRESHOLD = 20; // transitive+direct dependents → "high blast radius"
const DEFAULT_SCOPE_THRESHOLD = 10; // distinct referenced files → "broad scope"

/** Resolve a referenced path against cwd (handles a leading "./"). */
function _fileExists(cwd, ref) {
  const clean = ref.replace(/^\.\//, '');
  for (const c of [path.resolve(cwd, clean), path.resolve(cwd, ref)]) {
    try { if (fs.existsSync(c)) return true; } catch (_) {}
  }
  return false;
}

/**
 * Verify a plan against the live index.
 * @param {string} planText the plan as markdown
 * @param {string} cwd repo root
 * @param {object} [opts]
 * @param {number} [opts.blastThreshold=20]
 * @param {number} [opts.scopeThreshold=10]
 * @param {(ref:string)=>boolean} [opts.fileExists] override for testing
 * @returns {{ issues: object[], blast: object[], scope: object, summary: object }}
 */
function verifyPlan(planText, cwd, opts = {}) {
  const blastThreshold = opts.blastThreshold != null ? opts.blastThreshold : DEFAULT_BLAST_THRESHOLD;
  const scopeThreshold = opts.scopeThreshold != null ? opts.scopeThreshold : DEFAULT_SCOPE_THRESHOLD;
  const fileExists = opts.fileExists || ((ref) => _fileExists(cwd, ref));

  const text = String(planText || '');
  const filesRef = extractFilePaths(text);   // [{ path, line }]
  const symbolsRef = extractSymbols(text);   // [{ name, line }]
  const { set: symbolSet, symbolCandidates } = buildSymbolSet(cwd);

  const issues = [];

  // 1. Referenced files must exist.
  const existingFiles = [];
  for (const f of filesRef) {
    if (fileExists(f.path)) existingFiles.push(f.path);
    else issues.push({ type: 'missing-file', ref: f.path, line: f.line, severity: 'error' });
  }

  // 2. Referenced symbols must exist in the live index (suggest a near match).
  for (const s of symbolsRef) {
    if (symbolSet.has(s.name)) continue;
    const match = closestMatch(s.name, symbolCandidates);
    issues.push({
      type: 'unknown-symbol', ref: s.name, line: s.line, severity: 'error',
      suggestion: match ? match.name : null,
    });
  }

  // 3. Blast radius for each existing referenced file (one graph build).
  const blast = [];
  if (existingFiles.length) {
    let impacts = [];
    try { impacts = analyzeImpact(existingFiles, cwd, {}); } catch (_) { impacts = []; }
    for (const { file, impact } of impacts) {
      const entry = { file, totalImpact: impact.totalImpact, tests: impact.tests.length };
      blast.push(entry);
      if (impact.totalImpact > blastThreshold) {
        issues.push({ type: 'high-blast-radius', ref: file, count: impact.totalImpact, severity: 'warn' });
      }
    }
    blast.sort((a, b) => b.totalImpact - a.totalImpact);
  }

  // 4. Scope.
  const scope = { files: filesRef.length, symbols: symbolsRef.length, threshold: scopeThreshold };
  if (filesRef.length > scopeThreshold) {
    issues.push({ type: 'broad-scope', count: filesRef.length, threshold: scopeThreshold, severity: 'warn' });
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warn').length;
  return {
    issues,
    blast,
    scope,
    summary: {
      filesReferenced: filesRef.length,
      symbolsReferenced: symbolsRef.length,
      errors,
      warnings,
      ok: errors === 0,
    },
  };
}

module.exports = { verifyPlan, DEFAULT_BLAST_THRESHOLD, DEFAULT_SCOPE_THRESHOLD };
