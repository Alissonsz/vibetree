# Learnings

## Task 1: Extend changed-file contracts for inline stats

### Implementation Notes
- Added `additions: number | null` and `deletions: number | null` to `ChangedFile` type in both TypeScript and Rust
- Used `Option<i64>` in Rust for nullable integers (i64 chosen over i32 for consistency with git numstat output)
- Fields default to `None`/`null` in current implementation - backward compatible
- No changes to `get_changed_files` command name or existing `path/status/original_path` semantics

### Verification Results
- TypeScript tests: PASSED
- Rust tests: PASSED  
- pnpm build: PASSED

## Task 2: Enrich backend changed-files response with single-pass numstat merge

### Implementation Notes
- Added `git_diff_numstat` method to `ChangesEnvironment` trait for testability
- Implemented `parse_numstat` function to parse git diff --numstat output (format: additions\tdeletions\tpath)
- Implemented `merge_numstat_into_files` function to merge stats using destination path as key
- Binary files show "-" in numstat output, which is parsed as None for both additions and deletions
- Single subprocess call per refresh: git diff --numstat --find-renames --find-copies --
- Merge logic uses destination path (path field) for renamed/copied files - this is the key numstat uses
- Untracked files are not in numstat output, so they retain None for stats (expected behavior)

### Key Design Decisions
- Used HashMap for O(1) lookup when merging stats into porcelain entries
- Normalized key is the file path (destination path for renames/copies)
- Stats remain None when: numstat lookup fails, file is untracked, or binary file

### Verification Results
- Rust tests: 11 tests PASSED (including new tests for numstat parsing, merge logic, and edge cases)
- pnpm build: PASSED

### QA Fix Applied
- Changed `git diff --numstat` to `git diff HEAD --numstat` to capture both staged and unstaged tracked changes
- Porcelain status includes staged changes, but original numstat command only captured unstaged
- Single subprocess call maintained (just added HEAD reference)

## Task 3: Expand Rust tests for diff-stat merge rules and rename behavior

### Implementation Notes
- Added 5 new test functions to cover edge cases not explicitly tested before:
  1. `parse_numstat_handles_additions_only` - Tests parsing of "10\t-\tfile" (additions with "-" for deletions)
  2. `parse_numstat_handles_zero_deletions` - Tests parsing of "10\t0\tfile" (additions with zero deletions)
  3. `parse_numstat_skips_malformed_lines` - Tests that lines with <3 tab-separated parts are skipped
  4. `merge_numstat_with_additions_only_stats` - Tests merge when numstat has (Some, None) tuple
  5. `merge_numstat_with_rename_destination_key` - Tests rename lookup uses destination path, with partial numstat coverage

### Edge Cases Covered
- Additions-only tuples: `Some(i64), None` when git outputs "-" for deletions
- Zero deletions: `Some(i64), Some(0)` - distinct from "-" (binary/untracked)
- Malformed numstat: Lines with 1 or 2 parts are silently skipped (existing behavior)
- Missing numstat rows: Tests that renamed files without numstat entries retain None stats
- Rename destination key: Explicitly verifies lookup uses new path, not original_path

### Verification Results
- Rust tests: 16 tests PASSED (11 existing + 5 new)
- pnpm build: PASSED

## Task 4: Build grouped-folder view model in ChangesPane

### Implementation Notes
- Derived a memoized grouped view model from `changedFiles` via `useMemo` in `src/components/ChangesPane.tsx`
- Group key is the first path segment before "/"; files with no slash are grouped under `(root)`
- Deterministic ordering: `(root)` group first, then folder groups alphabetically; files within each group sorted by full display path
- Preserved existing load/error/empty UI branches and status-letter badge logic; kept `changed-file-list` and `changed-file-item` test ids on rendered output

### Verification Results
- pnpm test -- --run src/__tests__/ChangesPane.test.tsx: PASSED
- pnpm build: PASSED

## Task 6: Fix ChangesPane test isolation and grouped assertions

### Implementation Notes
- Added explicit `cleanup()` in `afterEach` to ensure DOM isolation between tests.
- Tightened grouped-folder assertions to use the `aria-label="Folder ..."` headings (deterministic order) instead of broad text matching.
- Scoped stats assertions to the specific file row to avoid false positives and to keep hidden-zero/null behavior covered.

### Verification Results
- pnpm test -- --run src/__tests__/ChangesPane.test.tsx: PASSED
- pnpm test: PASSED
- pnpm build: PASSED

## Task 5: Render inline +A -D stats and rename text formatting

### Implementation Notes
- Rendered an inline stat block on the right side of each file row in `src/components/ChangesPane.tsx`.
- Additions render as green `+N`; deletions render as red `-N`.
- Each token is hidden when its value is `0` or `null`; the entire stat block is hidden when both tokens are hidden.
- Renamed entries render as `original_path -> path` when `status === "Renamed"` and `original_path` is present.
- Kept row layout stable by making the left content `min-w-0` (so the filename truncates) and the stats `shrink-0` (so they do not wrap).

### Verification Results
- pnpm test -- --run src/__tests__/ChangesPane.test.tsx: PASSED
- pnpm build: PASSED

## Task 6: Update frontend tests for grouped rendering and stat formatting

### Implementation Notes
- Expanded `src/__tests__/ChangesPane.test.tsx` from 1 test to 14 tests
- Added tests for grouped rendering: (root) group first, folder groups alphabetical, files sorted within groups
- Added tests for stat visibility rules:
  - Show additions when > 0, hide when 0 or null
  - Show deletions when > 0, hide when 0 or null
  - Hide entire stats block when both additions and deletions are hidden
- Added test for rename display: "old-name -> new-name" when status is "Renamed"
- Added test for error alert: "Git status failed" when invoke is rejected
- Used `mockImplementation` instead of `mockResolvedValue` to ensure consistent return values across multiple invocations (React Strict Mode can trigger multiple renders)
- Used `cleanup()` in `afterEach` to properly clean up DOM between tests
- Used `getAllByLabelText(/Folder/)` instead of regex on `getAllByText` for more reliable group heading selection

### Test Coverage
- Basic rendering: 1 test
- Grouped rendering: 2 tests ((root) first + alphabetical folder order)
- Stat formatting: 6 tests (additions only, deletions only, both, hidden zeros, hidden nulls, hidden block)
- Rename display: 1 test
- Error handling: 1 test (rejected invoke)
- Edge cases: 3 tests (clean status, loading state)

### Verification Results
- pnpm test -- --run src/__tests__/ChangesPane.test.tsx: PASSED (14 tests)
- pnpm test: PASSED (22 tests total)
- pnpm build: PASSED

## Task 7: Bundle a deterministic Nerd Font asset for production

### Implementation Notes
- `src/styles/layout.css` is imported by `src/main.tsx`, so adding `@font-face` there would be active at runtime without extra wiring.
- Required source asset `JetBrainsMonoNerdFontMono-Regular.ttf` is not present in this repository or sibling local project paths searched (`/Users/alisson/Desktop/personal`).
- `src/assets/` does not currently exist, so the font file cannot be staged from local project assets without the missing binary.

### Retry Completion Notes
- Retrieved `JetBrainsMonoNerdFontMono-Regular.ttf` from the official Nerd Fonts GitHub release artifact (`JetBrainsMono.zip`) and extracted only the required mono regular file.
- Added a minimal `@font-face` block in `src/styles/layout.css` with family `VibetreeNerdMono` and a relative local URL (`../assets/fonts/JetBrainsMonoNerdFontMono-Regular.ttf`) so Vite emits a hashed font asset.

### Verification Results
- pnpm build: PASSED
- Dist contains `VibetreeNerdMono` token in built CSS and emitted font artifact `dist/assets/JetBrainsMonoNerdFontMono-Regular-*.ttf`.

## Task 8: Force xterm to prefer bundled font and wait for font readiness

### Implementation Notes
- Added `VibetreeNerdMono` as first font in xterm `fontFamily` chain, preserving existing fallbacks.
- Implemented `waitForFont()` function that uses `document.fonts.check()` for immediate resolution if already loaded, otherwise waits for `document.fonts.load()` promise.
- Added 2-second timeout fallback: if font doesn't load within timeout, terminal still initializes (non-blocking).
- Wrapped terminal initialization in async `initTerminal()` function to await font readiness before creating Terminal instance.
- Added `isMounted` flag to prevent terminal creation if component unmounts during font load wait.
- Properly moved cleanup logic outside the async function to ensure cleanup runs on effect cleanup.

### Verification Results
- pnpm test -- --run src/__tests__/TerminalPane.test.tsx: PASSED
- pnpm test: PASSED (22 tests)
- pnpm build: PASSED

## Task 9: Add production parity verification script for Tauri bundle artifacts

### Implementation Notes
- Added deterministic verifier script at `scripts/verify-terminal-font-parity.mjs` with strict CLI options (`--bundle-root`, `--dist-assets-root`, `--expect-font`, `--expect-token`).
- Verification checks both dimensions: (1) emitted font artifact path contains `JetBrainsMonoNerdFontMono-Regular` across build outputs, (2) compiled frontend text assets include `VibetreeNerdMono` token.
- Added npm script `verify:terminal-font-parity` in `package.json` to standardize the check.

### Verification Results
- pnpm tauri build: PASSED
- pnpm verify:terminal-font-parity: PASSED
- node scripts/verify-terminal-font-parity.mjs --expect-token __NON_EXISTENT_FONT_TOKEN__: FAILED as expected (non-zero exit)

## Task F4: Scope Fidelity Check - deep

### Request-to-Implementation Mapping
- Request 1 (grouped changed-files + inline `+A -D` with hidden zero sides): implemented in `src/components/ChangesPane.tsx`, backed by nullable stats in `src/types.ts` and `src-tauri/src/changes.rs`, and covered by expanded `src/__tests__/ChangesPane.test.tsx` assertions.
- Request 2 (production terminal typography parity via bundled Nerd Font): implemented with bundled `src/assets/fonts/JetBrainsMonoNerdFontMono-Regular.ttf`, `@font-face` in `src/styles/layout.css`, preferred xterm family + font readiness gate in `src/components/TerminalInstance.tsx`, plus artifact verifier script wired in `package.json`.

### Fidelity Findings
- Functional intent is satisfied for both requests based on code inspection and command verification (`pnpm test -- --run src/__tests__/ChangesPane.test.tsx`, `cargo test --manifest-path src-tauri/Cargo.toml changes:: -- --nocapture`, `pnpm build`, `pnpm verify:terminal-font-parity`).
- Scope drift detected: `src-tauri/tauri.conf.json` changed bundle targets from `"all"` to `["app"]`, which is not explicitly required by the user request/plan and can alter release packaging scope.
- Verification gap detected: there is no direct test coverage exercising `TerminalInstance` font-load success/failure paths because `src/__tests__/TerminalPane.test.tsx` mocks `TerminalInstance`.

### Verdict
- Final fidelity verdict: **partially faithful** (core intent delivered, but one non-requested packaging-scope change and one explicit test-coverage gap against plan acceptance expectations).


## Task F3: Real Manual QA - grouped changed-files + terminal parity

### Implementation Notes
- Manual browser QA can run in two layers: (1) raw browser mode to identify Tauri bridge blockers, and (2) Playwright init-script Tauri shim to exercise user-facing panes end-to-end.
- Group heading order and inline stat tokens are directly observable via accessibility snapshot (`Folder (root)`, `Folder scripts`, `Folder src`) and row token extraction (`+2/-1`, `+120`, `+25/-10`, `+5/-3`, `-4`).
- Terminal readiness gate can be sanity-checked in browser automation by waiting for `.xterm-helper-textarea` attachment after page load (observed at ~65ms in shimmed run), which indicates terminal initialization does not hang while awaiting font readiness.

### Verification Results
- pnpm test: PASSED (22 tests)
- pnpm build: PASSED
- pnpm verify:terminal-font-parity: PASSED
- Playwright manual QA: PASS for grouped headings, inline stat visibility behavior, rename display, and terminal init non-hang under shimmed interactive run

## Task: Fix backend compliance gap - numstat rename normalization and graceful fallback

### Implementation Notes
- Added `normalize_numstat_path` helper function to handle git's rename syntax in numstat output (`old -> new`)
- Updated `parse_numstat` to normalize path keys before inserting into HashMap
- Modified `get_changed_files_for_path_with_environment` to gracefully handle numstat command failures by using empty HashMap (files retain None stats)
- Added 4 new tests: `parse_numstat_handles_rename_syntax`, `parse_numstat_handles_copy_syntax`, `get_changed_files_returns_files_when_numstat_fails`, `get_changed_files_merges_stats_when_numstat_succeeds`
- Added `with_git_numstat_error` method to MockChangesEnvironment for testing error paths

### Key Design Decisions
- Normalization extracts destination path (after " -> ") for consistent merge key lookup
- Numstat failure is non-fatal: function returns porcelain entries with None stats instead of error
- Single subprocess pattern preserved (no per-file git commands)

### Verification Results
- Rust tests: 20 tests PASSED (16 existing + 4 new)
- cargo test --manifest-path src-tauri/Cargo.toml changes:: -- --nocapture: PASSED

### Fix Applied
- Corrected `normalize_numstat_path` to handle real git output format ` => ` (not ` -> `)
- Updated tests to use actual observed format `old.txt => new.txt`
- All 20 tests pass

## Task 8 (Verification Gap): Add direct tests for TerminalInstance font readiness behavior

### Implementation Notes
- Created new test file `src/__tests__/TerminalInstance.test.tsx` with 5 focused tests
- Mocked `@xterm/xterm` Terminal class and `@xterm/addon-fit` FitAddon to avoid canvas dependency issues
- Implemented custom `MockFonts` class to simulate `document.fonts` API behavior
- Tests cover all font readiness paths:
  1. Font already loaded (`document.fonts.check` returns true) - immediate resolution
  2. Font load resolves successfully - terminal initializes after promise resolves
  3. Font load rejects - terminal still initializes (graceful fallback)
  4. Font load times out (2 second timeout) - terminal still initializes (non-blocking)
  5. Font family verification - confirms `fontFamily` starts with `VibetreeNerdMono`

### Key Design Decisions
- Used `cleanup()` from `@testing-library/react` in `afterEach` to ensure DOM isolation between tests
- For timeout test, used `vi.useFakeTimers()` / `vi.advanceTimersByTime()` / `vi.useRealTimers()` pattern to simulate 2-second timeout
- For rejection test, used `vi.spyOn(document.fonts, 'load')` to inject custom promise that can be rejected
- Used `waitFor` with `getByTestId` to wait for async terminal initialization

### Verification Results
- pnpm test -- --run src/__tests__/TerminalInstance.test.tsx: PASSED (5 tests)
- pnpm test: PASSED (27 tests total - 22 existing + 5 new)
- pnpm build: PASSED

### Fix Applied (Async Timing)
- Initial tests failed because assertions ran before async terminal initialization completed
- Fixed by wrapping assertions in `waitFor` to properly wait for async React effects to settle
- For timeout case: used `vi.advanceTimersByTime(2100)` before `waitFor` to trigger timeout, then `waitFor` to wait for init
- All 5 tests now pass with proper async waiting

## Scope Drift Correction

### Implementation Notes
- Reverted `bundle.targets` in `src-tauri/tauri.conf.json` from `["app"]` back to `"all"`
- This change was not part of the requested feature scope and was identified during fidelity check
- Build verification passed after revert

## Task 9 (Strengthened): Strict packaged bundle check for font parity verifier

### Implementation Notes
- Modified `scripts/verify-terminal-font-parity.mjs` to check ONLY bundle artifacts for font presence, not dist fallback
- Previously: script checked combined `artifactFiles = [...bundleFiles, ...distFiles]` which allowed dist-only font to pass
- Now: script checks `bundleFiles` first for loose `.ttf` file, then falls back to binary content scan for macOS embedded font case
- Binary scan searches for font token in common binary files (app bundles, executables) to support macOS `.app` layout where font may be embedded in binary
- Dist assets check remains separate for token verification

### Key Design Decisions
- Packaged check uses bundle-root artifact scan only (file name or binary content marker)
- Supports both loose `.ttf` files and embedded fonts in binaries (macOS `.app` layout)
- Error messages are deterministic and explicit about which check failed
- Preserved existing CLI options behavior (`--bundle-root`, `--dist-assets-root`, `--expect-font`, `--expect-token`)

### Verification Results
- pnpm verify:terminal-font-parity: PASSED (font found in binary: `vibetree.app/Contents/MacOS/vibetree`)
- node scripts/verify-terminal-font-parity.mjs --expect-token __NON_EXISTENT_FONT_TOKEN__: FAILED as expected (non-zero exit)
- node scripts/verify-terminal-font-parity.mjs --expect-font __NON_EXISTENT_FONT__: FAILED as expected (non-zero exit)
- lsp_diagnostics: No errors
