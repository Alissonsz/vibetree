import { describe, expect, it, vi } from "vitest";
import { createReposClient, type RepoInvoker } from "../hooks/useRepos";
import type { RepoInfo } from "../types";

describe("createReposClient", () => {
  it("invokes add/list/remove commands with expected payloads", async () => {
    const repo: RepoInfo = {
      id: "repo-id",
      path: "/tmp/repo",
      name: "repo"
    };

    const invokeMock = vi.fn(
      async <T,>(
        command: string,
        args?: Record<string, unknown>
      ): Promise<T> => {
      if (command === "add_repo") {
        expect(args).toEqual({ path: "/tmp/repo" });
        return repo as unknown as T;
      }

      if (command === "list_repos") {
        expect(args).toBeUndefined();
        return [repo] as unknown as T;
      }

      if (command === "remove_repo") {
        expect(args).toEqual({ id: "repo-id" });
        return undefined as unknown as T;
      }

      throw new Error(`unexpected command: ${command}`);
      }
    );

    const repos = createReposClient(invokeMock as unknown as RepoInvoker);

    const added = await repos.addRepo("/tmp/repo");
    expect(added).toEqual(repo);

    const listed = await repos.listRepos();
    expect(listed).toEqual([repo]);

    await repos.removeRepo("repo-id");
    expect(invokeMock).toHaveBeenCalledTimes(3);
  });

  it("handles last selection commands including clear", async () => {
    const invokeMock = vi.fn(
      async <T,>(
        command: string,
        args?: Record<string, unknown>
      ): Promise<T> => {
      if (command === "get_last_selection") {
        expect(args).toBeUndefined();
        return "repo-id" as unknown as T;
      }

      if (command === "set_last_selection") {
        return undefined as unknown as T;
      }

      throw new Error(`unexpected command: ${command}`);
      }
    );

    const repos = createReposClient(invokeMock as unknown as RepoInvoker);
    const selected = await repos.getLastSelection();
    expect(selected).toBe("repo-id");

    await repos.setLastSelection("repo-id");
    await repos.setLastSelection(null);

    expect(invokeMock).toHaveBeenNthCalledWith(2, "set_last_selection", {
      id: "repo-id"
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "set_last_selection", {
      id: null
    });
  });

  it("reads and writes terminal startup command settings", async () => {
    const invokeMock = vi.fn(
      async <T,>(
        command: string,
        args?: Record<string, unknown>
      ): Promise<T> => {
        if (command === "get_global_terminal_startup_command") {
          expect(args).toBeUndefined();
          return "opencode" as unknown as T;
        }

        if (command === "set_global_terminal_startup_command") {
          return undefined as unknown as T;
        }

        if (command === "list_repo_terminal_startup_commands") {
          expect(args).toBeUndefined();
          return { "repo-id": "tmux" } as unknown as T;
        }

        if (command === "set_repo_terminal_startup_command") {
          return undefined as unknown as T;
        }

        throw new Error(`unexpected command: ${command}`);
      }
    );

    const repos = createReposClient(invokeMock as unknown as RepoInvoker);

    const globalCommand = await repos.getGlobalTerminalStartupCommand();
    expect(globalCommand).toBe("opencode");

    await repos.setGlobalTerminalStartupCommand("tmux");
    const repoCommands = await repos.listRepoTerminalStartupCommands();
    expect(repoCommands).toEqual({ "repo-id": "tmux" });

    await repos.setRepoTerminalStartupCommand("repo-id", "npm run dev");
    await repos.setRepoTerminalStartupCommand("repo-id", null);

    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "set_global_terminal_startup_command",
      { command: "tmux" }
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      4,
      "set_repo_terminal_startup_command",
      { repoId: "repo-id", command: "npm run dev" }
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      5,
      "set_repo_terminal_startup_command",
      { repoId: "repo-id", command: null }
    );
  });
});
