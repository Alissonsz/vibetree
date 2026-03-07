import { invoke } from "@tauri-apps/api/core";
import type { AttentionProfile, RepoInfo } from "../types";

export type RepoInvoker = <T>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>;

export type ReposClient = {
  addRepo: (path: string) => Promise<RepoInfo>;
  removeRepo: (id: string) => Promise<void>;
  listRepos: () => Promise<RepoInfo[]>;
  getLastSelection: () => Promise<string | null>;
  setLastSelection: (id: string | null) => Promise<void>;
  getGlobalTerminalStartupCommand: () => Promise<string | null>;
  setGlobalTerminalStartupCommand: (command: string | null) => Promise<void>;
  listRepoTerminalStartupCommands: () => Promise<Record<string, string>>;
  setRepoTerminalStartupCommand: (repoId: string, command: string | null) => Promise<void>;
  getGlobalWorktreeBaseDir: () => Promise<string | null>;
  setGlobalWorktreeBaseDir: (dir: string | null) => Promise<void>;
  listRepoWorktreeBaseDirs: () => Promise<Record<string, string>>;
  setRepoWorktreeBaseDir: (repoId: string, dir: string | null) => Promise<void>;
  getAttentionProfiles: () => Promise<AttentionProfile[]>;
  setAttentionProfiles: (profiles: AttentionProfile[]) => Promise<void>;
  listWorktreeDefaultAttentionProfiles: () => Promise<Record<string, string>>;
  setWorktreeDefaultAttentionProfile: (worktreePath: string, profileId: string | null) => Promise<void>;
};

export function createReposClient(invokeFn: RepoInvoker = invoke): ReposClient {
  return {
    addRepo: (path) => invokeFn<RepoInfo>("add_repo", { path }),
    removeRepo: (id) => invokeFn<void>("remove_repo", { id }),
    listRepos: () => invokeFn<RepoInfo[]>("list_repos"),
    getLastSelection: () => invokeFn<string | null>("get_last_selection"),
    setLastSelection: (id) => invokeFn<void>("set_last_selection", { id }),
    getGlobalTerminalStartupCommand: () =>
      invokeFn<string | null>("get_global_terminal_startup_command"),
    setGlobalTerminalStartupCommand: (command) =>
      invokeFn<void>("set_global_terminal_startup_command", { command }),
    listRepoTerminalStartupCommands: () =>
      invokeFn<Record<string, string>>("list_repo_terminal_startup_commands"),
    setRepoTerminalStartupCommand: (repoId, command) =>
      invokeFn<void>("set_repo_terminal_startup_command", { repoId, command }),
    getGlobalWorktreeBaseDir: () =>
      invokeFn<string | null>("get_global_worktree_base_dir"),
    setGlobalWorktreeBaseDir: (dir) =>
      invokeFn<void>("set_global_worktree_base_dir", { dir }),
    listRepoWorktreeBaseDirs: () =>
      invokeFn<Record<string, string>>("list_repo_worktree_base_dirs"),
    setRepoWorktreeBaseDir: (repoId, dir) =>
      invokeFn<void>("set_repo_worktree_base_dir", { repoId, dir }),
    getAttentionProfiles: () =>
      invokeFn<AttentionProfile[]>("get_attention_profiles"),
    setAttentionProfiles: (profiles) =>
      invokeFn<void>("set_attention_profiles", { profiles }),
    listWorktreeDefaultAttentionProfiles: () =>
      invokeFn<Record<string, string>>("list_worktree_default_attention_profiles"),
    setWorktreeDefaultAttentionProfile: (worktreePath, profileId) =>
      invokeFn<void>("set_worktree_default_attention_profile", { worktreePath, profileId })
  };
}

export function useRepos(invokeFn: RepoInvoker = invoke): ReposClient {
  return createReposClient(invokeFn);
}
