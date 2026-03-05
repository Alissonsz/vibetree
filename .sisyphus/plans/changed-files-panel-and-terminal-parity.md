# Changed Files Panel and Terminal Parity Plan

## TL;DR
> **Summary**: Improve the right-side changed-files panel to grouped folder presentation with inline `+A -D` stats (hide zero side), and make production terminal typography match dev by bundling a Nerd Font and loading it deterministically.
> **Deliverables**:
> - Grouped changed-files UI (folder headers + indented files)
> - Backend diff-stat enrichment wired to frontend types/UI
> - Bundled Nerd Font loading for xterm in production builds
> - Updated Vitest and Rust tests for new behavior and edge cases
> **Effort**: Medium
> **Parallel**: YES - 3 waves
> **Critical Path**: 1 -> 2 -> 4 -> 7

## Context
### Original Request
- Enhance right panel changed-files presentation to match provided visual style and improve inline diff stats.
- Fix production terminal appearance so it uses Nerd Font rendering similar to dev experience.

### Interview Summary
- Folder display mode fixed to grouped folders with indented files.
- Diff stat format fixed to `+A -D` and hide zero side.
- Test approach fixed to tests-after with existing Vitest stack.
- Production font approach fixed to bundling Nerd Font in app resources/assets.

### Metis Review (gaps addressed)
- Added guardrail to keep scope to changed-files panel + terminal font parity only.
- Added explicit edge-case handling requirements for renamed/untracked/binary diff stats.
- Added build-artifact verification for bundled font and font-face usage.
- Added performance guardrail to avoid per-row subprocess calls.

## Work Objectives
### Core Objective
- Deliver deterministic UX parity for code-change visibility and terminal typography without changing unrelated workflows.

### Deliverables
- Renderer: grouped changed-files panel with folder headers and file rows.
- Backend: per-file diff stats exposed from Rust to TS.
- Terminal: bundled Nerd Font asset loaded via CSS and used by xterm config.
- Tests: updated frontend and backend tests covering happy and failure/edge paths.

### Definition of Done (verifiable conditions with commands)
- `pnpm test -- --run src/__tests__/ChangesPane.test.tsx` exits 0 with grouping/stat coverage.
- `cargo test --manifest-path src-tauri/Cargo.toml changes:: -- --nocapture` exits 0 with diff-stat parsing and merge-rule coverage.
- `pnpm build` exits 0 and emits frontend assets including font-face usage.
- `pnpm tauri build` exits 0 and packaged app includes bundled font asset.

### Must Have
- No regressions in existing status badges and error/empty/loading states in `src/components/ChangesPane.tsx`.
- Grouping sorted alphabetically by folder, then filename.
- Root-level files displayed under `(root)` folder group.
- Renamed files grouped by new path and displayed as `old_path -> new_path`.
- Untracked/unsupported numstat rows render only available side; both-zero renders no stat text.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- No full file-explorer tree, collapse persistence, or virtualization.
- No commit/push workflow redesign.
- No Playwright/e2e framework bootstrap in this scope.
- No network-hosted font dependency.
- No per-file git subprocess execution from UI render loops.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after + Vitest (frontend) + Rust unit tests.
- QA policy: every task includes happy and failure/edge QA scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`.

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. Shared contracts first, then independent implementation blocks.

Wave 1: contracts + parsing + test scaffolding (Tasks 1-3)
Wave 2: changed-files UI and style implementation (Tasks 4-6)
Wave 3: terminal font bundling + build verification (Tasks 7-9)

### Dependency Matrix (full, all tasks)
- 1 blocks 2, 4, 5
- 2 blocks 4, 5, 6
- 3 blocks 5
- 4 blocks 6
- 5 blocks 6
- 6 has no downstream blockers
- 7 blocks 8, 9
- 8 blocks 9
- 9 final implementation checkpoint before final verification wave

### Agent Dispatch Summary (wave -> task count -> categories)
- Wave 1 -> 3 tasks -> `quick`, `unspecified-low`
- Wave 2 -> 3 tasks -> `visual-engineering`, `quick`
- Wave 3 -> 3 tasks -> `unspecified-high`, `quick`
- Final Verification -> 4 tasks -> `oracle`, `unspecified-high`, `deep`

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task includes Agent Profile + Parallelization + QA Scenarios.

<!-- TASK DETAILS INSERTED BELOW -->

- [x] 1. Extend changed-file contracts for inline stats

  **What to do**: Update `ChangedFile` contracts to include `additions` and `deletions` as nullable/optional numeric fields in both Rust (`src-tauri/src/changes.rs`) and TypeScript (`src/types.ts`), preserving backward compatibility of command name `get_changed_files`.
  **Must NOT do**: Do not rename existing fields (`path`, `status`, `original_path`) and do not change status enum semantics.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Small, contract-focused change across two type definitions.
  - Skills: `[]` - No specialized skill required.
  - Omitted: `["playwright"]` - No browser automation needed.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2, 4, 5 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/types.ts:31` - Current `ChangedFile` frontend contract.
  - Pattern: `src-tauri/src/changes.rs:19` - Current Rust `ChangedFile` struct.
  - API/Type: `src/hooks/useChanges.ts:17` - Tauri invoke payload relies on this contract.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `pnpm test -- --run src/__tests__/changes.test.ts` exits 0 after contract extension.
  - [ ] `cargo test --manifest-path src-tauri/Cargo.toml changes:: -- --nocapture` exits 0 with updated struct fields.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```text
  Scenario: Contract round-trip includes nullable stats
    Tool: Bash
    Steps: Run `cargo test --manifest-path src-tauri/Cargo.toml changes:: -- --nocapture`
    Expected: Rust tests compile and pass with `ChangedFile { additions, deletions }` included.
    Evidence: .sisyphus/evidence/task-1-contract-roundtrip.txt

  Scenario: Frontend compile safety for new fields
    Tool: Bash
    Steps: Run `pnpm build`
    Expected: TypeScript build succeeds with extended `ChangedFile` type.
    Evidence: .sisyphus/evidence/task-1-frontend-compile.txt
  ```

  **Commit**: NO | Message: `feat(changes): extend changed file contract with line stats` | Files: `src/types.ts`, `src-tauri/src/changes.rs`

- [x] 2. Enrich backend changed-files response with single-pass numstat merge

  **What to do**: In `src-tauri/src/changes.rs`, add one git numstat retrieval path (`git diff --numstat --find-renames --find-copies --`) and merge stats into parsed porcelain entries using normalized keys: path for normal files, destination path for renamed/copied entries. Set both stats to `None` when unavailable (binary/unsupported rows). Use one subprocess call per refresh, never per file.
  **Must NOT do**: Do not execute git commands inside per-entry loops; do not drop files from output when numstat lookup fails.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: Moderate Rust parsing and mapping logic.
  - Skills: `[]` - Existing parser pattern is sufficient.
  - Omitted: `["playwright"]` - Not a UI automation task.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 4, 5, 6 | Blocked By: 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src-tauri/src/changes.rs:42` - Existing git subprocess execution abstraction.
  - Pattern: `src-tauri/src/changes.rs:66` - Porcelain parsing loop to augment with stats.
  - Pattern: `src-tauri/src/changes.rs:92` - Rename/copy original-path handling rules.
  - API/Type: `src-tauri/src/changes.rs:137` - `get_changed_files` command contract.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `cargo test --manifest-path src-tauri/Cargo.toml changes:: -- --nocapture` exits 0 with new numstat parsing tests.
  - [ ] For sample porcelain+numstat fixtures, renamed/untracked/binary mapping matches expected `additions/deletions` values.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```text
  Scenario: Happy-path modified/added/deleted rows carry numeric stats
    Tool: Bash
    Steps: Run `cargo test --manifest-path src-tauri/Cargo.toml changes::parse_porcelain_status_handles_common_entries -- --nocapture` plus new numstat merge test.
    Expected: Tests assert expected non-null additions/deletions per file.
    Evidence: .sisyphus/evidence/task-2-numstat-happy.txt

  Scenario: Failure/edge handling for binary/unmatched rows
    Tool: Bash
    Steps: Run new Rust test covering `-\t-\tpath` and missing numstat key cases.
    Expected: Output retains file entries and sets `additions/deletions` to `None` without panic.
    Evidence: .sisyphus/evidence/task-2-numstat-edge.txt
  ```

  **Commit**: NO | Message: `feat(changes): merge git numstat into changed files` | Files: `src-tauri/src/changes.rs`

- [x] 3. Expand Rust tests for diff-stat merge rules and rename behavior

  **What to do**: Add focused tests in `src-tauri/src/changes.rs` for: rename destination mapping, untracked files (show additions-only when available), binary lines (`-` values), and missing numstat rows. Keep tests in existing module style and mock environment pattern.
  **Must NOT do**: Do not remove existing tests; do not rely on real git repos in tests.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Test-only extension in one file.
  - Skills: `[]` - Existing test scaffold is present.
  - Omitted: `["playwright"]` - Non-UI task.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 5 | Blocked By: 2

  **References** (executor has NO interview context - be exhaustive):
  - Test: `src-tauri/src/changes.rs:159` - Existing Rust test module.
  - Pattern: `src-tauri/src/changes.rs:208` - Common entry parsing assertions.
  - Pattern: `src-tauri/src/changes.rs:241` - Rename assertions baseline.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `cargo test --manifest-path src-tauri/Cargo.toml changes:: -- --nocapture` exits 0 with at least four new edge-case tests.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```text
  Scenario: Happy-path rename and stat association
    Tool: Bash
    Steps: Run targeted rename merge test via `cargo test --manifest-path src-tauri/Cargo.toml rename -- --nocapture`.
    Expected: Test confirms stats attach to destination path and `original_path` remains preserved.
    Evidence: .sisyphus/evidence/task-3-rename-stats.txt

  Scenario: Edge-path binary entry does not break parser
    Tool: Bash
    Steps: Run targeted binary/unmatched numstat test.
    Expected: Parser returns `ChangedFile` with null stats and no error.
    Evidence: .sisyphus/evidence/task-3-binary-edge.txt
  ```

  **Commit**: NO | Message: `test(changes): cover numstat merge edge cases` | Files: `src-tauri/src/changes.rs`

- [x] 4. Build grouped-folder view model in ChangesPane

  **What to do**: In `src/components/ChangesPane.tsx`, derive a memoized grouped model from `changedFiles` by splitting each file path at `/`: first segment is folder key, no slash maps to `(root)`. Within each folder, sort by display filename ascending. Folder groups are sorted alphabetically with `(root)` first.
  **Must NOT do**: Do not mutate `changedFiles` state directly; do not convert to recursive tree.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: UI data-model shaping tied to rendering structure.
  - Skills: `[]` - Existing React patterns are enough.
  - Omitted: `["playwright"]` - No e2e harness in scope.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 6 | Blocked By: 1, 2

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/components/ChangesPane.tsx:30` - Existing local state and loading lifecycle.
  - Pattern: `src/components/ChangesPane.tsx:144` - Current list rendering loop to replace.
  - API/Type: `src/types.ts:31` - `ChangedFile` source fields used for grouping.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `pnpm test -- --run src/__tests__/ChangesPane.test.tsx` includes passing assertions for folder group headers and sorted file rows.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```text
  Scenario: Happy path grouped rendering
    Tool: Bash
    Steps: Run `pnpm test -- --run src/__tests__/ChangesPane.test.tsx` with fixture paths in nested and root folders.
    Expected: Test output confirms `(root)` appears first, then folder names, with files sorted inside groups.
    Evidence: .sisyphus/evidence/task-4-grouping-happy.txt

  Scenario: Edge path handles empty/clean result safely
    Tool: Bash
    Steps: Run existing clean-status test path plus grouped model test with empty array.
    Expected: No group headers rendered; clean-status message remains.
    Evidence: .sisyphus/evidence/task-4-grouping-empty.txt
  ```

  **Commit**: NO | Message: `feat(changes): derive grouped folder model for changed files` | Files: `src/components/ChangesPane.tsx`

- [x] 5. Render inline `+A -D` stats and rename text formatting

  **What to do**: Update `src/components/ChangesPane.tsx` row UI to show per-file stats on the right side: additions in green (`+N`), deletions in red (`-N`), hide each side when value is `0` or `null`, and hide whole stat block if both sides hidden. For renamed entries, render `original_path -> path`. Keep existing status-letter badge behavior.
  **Must NOT do**: Do not show `+0`/`-0`; do not remove status badge or existing hover/selection affordances.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: Visual row composition and conditional display logic.
  - Skills: `[]` - No extra skill needed.
  - Omitted: `["frontend-ui-ux"]` - Existing design language should be preserved, not redesigned.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 6 | Blocked By: 1, 2, 3, 4

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/components/ChangesPane.tsx:146` - Existing status color mapping.
  - Pattern: `src/components/ChangesPane.tsx:163` - Badge typography/spacing baseline.
  - Pattern: `src/styles/layout.css:3` - Theme tokens for green/red/text classes.
  - API/Type: `src/types.ts:31` - New `additions/deletions` fields from Task 1.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `pnpm test -- --run src/__tests__/ChangesPane.test.tsx` passes assertions for `+21`, `+38 -25`, and hidden-zero behavior.
  - [ ] Renamed fixture renders `old-name -> new-name` while preserving status badge `R`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```text
  Scenario: Happy path mixed stat display
    Tool: Bash
    Steps: Run `pnpm test -- --run src/__tests__/ChangesPane.test.tsx` with fixtures: {+21,0}, {+38,-25}, {0,-7}.
    Expected: Rendered text shows `+21`, `+38 -25`, `-7` with no zero-side tokens.
    Evidence: .sisyphus/evidence/task-5-inline-stats-happy.txt

  Scenario: Edge path both sides hidden
    Tool: Bash
    Steps: Run fixture where additions=0 and deletions=0 or both null.
    Expected: Stat container is absent while filename/status still render.
    Evidence: .sisyphus/evidence/task-5-inline-stats-edge.txt
  ```

  **Commit**: NO | Message: `feat(changes): add inline diff stats and rename display` | Files: `src/components/ChangesPane.tsx`

- [x] 6. Update frontend tests for grouped rendering and stat formatting

  **What to do**: Extend `src/__tests__/ChangesPane.test.tsx` (and add companion test file only if needed) to cover grouped folders, `(root)` bucket ordering, rename text rendering, and hidden-zero stat rules. Keep mocking through `@tauri-apps/api/core` invoke.
  **Must NOT do**: Do not replace Vitest framework or add flaky timing-based assertions.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Test adaptation in existing suite.
  - Skills: `[]` - Existing patterns are clear.
  - Omitted: `["playwright"]` - No Playwright in repo.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: none | Blocked By: 4, 5

  **References** (executor has NO interview context - be exhaustive):
  - Test: `src/__tests__/ChangesPane.test.tsx:23` - Existing backend-data render test.
  - Pattern: `src/__tests__/ChangesPane.test.tsx:24` - `invoke` mocking pattern.
  - Config: `vitest.config.ts:3` - Test environment and runner context.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `pnpm test -- --run src/__tests__/ChangesPane.test.tsx` exits 0 with new coverage for grouping and inline stats.
  - [ ] `pnpm test` exits 0 for full frontend test suite.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```text
  Scenario: Happy path regression suite remains green
    Tool: Bash
    Steps: Run `pnpm test -- --run src/__tests__/ChangesPane.test.tsx` then `pnpm test`.
    Expected: Both commands exit 0; no snapshot or query failures.
    Evidence: .sisyphus/evidence/task-6-frontend-tests-happy.txt

  Scenario: Edge path API error state unaffected
    Tool: Bash
    Steps: Add/execute test where mocked invoke rejects.
    Expected: Alert block with `Git status failed` still appears.
    Evidence: .sisyphus/evidence/task-6-error-state-edge.txt
  ```

  **Commit**: NO | Message: `test(changes): verify grouped view and inline stat rules` | Files: `src/__tests__/ChangesPane.test.tsx`

- [x] 7. Bundle a deterministic Nerd Font asset for production

  **What to do**: Add one approved Nerd Font file (`JetBrainsMonoNerdFontMono-Regular.ttf`) under `src/assets/fonts/` and declare `@font-face` in `src/styles/layout.css` with family name `VibetreeNerdMono`. Keep local URL import so Vite bundles it into production assets.
  **Must NOT do**: Do not fetch fonts from CDN; do not bundle multiple variants in this scope.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Asset packaging and build-output determinism.
  - Skills: `[]` - No special skill required.
  - Omitted: `["frontend-ui-ux"]` - This is packaging, not redesign.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 8, 9 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/styles/layout.css:1` - Global CSS entry loaded by app.
  - Pattern: `src/main.tsx` - Ensure CSS import path remains active.
  - Config: `package.json:8` - Build pipeline (`tsc && vite build`) that must emit font asset.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `pnpm build` exits 0 and generated `dist/assets` includes emitted `.ttf` or inlined font reference traceable to `VibetreeNerdMono`.
  - [ ] `grep -R "VibetreeNerdMono" dist` returns at least one match.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```text
  Scenario: Happy path font asset emitted
    Tool: Bash
    Steps: Run `pnpm build` then list `dist/assets` and search built CSS/JS for `VibetreeNerdMono`.
    Expected: Build succeeds and bundled assets contain the font-family declaration and asset reference.
    Evidence: .sisyphus/evidence/task-7-font-bundle-happy.txt

  Scenario: Edge path missing font file fails fast
    Tool: Bash
    Steps: Run `grep -R "__NON_EXISTENT_FONT_TOKEN__" dist` after `pnpm build`.
    Expected: Command exits non-zero, proving missing-font checks fail loudly when target token is absent.
    Evidence: .sisyphus/evidence/task-7-font-bundle-edge.txt
  ```

  **Commit**: NO | Message: `build(terminal): bundle nerd mono font asset` | Files: `src/assets/fonts/*`, `src/styles/layout.css`

- [x] 8. Force xterm to prefer bundled font and wait for font readiness

  **What to do**: Update `src/components/TerminalInstance.tsx` to place `VibetreeNerdMono` first in `fontFamily` and gate terminal initialization until `document.fonts.load("13px VibetreeNerdMono")` resolves (with timeout fallback to avoid hangs). Keep existing fallback chain after bundled family.
  **Must NOT do**: Do not remove existing fallback fonts; do not block terminal forever if font loading fails.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Focused component logic update.
  - Skills: `[]` - Existing hook/effect structure is sufficient.
  - Omitted: `["playwright"]` - Validated via tests/build logs.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 9 | Blocked By: 7

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/components/TerminalInstance.tsx:22` - Terminal constructor options.
  - Pattern: `src/components/TerminalInstance.tsx:29` - Existing font stack.
  - Pattern: `src/components/TerminalInstance.tsx:19` - Effect lifecycle and teardown.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `pnpm test -- --run src/__tests__/TerminalPane.test.tsx` exits 0.
  - [ ] Terminal initialization path remains functional when font load succeeds and when it times out/fails.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```text
  Scenario: Happy path bundled font preferred
    Tool: Bash
    Steps: Run targeted terminal component test(s) mocking `document.fonts.load` resolve.
    Expected: Terminal options include `VibetreeNerdMono` as first family and init proceeds.
    Evidence: .sisyphus/evidence/task-8-font-ready-happy.txt

  Scenario: Edge path font load rejection fallback
    Tool: Bash
    Steps: Run test mocking `document.fonts.load` rejection/timeout.
    Expected: Terminal still initializes using fallback chain without uncaught error.
    Evidence: .sisyphus/evidence/task-8-font-ready-edge.txt
  ```

  **Commit**: NO | Message: `fix(terminal): prefer bundled font with safe readiness gate` | Files: `src/components/TerminalInstance.tsx`

- [x] 9. Add production parity verification script for Tauri bundle artifacts

  **What to do**: Add deterministic verification script at `scripts/verify-terminal-font-parity.mjs` and wire `package.json` script `verify:terminal-font-parity`. Script must assert packaged output contains bundled font asset and compiled frontend contains `VibetreeNerdMono` references. Run `pnpm tauri build` then `pnpm verify:terminal-font-parity` and capture evidence.
  **Must NOT do**: Do not add CI platform migration in this scope.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Release artifact validation across frontend+Tauri packaging.
  - Skills: `[]` - Command-level verification only.
  - Omitted: `["git-master"]` - No git history task.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: none | Blocked By: 7, 8

  **References** (executor has NO interview context - be exhaustive):
  - Config: `src-tauri/tauri.conf.json:6` - Build hooks and frontendDist linkage.
  - Pattern: `src/components/TerminalInstance.tsx:29` - Font family target to confirm in dist output.
  - Build output root: `src-tauri/target/release/bundle` - Packaged artifacts location.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `pnpm tauri build` exits 0.
  - [ ] `pnpm verify:terminal-font-parity` exits 0 and prints positive checks for both packaged font asset and built bundle font-family reference.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```text
  Scenario: Happy path production package includes bundled font
    Tool: Bash
    Steps: Run `pnpm tauri build` then `pnpm verify:terminal-font-parity`.
    Expected: Both commands exit 0; verifier reports found font asset and `VibetreeNerdMono` reference.
    Evidence: .sisyphus/evidence/task-9-prod-parity-happy.txt

  Scenario: Edge path missing reference detection
    Tool: Bash
    Steps: Run `node scripts/verify-terminal-font-parity.mjs --expect-token __NON_EXISTENT_FONT_TOKEN__`.
    Expected: Script exits non-zero with explicit missing-reference error.
    Evidence: .sisyphus/evidence/task-9-prod-parity-edge.txt
  ```

  **Commit**: NO | Message: `chore(release): add terminal font parity artifact verification` | Files: `scripts/verify-terminal-font-parity.mjs`, `package.json`

## Final Verification Wave (4 parallel agents, ALL must APPROVE)
- [x] F1. Plan Compliance Audit - oracle
- [x] F2. Code Quality Review - unspecified-high
- [x] F3. Real Manual QA - unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check - deep

## Commit Strategy
- Commit 1: `feat(changes): add grouped changed-files view with inline diff stats`
- Commit 2: `fix(terminal): bundle nerd font for deterministic prod rendering`
- Commit 3: `test(changes-terminal): cover diff-stat and font-loading edge cases`

## Success Criteria
- Changed-files panel visually matches requested grouped structure and inline stat behavior.
- Production bundle renders terminal with bundled Nerd Font without relying on host installation.
- All listed verification commands pass in CI-equivalent local execution.
