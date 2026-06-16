# Releasing SigMap

The release pipeline is split between two skills and the branch model. **Run order is always `/update-docs` → `/ship`.**

## Branch model

```
feature/fix branches ──PR──▶ develop ──PR──▶ main ──tag vX.Y.Z──▶ npm + binaries
```

- Contributor work targets **`develop`** (the integration branch).
- `develop` is promoted to **`main`** via PR; the **tag is cut on `main`'s merge commit**.
- Both branches are protected (PR + status checks). Merge protected branches as the **owner** (ruleset bypass) or via PR — never the `github-actions[bot]` token.
- Auto-delete-head-branches is enabled, so merged PR branches clean themselves up.

## Step 1 — `/update-docs` (version + changelog authority)

Run on `develop` (or a `docs/release-vX.Y.Z` branch cut from it). It owns the version number and `CHANGELOG.md`:

1. Detects everything merged into `develop` since the last tag (including external PRs).
2. Computes the semver bump (`feat:` → minor, `fix:`/`chore:` → patch, `!`/`BREAKING` → major).
3. Writes the `CHANGELOG.md` entry and syncs every version-bearing file via `scripts/sync-versions.mjs` (`package.json` ×3, `gen-context.js` `VERSION`, `src/mcp/server.js`). Sets `version.json` `version`.
4. Runs benchmarks and refreshes docs (`docs-vp/`, README, SVGs) + regenerates `llms.txt` / `llms-full.txt`.
5. Commits as `chore(release): vX.Y.Z …` and pushes (owner or `docs/release-vX.Y.Z` PR into `develop`).

`version.json` numeric metadata (`mcp_tools`, `tests`) is derived — `scripts/check-version-meta.mjs` keeps it honest. `languages` is editorial (the extractor files include non-language helpers/dupes).

## Step 2 — `/ship` (tag, PR, release)

`/ship` does **not** bump the version or write the changelog — it ships what `/update-docs` prepared:

1. **Detects the prepared release**: if `package.json` version === top `CHANGELOG.md` version and no `vX.Y.Z` tag exists → PREPARED (skip any bump). If a tag already exists → already shipped, stop.
2. Confirms a clean tree and a green suite.
3. Lands the release commit on `main` (PR `develop` → `main`, merged by the owner).
4. **Tags the `main` merge commit** (`git tag -a vX.Y.Z <merge-commit>`) and pushes the tag.
5. Creates the GitHub Release from the `CHANGELOG.md` section (a tag-triggered workflow may auto-create it).

## What the tag triggers

Pushing `vX.Y.Z` fires two workflows in parallel:

- **`npm-publish.yml`** — publishes to npm (`--provenance`) + GitHub Packages. ⚠️ No "already-published" guard: re-pushing an existing version's tag makes this job fail. The GIFs are excluded from the tarball (only the `files` allowlist ships).
- **`release-binaries.yml`** — builds standalone SEA binaries (darwin-arm64, linux-x64, win32-x64) via `scripts/build-binary.mjs` and attaches them + checksums to the Release.

## Gates (must stay green)

| Gate | Where | Catches |
|---|---|---|
| `scripts/check-bundle.mjs` | CI (every PR) + `prepublishOnly` + `build-binary` preflight | a `src/` module missing from `gen-context.js` `__factories` (breaks the standalone binary) |
| `scripts/check-version-meta.mjs` | `prepublishOnly` | stale `version.json` metadata |
| unit + integration (`test/integration/all.js`) | CI on Node 18/20/22 | regressions; includes a **standalone-bundle smoke test** that runs `gen-context.js` with no `src/` present |

## Re-tagging (recovery only)

Only delete + recreate a pushed tag when the prior pipeline failed **and** the maintainer asks. Tag the fixed, merged `main` commit. Expect `npm-publish` to fail (the version is already on npm) — that job is cosmetic on a re-tag; the goal is rebuilding the binaries.

## The bundle (`gen-context.js`)

The shipped CLI is a single 569 KB file: hand-authored CLI logic + a `__factories` copy of every `src/` (and `packages/adapters/`) module so it runs with no `src/` present (npx ships `src/` too; the SEA binaries do not). When you add a `src/` module, register it: `node scripts/check-bundle.mjs --fix`, then commit `gen-context.js`. Full byte-level regeneration is intentionally not automated — the factory bodies are hand-maintained and only the *presence* check is enforced.
