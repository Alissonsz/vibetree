import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import TerminalPane from "../components/TerminalPane";
import { DEFAULT_ATTENTION_PROFILES } from "../terminal/attentionProfiles";

const requestUserAttentionMock = vi.fn().mockResolvedValue(undefined);
const setBadgeCountMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/window", () => ({
  UserAttentionType: {
    Informational: 2
  },
  getCurrentWindow: vi.fn(() => ({
    requestUserAttention: requestUserAttentionMock,
    setBadgeCount: setBadgeCountMock
  }))
}));

vi.mock("../terminal/notify", () => ({
  sendPromptReadyNotification: vi.fn().mockResolvedValue(undefined)
}));

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
    default: ({
      sessionId,
      isActive,
      onPromptReady
    }: {
      sessionId: string;
      isActive: boolean;
      onPromptReady?: (sessionId: string) => void;
    }) => (
      <div data-testid="terminal-instance" data-session-id={sessionId} data-active={isActive}>
        <button
          type="button"
          data-testid={`trigger-ready-${sessionId}`}
          onClick={() => onPromptReady?.(sessionId)}
        >
          Trigger Ready {sessionId}
        </button>
      </div>
    )
  };
});

describe("TerminalPane", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

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
        startupCommand="opencode"
        startupConfigReady={true}
        attentionProfiles={DEFAULT_ATTENTION_PROFILES}
        attentionRuntimeCapability={{ supported: true, reason: null }}
        worktreeDefaultAttentionProfileByPath={{}}
        onSetWorktreeDefaultAttentionProfile={vi.fn(async () => {
          return;
        })}
      />
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("create_terminal_session", {
        worktreePath: "/tmp/repo-a",
        startupCommand: "opencode"
      });
    });

    expect(screen.getAllByTestId("terminal-tab")).toHaveLength(1);
    expect(screen.getByTestId("terminal-instance")).toBeInTheDocument();
  });

  it("triggers attention for inactive session and shows attention dot", async () => {
    const invokeMock = vi.mocked(invoke);
    const sessionIds = ["session-1", "session-2"];

    invokeMock.mockImplementation(async (command) => {
      if (command === "create_terminal_session") {
        const next = sessionIds.shift() ?? "session-fallback";
        return next as unknown as never;
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
        startupCommand="opencode"
        startupConfigReady={true}
        attentionProfiles={DEFAULT_ATTENTION_PROFILES}
        attentionRuntimeCapability={{ supported: true, reason: null }}
        worktreeDefaultAttentionProfileByPath={{ "/tmp/repo-a": "opencode" }}
        onSetWorktreeDefaultAttentionProfile={vi.fn(async () => {
          return;
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("terminal-tab")).toHaveLength(1);
    });

    fireEvent.click(screen.getAllByTitle("New Terminal")[0]);

    await waitFor(() => {
      expect(screen.getAllByTestId("terminal-tab")).toHaveLength(2);
    });

    fireEvent.click(screen.getByTestId("trigger-ready-session-1"));

    await waitFor(() => {
      expect(requestUserAttentionMock).toHaveBeenCalledTimes(1);
      expect(setBadgeCountMock).toHaveBeenCalledWith(1);
      const dot = screen.getByTestId("terminal-attention-dot");
      expect(dot).toBeInTheDocument();
      expect(dot.className).toContain("animate-pulse");
    });

    fireEvent.click(screen.getAllByTestId("terminal-tab")[0]);

    await waitFor(() => {
      expect(screen.queryByTestId("terminal-attention-dot")).not.toBeInTheDocument();
    });
  });

  it("selector updates worktree default profile", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockImplementation(async (command) => {
      if (command === "create_terminal_session") {
        return "session-1" as unknown as never;
      }
      return undefined as never;
    });

    const setWorktreeDefaultAttentionProfile = vi.fn(async () => {
      return;
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
        startupCommand="opencode"
        startupConfigReady={true}
        attentionProfiles={DEFAULT_ATTENTION_PROFILES}
        attentionRuntimeCapability={{ supported: true, reason: null }}
        worktreeDefaultAttentionProfileByPath={{ "/tmp/repo-a": "opencode" }}
        onSetWorktreeDefaultAttentionProfile={setWorktreeDefaultAttentionProfile}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText("Attention:").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: /OpenCode/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Off$/i }));

    await waitFor(() => {
      expect(setWorktreeDefaultAttentionProfile).toHaveBeenCalledWith("/tmp/repo-a", null);
    });
  });

  it("shows warning when enabling attention in unsupported runtime", async () => {
    const invokeMock = vi.mocked(invoke);
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
        startupCommand="opencode"
        startupConfigReady={true}
        attentionProfiles={DEFAULT_ATTENTION_PROFILES}
        attentionRuntimeCapability={{
          supported: false,
          reason: "Current session is TTY-only, so window attention blinking is unavailable."
        }}
        worktreeDefaultAttentionProfileByPath={{ "/tmp/repo-a": "opencode" }}
        onSetWorktreeDefaultAttentionProfile={vi.fn(async () => {
          return;
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText("Attention:").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: /OpenCode/i }));
    fireEvent.click(screen.getByRole("button", { name: /Codex/i }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Current session is TTY-only, so window attention blinking is unavailable."
        )
      ).toBeInTheDocument();
    });
  });
});
