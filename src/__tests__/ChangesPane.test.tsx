import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { invoke } from "@tauri-apps/api/core";

import ChangesPane from "../components/ChangesPane";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => {
    return async () => {
      return;
    };
  }),
}));

describe("ChangesPane", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  function mockChangedFiles(files: unknown) {
    vi.mocked(invoke).mockImplementation(
      () => Promise.resolve(files) as ReturnType<typeof invoke>
    );
  }

  function renderPane() {
    return render(
      <ChangesPane
        mobileOpen={false}
        onRequestClose={vi.fn()}
        selectedWorktreePath="/tmp/repo"
      />
    );
  }

  function getFileRowByPath(pathText: string) {
    const list = screen.getByTestId("changed-file-list");
    const rows = within(list).getAllByTestId("changed-file-item");
    const row = rows.find((candidate) =>
      within(candidate).queryByText(pathText)
    );
    expect(row).toBeTruthy();
    return row!;
  }

  function getDirectoryRowByName(name: string) {
    const rows = screen.getAllByTestId("tree-directory");
    const row = rows.find((candidate) => within(candidate).queryByText(name));
    expect(row).toBeTruthy();
    return row!;
  }

  it("renders changed files from backend data", async () => {
    mockChangedFiles([
      {
        path: "src/main.ts",
        status: "Modified",
        original_path: null,
        additions: null,
        deletions: null,
      },
      {
        path: "README.md",
        status: "Added",
        original_path: null,
        additions: null,
        deletions: null,
      },
    ]);

    renderPane();

    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("get_changed_files", {
        worktreePath: "/tmp/repo",
      });
    });

    expect(screen.getAllByTestId("changed-file-item")).toHaveLength(2);
    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.getByText("main.ts")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  it("renders directory nodes with chevrons and toggles children visibility", async () => {
    mockChangedFiles([
      {
        path: "README.md",
        status: "Modified",
        original_path: null,
        additions: null,
        deletions: null,
      },
      {
        path: "src/main.ts",
        status: "Modified",
        original_path: null,
        additions: null,
        deletions: null,
      },
      {
        path: "src/utils/helpers.ts",
        status: "Modified",
        original_path: null,
        additions: null,
        deletions: null,
      },
    ]);

    renderPane();

    await waitFor(() => {
      expect(screen.getAllByTestId("changed-file-item")).toHaveLength(3);
    });

    const srcRow = getDirectoryRowByName("src");
    expect(srcRow.querySelector(".lucide-chevron-down")).toBeInTheDocument();
    expect(screen.getByText("main.ts")).toBeInTheDocument();
    expect(screen.getByText("helpers.ts")).toBeInTheDocument();

    srcRow.click();
    await waitFor(() => {
      expect(
        getDirectoryRowByName("src").querySelector(".lucide-chevron-right")
      ).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByText("main.ts")).not.toBeInTheDocument();
      expect(screen.queryByText("helpers.ts")).not.toBeInTheDocument();
    });
    expect(screen.getByText("README.md")).toBeInTheDocument();

    srcRow.click();
    await waitFor(() => {
      expect(
        getDirectoryRowByName("src").querySelector(".lucide-chevron-down")
      ).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("main.ts")).toBeInTheDocument();
      expect(screen.getByText("helpers.ts")).toBeInTheDocument();
    });
  });

  it("renders nested files with indentation and root files at depth 0", async () => {
    mockChangedFiles([
      {
        path: "src/components/Foo.tsx",
        status: "Modified",
        original_path: null,
        additions: null,
        deletions: null,
      },
      {
        path: "README.md",
        status: "Modified",
        original_path: null,
        additions: null,
        deletions: null,
      },
    ]);

    renderPane();

    await waitFor(() => {
      expect(screen.getAllByTestId("changed-file-item")).toHaveLength(2);
    });

    const srcRow = getDirectoryRowByName("src");
    const componentsRow = getDirectoryRowByName("components");
    const readmeRow = getFileRowByPath("README.md");
    const fooRow = getFileRowByPath("Foo.tsx");

    expect(srcRow).toHaveStyle({ paddingLeft: "0px" });
    expect(componentsRow).toHaveStyle({ paddingLeft: "16px" });
    expect(readmeRow).toHaveStyle({ paddingLeft: "20px" });
    expect(fooRow).toHaveStyle({ paddingLeft: "52px" });
  });

  it("orders directories before files and sorts alphabetically at each level", async () => {
    mockChangedFiles([
      {
        path: "beta/beta.ts",
        status: "Modified",
        original_path: null,
        additions: null,
        deletions: null,
      },
      {
        path: "alpha/alpha.ts",
        status: "Modified",
        original_path: null,
        additions: null,
        deletions: null,
      },
      {
        path: "z.md",
        status: "Modified",
        original_path: null,
        additions: null,
        deletions: null,
      },
      {
        path: "a.md",
        status: "Modified",
        original_path: null,
        additions: null,
        deletions: null,
      },
    ]);

    renderPane();

    await waitFor(() => {
      expect(screen.getAllByTestId("changed-file-item")).toHaveLength(4);
    });

    const list = screen.getByTestId("changed-file-list");
    const items = Array.from(list.children);
    const indexOf = (text: string) =>
      items.findIndex((node) => (node.textContent ?? "").includes(text));

    expect(indexOf("alpha")).toBeGreaterThanOrEqual(0);
    expect(indexOf("beta")).toBeGreaterThanOrEqual(0);
    expect(indexOf("a.md")).toBeGreaterThanOrEqual(0);
    expect(indexOf("z.md")).toBeGreaterThanOrEqual(0);

    expect(indexOf("alpha")).toBeLessThan(indexOf("beta"));
    expect(indexOf("beta")).toBeLessThan(indexOf("a.md"));
    expect(indexOf("a.md")).toBeLessThan(indexOf("z.md"));
  });

  it("shows additions stat when additions > 0", async () => {
    mockChangedFiles([
      {
        path: "file.ts",
        status: "Modified",
        original_path: null,
        additions: 21,
        deletions: null,
      },
    ]);

    renderPane();

    await waitFor(() => {
      expect(screen.getAllByTestId("changed-file-item")).toHaveLength(1);
    });

    const row = getFileRowByPath("file.ts");
    expect(within(row).getByText("+21")).toBeInTheDocument();
    expect(within(row).queryByText(/^-[0-9]+$/)).not.toBeInTheDocument();
  });

  it("shows deletions stat when deletions > 0", async () => {
    mockChangedFiles([
      {
        path: "file.ts",
        status: "Modified",
        original_path: null,
        additions: null,
        deletions: 7,
      },
    ]);

    renderPane();

    await waitFor(() => {
      expect(screen.getAllByTestId("changed-file-item")).toHaveLength(1);
    });

    const row = getFileRowByPath("file.ts");
    expect(within(row).getByText("-7")).toBeInTheDocument();
    expect(within(row).queryByText(/^\+[0-9]+$/)).not.toBeInTheDocument();
  });

  it("shows both additions and deletions when both > 0", async () => {
    mockChangedFiles([
      {
        path: "file.ts",
        status: "Modified",
        original_path: null,
        additions: 38,
        deletions: 25,
      },
    ]);

    renderPane();

    await waitFor(() => {
      expect(screen.getAllByTestId("changed-file-item")).toHaveLength(1);
    });

    const row = getFileRowByPath("file.ts");
    expect(within(row).getByText("+38")).toBeInTheDocument();
    expect(within(row).getByText("-25")).toBeInTheDocument();
  });

  it("hides additions token when additions is 0", async () => {
    mockChangedFiles([
      {
        path: "file.ts",
        status: "Modified",
        original_path: null,
        additions: 0,
        deletions: 10,
      },
    ]);

    renderPane();

    await waitFor(() => {
      expect(screen.getAllByTestId("changed-file-item")).toHaveLength(1);
    });

    const row = getFileRowByPath("file.ts");
    expect(within(row).getByText("-10")).toBeInTheDocument();
    expect(within(row).queryByText("+0")).not.toBeInTheDocument();
  });

  it("hides deletions token when deletions is 0", async () => {
    mockChangedFiles([
      {
        path: "file.ts",
        status: "Modified",
        original_path: null,
        additions: 5,
        deletions: 0,
      },
    ]);

    renderPane();

    await waitFor(() => {
      expect(screen.getAllByTestId("changed-file-item")).toHaveLength(1);
    });

    const row = getFileRowByPath("file.ts");
    expect(within(row).getByText("+5")).toBeInTheDocument();
    expect(within(row).queryByText("-0")).not.toBeInTheDocument();
  });

  it("hides entire stats block when both additions and deletions are 0", async () => {
    mockChangedFiles([
      {
        path: "file.ts",
        status: "Modified",
        original_path: null,
        additions: 0,
        deletions: 0,
      },
    ]);

    renderPane();

    await waitFor(() => {
      expect(screen.getAllByTestId("changed-file-item")).toHaveLength(1);
    });

    const row = getFileRowByPath("file.ts");
    expect(within(row).queryByText(/^\+[0-9]+$/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/^-[0-9]+$/)).not.toBeInTheDocument();
  });

  it("hides entire stats block when both additions and deletions are null", async () => {
    mockChangedFiles([
      {
        path: "file.ts",
        status: "Modified",
        original_path: null,
        additions: null,
        deletions: null,
      },
    ]);

    renderPane();

    await waitFor(() => {
      expect(screen.getAllByTestId("changed-file-item")).toHaveLength(1);
    });

    const row = getFileRowByPath("file.ts");
    expect(within(row).queryByText(/^\+[0-9]+$/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/^-[0-9]+$/)).not.toBeInTheDocument();
  });

  it("displays rename as 'old -> new' when status is Renamed", async () => {
    mockChangedFiles([
      {
        path: "new-name.ts",
        status: "Renamed",
        original_path: "old-name.ts",
        additions: null,
        deletions: null,
      },
    ]);

    renderPane();

    await waitFor(() => {
      expect(
        screen.getByText("old-name.ts -> new-name.ts")
      ).toBeInTheDocument();
    });
  });

  it("shows error alert when invoke is rejected", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("git failed"));

    renderPane();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    expect(screen.getByText("Git status failed")).toBeInTheDocument();
    expect(screen.getByText("git failed")).toBeInTheDocument();
  });

  it("shows clean status message when no changes", async () => {
    mockChangedFiles([]);

    renderPane();

    await waitFor(() => {
      expect(
        screen.getByText("This workspace has a clean status.")
      ).toBeInTheDocument();
    });
  });

  it("shows loading state while fetching", async () => {
    let resolveFiles: (value: unknown) => void;
    const filesPromise = new Promise((resolve) => {
      resolveFiles = resolve;
    });

    vi.mocked(invoke).mockReturnValue(filesPromise as ReturnType<typeof invoke>);

    renderPane();

    expect(screen.getByText("Loading changed files...")).toBeInTheDocument();

    resolveFiles!([]);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading changed files...")
      ).not.toBeInTheDocument();
    });
  });
});
