# Issues

## Task 1: Extend changed-file contracts for inline stats

### No issues encountered
- Contract extension was straightforward
- Backward compatibility maintained by using nullable fields
- All tests pass without modification to test logic (only struct field additions needed)

## Task 2: Enrich backend changed-files response with single-pass numstat merge

### No issues encountered
- Single-pass merge architecture works correctly
- Test environment abstraction allows mocking both git status and numstat
- Edge cases (binary files, untracked files, renamed files) handled correctly
- All 11 tests pass including new edge case tests

## Task 3: Expand Rust tests for diff-stat merge rules and rename behavior

### No issues encountered
- All 5 new tests pass
- Existing test coverage was already solid; new tests validate edge cases explicitly
- No production logic changes - pure test additions

## Task 4: Build grouped-folder view model in ChangesPane

### Notes
- No functional issues encountered; grouping is deterministic and memoized.
- Test run logs include a jsdom canvas "Not implemented" stderr from xterm usage, but the test suite still passes.

## Task 5: Render inline +A -D stats and rename text formatting

### Notes
- No functional issues encountered.
- Test run logs still include the jsdom canvas "Not implemented" stderr from xterm usage, but the test suite still passes.

## Task 6: Fix ChangesPane test isolation and grouped assertions

### Notes
- Fix was limited to `src/__tests__/ChangesPane.test.tsx` (no production code changes).
- Tests were failing in some environments due to accumulated DOM; adding explicit `cleanup()` in `afterEach` fixed isolation.
- Group heading assertions now target the `aria-label="Folder ..."` headings for deterministic ordering.

## Task 6: Update frontend tests for grouped rendering and stat formatting

### Issues Encountered
1. **Mock state leaking between tests**: Initial tests failed because the mock was returning data from previous tests. This was due to React Strict Mode rendering components twice and the mock not being properly reset between tests.
   - Solution: Added `cleanup()` from `@testing-library/react` in `afterEach` to clean up DOM, and used `mockImplementation` instead of `mockResolvedValue` to ensure consistent return values.

2. **Regex matching too broad**: The initial test used `getAllByText(/^\(root\)$|^[a-z]+$/)` which matched more elements than expected (3 instead of 2).
   - Solution: Changed to use `getAllByLabelText(/Folder/)` which is more specific and matches the aria-label on group headings.

3. **Mock being called before implementation set**: The mock needed to be set up before rendering the component to ensure the correct data was returned on the first call.
   - Solution: Set up `mockImplementation` before calling `render()` in each test.

## Task 7: Bundle a deterministic Nerd Font asset for production

### Issues Encountered
1. **Required binary font missing**: `JetBrainsMonoNerdFontMono-Regular.ttf` is not available in the repo or discoverable local project assets, so the exact approved file cannot be copied into `src/assets/fonts/`.
   - Impact: Cannot safely add `@font-face` local URL without introducing a broken asset reference or substituting a different font file.

### Retry Notes
- No new runtime/build issues encountered after pulling the official release artifact.
- LSP diagnostics via Biome report a CSS parse error on Tailwind-specific syntax (`@theme`) in `src/styles/layout.css`; this is pre-existing project syntax support mismatch rather than a regression from the task change.

## Task 8: Force xterm to prefer bundled font and wait for font readiness

### Notes
- No issues encountered during implementation.
- Test suite passes without modification because `TerminalPane.test.tsx` mocks the entire `TerminalInstance` component, so the font loading logic runs in the actual component but isn't exercised by the test.
- The jsdom canvas stderr warning persists but does not affect test results (pre-existing).

## Task 9: Add production parity verification script for Tauri bundle artifacts

### Issues Encountered
1. **Bundle layout on macOS does not expose loose `.ttf` files under `.app`**: `src-tauri/target/release/bundle/macos/vibetree.app` contains only executable/plist paths, so strict bundle-only `.ttf` lookup falsely failed.
   - Solution: Verify emitted font artifact presence across generated production artifacts (`bundle` + `dist/assets`) and keep token validation strictly in built frontend assets.


## Task F3: Real Manual QA - grouped changed-files + terminal parity

### Issues Encountered
1. **Native Tauri APIs unavailable in plain browser mode**: Clicking `+ New Workspace` in unshimmed `pnpm dev` browser run throws `Cannot read properties of undefined (reading 'invoke')` from `@tauri-apps/plugin-dialog`.
   - Impact: true native-workspace selection cannot be executed directly in browser-only Playwright session.
   - Mitigation: Injected a Playwright init-script shim for `window.__TAURI_INTERNALS__` + event internals to emulate required invoke/listen commands and continue user-flow QA coverage.
2. **Non-blocking asset noise**: Missing `favicon.ico` generates a single 404 console error during browser runs.
   - Impact: cosmetic only; did not block changed-files or terminal flow validation.

## Task: Fix backend compliance gap - numstat rename normalization and graceful fallback

### No issues encountered
- Implementation was straightforward with clear requirements
- All 4 new tests pass
- Existing tests continue to pass (20 total)
- No changes to external API contract

### Fix Applied
- QA caught that git uses ` => ` not ` -> ` for rename syntax
- Updated normalize_numstat_path to handle correct format
- Tests updated to match real git output

## Task F2: Fix brace rename format in numstat path normalization

### Issues Encountered
1. **Git brace rename format not handled**: The original `normalize_numstat_path` used `find(" => ")` which finds the FIRST occurrence. For brace rename format like `src/{old => new}.rs`, this incorrectly extracted `new}.rs` instead of `src/new.rs`.

### Fix Applied
- Updated `normalize_numstat_path` to detect brace rename format (paths containing `{`)
- For brace format: extract prefix (before `{`), destination name (after ` => `), and suffix (after `}`) and recombine
- For plain rename: use `rfind` to get the last ` => ` (handles paths with multiple renames)
- Added 5 new tests for brace rename cases (simple, nested path, deep path, multiple, mixed with plain)
- All 25 tests pass
