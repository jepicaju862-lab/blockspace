# Changelog

All notable changes to Blockspace Workspace are documented in this file.

Version history prior to 0.17.2 was not tracked in a changelog; `manifest.json`'s
version field was also out of sync with the version documented in the README and
embedded in `main.js` for several releases. This file starts tracking from the
point that was fixed.

## 0.18.1

- **Cleanup:** the current-page menu, the kanban card menu, and the (separate,
  near-identical) page-card menu each had their own copy of "打开" / "复制页面
  链接" / "新建子页面" / "移动页面…" / export items. Extracted a shared
  `buildPageActionsMenu` + `addPageHierarchyMenuItems` so there is one place
  that builds them, instead of three that had to be kept in sync by hand.
- **Cleanup:** the settings tab was one flat, unordered list of 23 settings.
  Grouped it into four headed sections (数据与存储 / Markdown 与互操作 / 外观
  与布局 / 工作台行为) using Obsidian's `Setting.setHeading()`, matching
  current plugin-settings conventions. No setting was added, removed, or
  renamed — verified the exact same 23 setting names still appear, only
  reordered and grouped.

## 0.18.0

- **Added: page hierarchy.** Pages already had a `parentId` field on disk, but
  nothing could set it and nothing rendered it — no way to create a sub-page,
  no tree view anywhere, so it was pure dead data. This wires it up:
  - "新建子页面" (new sub-page) in the current-page menu and the page-card
    menu (kanban board), creating a page with the current one as its parent.
  - "移动页面…" (move page) opens a page picker to set or clear a page's
    parent; a page's parent can also be changed from the "父页面" row now in
    the inspector's page-properties section.
  - Reparenting rejects a page becoming its own parent or being moved under
    one of its own descendants (would create a cycle).
  - Deleting a page promotes its children to the deleted page's own parent,
    instead of leaving their `parentId` pointing at a page that no longer
    exists.
  - The quick switcher now lists pages depth-first (a page immediately
    followed by its own children, each indented one level further) instead
    of a flat recency list, so the hierarchy is visible while browsing.
  - Verified with a standalone test exercising cycle rejection, a valid
    reparent, and child promotion on delete against an in-memory vault
    adapter, plus a second test of the quick switcher's tree-ordering
    (including its fallback for a page with a stale/cyclic `parentId`, which
    still surfaces at the top level instead of disappearing).

## 0.17.3

- **Fix (data loss):** two panes with the same page open could both pass
  `savePage`'s revision check against the same stale disk read and silently
  clobber each other's edit, with no conflict reported. Concurrent saves for
  the same page id are now serialized so the losing save correctly sees the
  bumped revision and gets a conflict (with a recovery copy of its edits),
  instead of being silently overwritten.
- **Fix (data loss risk):** Obsidian does not wait for `onunload()` to finish
  on plugin disable/reload/app quit, so an edit still waiting out the
  autosave debounce at that moment could be lost with nothing journaled for
  it. Views now flush immediately when their window loses focus or is
  hidden, sharply narrowing that window.
- **Fix:** typing while the Find & Replace panel was open didn't refresh its
  match list, so match counts and highlights went stale and "Replace" could
  silently do nothing until you touched the find bar's own inputs.
- **Fix:** deleting a page that was also open in another pane left that pane
  to discover it only via an opaque "page file missing" conflict on its next
  autosave. Other panes are now switched away immediately, with any unsaved
  edits in them preserved as a recovery copy first.
- **Fix:** if one file in a multi-file attachment upload/drop failed, the
  already-written files from the same batch were silently orphaned in the
  vault (written, but never referenced by any block). Successful files are
  now inserted regardless of a later failure in the same batch.
- **Fix:** a page file that failed to parse or failed validation during
  startup's index rebuild used to disappear from the workspace with no
  signal beyond a console log. A Notice now reports how many pages were
  skipped and points at "打开诊断与恢复".
- **Fix:** the Find & Replace panel used a hardcoded `z-index: 60` instead of
  Obsidian's `--layer-menu` variable used by the rest of the plugin's
  floating panels, so it could render behind/in front of the slash menu,
  format toolbar, or drag preview depending on that variable's actual value.

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
