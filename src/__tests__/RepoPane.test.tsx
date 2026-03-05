import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
    cleanup();
  });

  it("renders repos and worktrees from live state", async () => {
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

    fireEvent.click(screen.getAllByTestId("repo-config-btn")[0]);
    expect(screen.getByTestId("repo-config-menu")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("repo-startup-command-input"), {
      target: { value: "tmux" }
    });
    const workspaceSaveButton = screen.getByTestId("repo-save-workspace-startup-btn");
    fireEvent.click(workspaceSaveButton);
    expect(setRepoStartupCommand).toHaveBeenCalledWith("repo-1", "tmux");
    await waitFor(() => {
      expect(workspaceSaveButton).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("repo-save-global-startup-btn"));
    expect(setGlobalStartupCommand).toHaveBeenCalledWith("tmux");
    expect(screen.getByTestId("remove-repo-btn")).toBeInTheDocument();
  });

  it("prevents overlapping startup saves while request is in flight", async () => {
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

    const setRepoStartupCommand = vi.fn(
      () => new Promise<void>(() => {
        return;
      })
    );

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
        onSetGlobalStartupCommand={vi.fn(async () => {
          return;
        })}
      />
    );

    fireEvent.click(screen.getAllByTestId("repo-config-btn")[0]);
    const saveButton = screen.getByTestId("repo-save-workspace-startup-btn");

    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(setRepoStartupCommand).toHaveBeenCalledTimes(1);
    expect(saveButton).toBeDisabled();
  });

  it("disables global save button when a global save is in progress", () => {
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
        isGlobalStartupSaving={true}
        globalStartupCommand="opencode"
        repoStartupCommandsByRepoId={{}}
        onSetRepoStartupCommand={vi.fn(async () => {
          return;
        })}
        onSetGlobalStartupCommand={vi.fn(async () => {
          return;
        })}
      />
    );

    fireEvent.click(screen.getAllByTestId("repo-config-btn")[0]);
    const globalSaveButton = screen.getByTestId("repo-save-global-startup-btn");
    expect(globalSaveButton).toBeDisabled();
    expect(globalSaveButton).toHaveTextContent("Saving global...");
  });

  it("refreshes workspace input from effective command when reopening config", () => {
    const repo1: RepoInfo = {
      id: "repo-1",
      path: "/tmp/repo-1",
      name: "repo-1"
    };
    const repo2: RepoInfo = {
      id: "repo-2",
      path: "/tmp/repo-2",
      name: "repo-2"
    };

    const worktree1: WorktreeInfo = {
      path: "/tmp/repo-1",
      head: "abc",
      branch: "main",
      is_bare: false
    };
    const worktree2: WorktreeInfo = {
      path: "/tmp/repo-2",
      head: "def",
      branch: "main",
      is_bare: false
    };

    const baseProps = {
      mobileOpen: false,
      onRequestClose: vi.fn(),
      repos: [repo1, repo2],
      worktreesByRepoId: { [repo1.id]: [worktree1], [repo2.id]: [worktree2] },
      selectedRepoId: repo2.id,
      selectedWorktreePath: worktree2.path,
      notification: null,
      onAddRepo: vi.fn(async () => {
        return;
      }),
      onRemoveRepo: vi.fn(async () => {
        return;
      }),
      onSelectWorktree: vi.fn(),
      onWorktreesChanged: vi.fn(),
      onDismissNotification: vi.fn(),
      repoStartupCommandsByRepoId: {},
      onSetRepoStartupCommand: vi.fn(async () => {
        return;
      }),
      onSetGlobalStartupCommand: vi.fn(async () => {
        return;
      })
    };

    const { rerender } = render(
      <RepoPane
        {...baseProps}
        globalStartupCommand="tmux"
      />
    );

    fireEvent.click(screen.getAllByTestId("repo-config-btn")[1]);
    expect(screen.getByTestId("repo-startup-command-input")).toHaveValue("tmux");

    fireEvent.click(screen.getAllByTestId("repo-config-btn")[1]);

    rerender(
      <RepoPane
        {...baseProps}
        globalStartupCommand="opencode"
      />
    );

    fireEvent.click(screen.getAllByTestId("repo-config-btn")[1]);
    expect(screen.getByTestId("repo-startup-command-input")).toHaveValue("opencode");
  });
});
