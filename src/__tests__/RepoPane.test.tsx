import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RepoPane from "../components/RepoPane";
import type { RepoInfo, WorktreeInfo } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => {
    return async () => {
      return;
    };
  })
}));

describe("RepoPane", () => {
  it("renders repos and worktrees from live state", () => {
    const repo: RepoInfo = {
      id: "repo-1",
      path: "/tmp/repo",
      name: "repo"
    };

    const worktree: WorktreeInfo = {
      path: "/tmp/repo",
      head: "abc",
      branch: "main",
      is_bare: false
    };

    const setRepoStartupCommand = vi.fn(async () => {
      return;
    });
    const setGlobalStartupCommand = vi.fn(async () => {
      return;
    });

    render(
      <RepoPane
        mobileOpen={false}
        onRequestClose={vi.fn()}
        repos={[repo]}
        worktreesByRepoId={{ [repo.id]: [worktree] }}
        selectedRepoId={repo.id}
        selectedWorktreePath={worktree.path}
        notification={null}
        onAddRepo={vi.fn(async () => {
          return;
        })}
        onRemoveRepo={vi.fn(async () => {
          return;
        })}
        onSelectWorktree={vi.fn()}
        onWorktreesChanged={vi.fn()}
        onDismissNotification={vi.fn()}
        globalStartupCommand="opencode"
        repoStartupCommandsByRepoId={{}}
        onSetRepoStartupCommand={setRepoStartupCommand}
        onSetGlobalStartupCommand={setGlobalStartupCommand}
      />
    );

    expect(screen.getByTestId("repo-pane")).toBeInTheDocument();
    expect(screen.getByTestId("add-repo-btn")).toBeInTheDocument();
    expect(screen.getByTestId("repo-item-repo-1")).toBeInTheDocument();
    expect(screen.getByTestId("repo-config-btn")).toBeInTheDocument();
    expect(screen.getByTestId("worktree-item")).toHaveTextContent("main");
    expect(screen.queryByTestId("repo-config-menu")).not.toBeInTheDocument();
    expect(screen.queryByTestId("remove-repo-btn")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("repo-config-btn"));
    expect(screen.getByTestId("repo-config-menu")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("repo-startup-command-input"), {
      target: { value: "tmux" }
    });
    fireEvent.click(screen.getByTestId("repo-save-workspace-startup-btn"));
    expect(setRepoStartupCommand).toHaveBeenCalledWith("repo-1", "tmux");
    fireEvent.click(screen.getByTestId("repo-save-global-startup-btn"));
    expect(setGlobalStartupCommand).toHaveBeenCalledWith("tmux");
    expect(screen.getByTestId("remove-repo-btn")).toBeInTheDocument();
  });
});
