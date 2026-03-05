import "@testing-library/jest-dom/vitest";

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { invoke } from "@tauri-apps/api/core";

import ChangesPane from "../components/ChangesPane";

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

describe("ChangesPane", () => {
  it("renders changed files from backend data", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue([
      { path: "src/main.ts", status: "Modified", original_path: null },
      { path: "README.md", status: "Added", original_path: null }
    ] as unknown);

    render(
      <ChangesPane
        mobileOpen={false}
        onRequestClose={vi.fn()}
        selectedWorktreePath="/tmp/repo"
      />
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_changed_files", {
        worktreePath: "/tmp/repo"
      });
    });

    expect(screen.getAllByTestId("changed-file-item")).toHaveLength(2);
    expect(screen.getByText("src/main.ts")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });
});
