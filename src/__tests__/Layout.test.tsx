import "@testing-library/jest-dom/vitest";

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import Layout from "../components/Layout";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === "list_repos") {
      return [];
    }

    if (command === "get_last_selection") {
      return null;
    }

    if (command === "set_last_selection") {
      return;
    }

    if (command === "get_global_terminal_startup_command") {
      return null;
    }

    if (command === "list_repo_terminal_startup_commands") {
      return {};
    }

    return undefined;
  })
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => {
    return async () => {
      return;
    };
  })
}));

describe("Layout", () => {
  it("renders all three panes", () => {
    render(<Layout />);

    expect(screen.getByTestId("repo-pane")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-pane")).toBeInTheDocument();
    expect(screen.getByTestId("changes-pane")).toBeInTheDocument();
  });

  it("shows startup config load warning when settings fetch fails", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_repos") {
        return [] as never;
      }

      if (command === "get_last_selection") {
        return null as never;
      }

      if (command === "set_last_selection") {
        return undefined as never;
      }

      if (command === "get_global_terminal_startup_command") {
        throw new Error("load failed");
      }

      if (command === "list_repo_terminal_startup_commands") {
        return {} as never;
      }

      return undefined as never;
    });

    render(<Layout />);

    await waitFor(() => {
      expect(screen.getByTestId("startup-config-error")).toBeInTheDocument();
    });
  });
});
