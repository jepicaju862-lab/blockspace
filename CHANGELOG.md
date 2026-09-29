# Changelog

All notable changes to Blockspace Workspace are documented in this file.

Version history prior to 0.17.2 was not tracked in a changelog; `manifest.json`'s
version field was also out of sync with the version documented in the README and
embedded in `main.js` for several releases. This file starts tracking from the
point that was fixed.

## 0.17.2

- **Fix:** the published `main.js` and `styles.css` had been accidentally
  overwritten with the build output of an unrelated plugin (an audio-journal
  "Life Records" style plugin), so a manual install produced a non-functional,
  unrelated plugin instead of Blockspace Workspace. Restored the correct
  `main.js`/`styles.css`, built from `src/core.cjs`, `src/export.cjs` and
  `src/plugin.cjs`.
- Added a reproducible build pipeline (`package.json`, `esbuild.config.mjs`) so
  `main.js` is always generated from `src/*.cjs` via `npm run build`, instead of
  being hand-assembled or uploaded separately.
- Added `versions.json` for Obsidian's `minAppVersion` compatibility checks.
- Synced `manifest.json`'s `version` field with the version documented in the
  README and `main.js`.
