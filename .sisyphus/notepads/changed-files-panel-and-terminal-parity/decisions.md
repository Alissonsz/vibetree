# Decisions

## Task 1: Extend changed-file contracts for inline stats

### Field Types
- **TypeScript**: `number | null` - standard JS nullable number
- **Rust**: `Option<i64>` - i64 chosen over i32 for git numstat compatibility (git uses signed integers for additions/deletions)

### Backward Compatibility Strategy
- Made fields nullable/optional so existing code without explicit stats remains valid
- Default value is `None`/`null` when not populated by git numstat parsing

### Future Considerations
- Next task (numstat parsing) will populate these fields from git --numstat output
- Downstream UI components can safely consume these fields with null checks

## Task 2: Enrich backend changed-files response with single-pass numstat merge

### Numstat Command Selection
- **Command**: `git diff --numstat --find-renames --find-copies --`
- **Rationale**: This gives us per-file line change stats for tracked files
- `--find-renames` and `--find-copies` ensure renamed/copied files appear with their new paths in output

### Merge Strategy
- **Key**: Destination path (the `path` field in ChangedFile) - this matches what git diff --numstat outputs for renamed/copied files
- **Data structure**: HashMap<String, (Option<i64>, Option<i64>)> for O(1) lookups
- **Fallback**: Files without numstat entries retain None for stats

### Edge Case Handling
- **Binary files**: numstat outputs "-" for both additions and deletions -> parsed as None
- **Untracked files**: not in git diff output -> stats remain None
- **Missing entries**: numstat lookup fails -> stats remain None (no panic)

### Performance Consideration
- Single subprocess call per refresh (not per file)
- HashMap lookup is O(1) per file during merge

## Task 3: Expand Rust tests for diff-stat merge rules and rename behavior

### Test Coverage Strategy
- Focused on edge cases not explicitly tested in existing test suite
- Used existing test patterns and naming conventions (snake_case, descriptive names)
- MockChangesEnvironment already supports both git_status and git_numstat mocking

### Edge Case Test Design
- **Additions-only**: Git outputs "-" for deletions in certain scenarios (binary-like, additions-only)
- **Zero vs None**: "0" is a valid number (Some(0)), "-" is None - these are distinct
- **Malformed lines**: Parser silently skips lines with != 3 parts (existing behavior, now tested)
- **Partial numstat**: Not all renamed files may have numstat entries - verify None handling

## Task 4: Build grouped-folder view model in ChangesPane

### Grouping Rules
- Group by the first segment of `file.path` (prefix before the first "/"); paths without "/" are placed in `(root)`.
- Rendering uses one `changed-file-list` container with group headers inserted as non-testid list items; individual file rows retain `changed-file-item`.

### Ordering Rules
- `(root)` group renders first when present.
- Folder groups render alphabetically by folder name.
- Files render alphabetically by full display path (`file.path`) within each group for stable UX and test assertions.

## Task 5: Render inline +A -D stats and rename text formatting

### Stat Rendering Rules
- Show stats as inline tokens on the right side of the file row, in deterministic order: additions first, deletions second.
- Hide a token when its value is `0` or `null`; hide the full stat block when both tokens are hidden.

### Rename Display Rule
- For `status === "Renamed"` with a non-null `original_path`, render the filename text as `original_path -> path`.

## Task 6: Fix ChangesPane test isolation and grouped assertions

### Test Isolation
- Use explicit `cleanup()` in `afterEach` rather than relying on global test-environment defaults.

### Group Heading Assertions
- Assert group ordering via `aria-label="Folder <label>"` nodes to avoid matching unrelated text and to reflect the rendered output.

### Stats Assertions
- Scope `+N` / `-N` assertions to the relevant `changed-file-item` row to keep tests robust.

## Task 6: Update frontend tests for grouped rendering and stat formatting

### Test Strategy
- Used `mockImplementation` instead of `mockResolvedValue` to ensure consistent return values across multiple component renders (React Strict Mode can trigger double invocation of useEffect)
- Used `cleanup()` in `afterEach` to properly clean up DOM between tests and prevent state leakage
- Used `getAllByLabelText(/Folder/)` for group heading assertions as it's more reliable than regex-based text matching
- Each test sets up its own mock data independently to ensure test isolation

### Test Coverage Decisions
- Grouped rendering: 2 tests to verify (root) first ordering and alphabetical folder ordering
- Stat visibility: 6 tests covering all combinations of additions/deletions values (positive, zero, null)
- Rename: 1 test verifying "old -> new" format
- Error handling: 1 test verifying "Git status failed" alert
- Edge cases: 2 tests (clean status, loading state)

## Task 7: Bundle a deterministic Nerd Font asset for production

### Asset Selection Constraint
- Kept the plan-mandated exact asset requirement (`JetBrainsMonoNerdFontMono-Regular.ttf`) and explicitly avoided substituting other Nerd Font variants.

### Execution Decision
- Blocked implementation instead of introducing a placeholder `@font-face` because local URL font-face entries must resolve to an existing bundled file for production correctness.

### Retry Decision
- Used the official Nerd Fonts release package as source-of-truth and extracted only the exact approved filename, preserving deterministic asset identity while avoiding extra weight/style variants.
- Kept `@font-face` limited to required descriptors (`family`, `src`, `style`, `weight`, `display`) to minimize style-surface changes outside task 7 scope.

## Task 8: Force xterm to prefer bundled font and wait for font readiness

### Font Priority Decision
- Placed `VibetreeNerdMono` first in xterm `fontFamily` to ensure bundled font is preferred when available.
- Preserved entire existing fallback chain after the bundled font for graceful degradation on systems with other Nerd Fonts installed.

### Font Readiness Strategy
- Used `document.fonts.check("13px VibetreeNerdMono")` for immediate resolution if font already loaded (avoids unnecessary promise).
- Used `document.fonts.load("13px VibetreeNerdMono")` promise for async font loading detection.
- Chose 2-second timeout as reasonable bound: long enough for font to load on typical connections, short enough to not noticeably delay terminal startup.
- Made timeout non-blocking: terminal initializes even if font fails to load, relying on fallback fonts.

### Cleanup Strategy
- Used `isMounted` flag to prevent terminal creation if component unmounts during async font wait.
- Moved cleanup logic (removeEventListener, term.dispose) to useEffect return to ensure proper cleanup regardless of async completion.

## Task 9: Add production parity verification script for Tauri bundle artifacts

### Verification Scope Decision
- Added a dedicated Node verifier script (`scripts/verify-terminal-font-parity.mjs`) rather than ad-hoc shell checks to keep failures deterministic and reusable.
- Chose dual artifact-root font lookup (`src-tauri/target/release/bundle` and `dist/assets`) because current macOS app bundle layout does not expose unpacked frontend `.ttf` files, while `dist/assets` deterministically contains emitted production frontend artifacts.

### Failure Semantics Decision
- Token validation is strict substring matching in compiled text assets (`.css`, `.js`, `.html`) and fails fast with explicit error messaging.
- Preserved CLI override `--expect-token` behavior so negative-path checks can assert non-zero exits without changing script internals.


## Task F3: Real Manual QA - grouped changed-files + terminal parity

### QA Strategy Decision
- Treat unshimmed browser execution as a blocker-detection pass and shimmed execution as behavior-validation pass, because this project's runtime contract depends on Tauri bridge APIs unavailable in plain browser contexts.

### PASS/FAIL Criteria Decision
- Mark a QA item PASS only when there is direct interaction evidence (Playwright snapshot/evaluate output or command output), otherwise FAIL/BLOCKED.

### Terminal Non-Hang Signal
- Accepted `xterm` helper textarea attachment and active terminal tab rendering as terminal-initialization readiness evidence for the font-gated startup path in browser QA.

## Task: Fix backend compliance gap - numstat rename normalization and graceful fallback

### Rename Path Normalization Decision
- Git diff --numstat outputs renamed/copied files as "old -> new" syntax
- Normalize by extracting destination path (after " -> ") for HashMap key
- This ensures merge works regardless of how git formats the numstat output

### Numstat Failure Handling Decision
- Changed from fatal error to graceful fallback
- When numstat command fails, use empty HashMap (all files retain None stats)
- Porcelain entries are still returned - no data loss
- Rationale: numstat is enhancement data, not critical; core functionality (file list) should not fail

### Test Design Decision
- Added dedicated `with_git_numstat_error` method to MockChangesEnvironment
- Tests cover both failure path (returns files with None stats) and success path (stats merged correctly)
- Rename syntax tests verify normalization extracts correct destination path

### Fix: Rename Syntax Correction
- Real git output uses ` => ` separator, not ` -> `
- Updated normalize_numstat_path to find " => " and extract destination path
- Tests now use actual observed format `old.txt => new.txt`
