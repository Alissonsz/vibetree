import "@testing-library/jest-dom/vitest";

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import TerminalPane from "../components/TerminalPane";

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

vi.mock("../components/TerminalInstance", () => {
  return {
    default: ({ sessionId, isActive }: { sessionId: string; isActive: boolean }) => (
      <div data-testid="terminal-instance" data-session-id={sessionId} data-active={isActive}></div>
    )
  };
});

describe("TerminalPane", () => {
  it("creates a terminal tab and renders instance", async () => {
    const invokeMock = vi.mocked(invoke);
    const listenMock = vi.mocked(listen);

    listenMock.mockImplementation(async () => {
      return async () => {
        return;
      };
    });

    invokeMock.mockImplementation(async (command) => {
      if (command === "create_terminal_session") {
        return "session-1" as unknown as never;
      }
      return undefined as never;
    });

    const worktree = {
      path: "/tmp/repo-a",
      head: "abc",
      branch: "main",
      is_bare: false
    };

    render(
      <TerminalPane
        repoOpen={false}
        changesOpen={false}
        onToggleRepo={vi.fn()}
        onToggleChanges={vi.fn()}
        selectedWorktreePath="/tmp/repo-a"
        selectedWorktree={worktree}
      />
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("create_terminal_session", {
        worktreePath: "/tmp/repo-a"
      });
    });

    expect(screen.getAllByTestId("terminal-tab")).toHaveLength(1);
    expect(screen.getByTestId("terminal-instance")).toBeInTheDocument();
  });
});
