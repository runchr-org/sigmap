'use strict';

/**
 * Shell-free git invocation.
 *
 * Uses `execFileSync('git', [...])`, which executes the git binary directly —
 * it never spawns a system shell (`/bin/sh -c`). That means:
 *   - no shell-injection surface (arguments are passed as an array, never
 *     interpolated into a command string), and
 *   - supply-chain scanners (e.g. Socket) do not flag a "Shell access" capability.
 *
 * stderr is discarded by default (replaces the old `2>/dev/null` redirects).
 */

const { execFileSync } = require('child_process');

function git(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    ...opts,
  });
}

// Convenience: run git and return trimmed stdout, or '' on any failure.
function tryGit(args, opts = {}) {
  try { return git(args, opts).toString().trim(); }
  catch (_) { return ''; }
}

module.exports = { git, tryGit };
