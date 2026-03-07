import { describe, expect, it, vi } from "vitest";
import {
  appStateReducer,
  initialAppState,
  type AppState
} from "../hooks/useAppState";
import type { RepoInfo, WorktreeInfo } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn()
}));

describe("appStateReducer", () => {
  it("handles repo/worktree selection lifecycle", () => {
    const repo: RepoInfo = {
      id: "repo-1",
      path: "/tmp/repo",
      name: "repo"
    };

    const firstWorktree: WorktreeInfo = {
      path: "/tmp/repo",
      head: "abc",
      branch: "main",
      is_bare: false,
      is_waiting_for_user: false
    };

    const secondWorktree: WorktreeInfo = {
      path: "/tmp/repo-feature",
      head: "def",
      branch: "feature",
      is_bare: false,
      is_waiting_for_user: false
    };

    let state: AppState = appStateReducer(initialAppState, {
      type: "ADD_REPO",
      repo
    });
    expect(state.repos).toEqual([repo]);

    state = appStateReducer(state, {
      type: "SET_WORKTREES",
      repoId: repo.id,
      worktrees: [firstWorktree, secondWorktree]
    });
    expect(state.worktreesByRepoId[repo.id]).toEqual([firstWorktree, secondWorktree]);

    state = appStateReducer(state, {
      type: "SELECT_WORKTREE",
      repoId: repo.id,
      worktreePath: secondWorktree.path
    });
    expect(state.selectedRepoId).toBe(repo.id);
    expect(state.selectedWorktreePath).toBe(secondWorktree.path);

    state = appStateReducer(state, {
      type: "SET_WORKTREES",
      repoId: repo.id,
      worktrees: [firstWorktree]
    });
    expect(state.selectedWorktreePath).toBe(firstWorktree.path);
    expect(state.notification).toBe(null);

    state = appStateReducer(state, {
      type: "REMOVE_REPO",
      repoId: repo.id
    });
    expect(state.repos).toEqual([]);
    expect(state.selectedRepoId).toBeNull();
    expect(state.selectedWorktreePath).toBeNull();
  });
});
