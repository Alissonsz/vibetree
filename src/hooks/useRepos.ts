import { invoke } from "@tauri-apps/api/core";
import type { RepoInfo } from "../types";

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
};

export function createReposClient(invokeFn: RepoInvoker = invoke): ReposClient {
  return {
    addRepo: (path) => invokeFn<RepoInfo>("add_repo", { path }),
    removeRepo: (id) => invokeFn<void>("remove_repo", { id }),
    listRepos: () => invokeFn<RepoInfo[]>("list_repos"),
    getLastSelection: () => invokeFn<string | null>("get_last_selection"),
    setLastSelection: (id) => invokeFn<void>("set_last_selection", { id })
  };
}

export function useRepos(invokeFn: RepoInvoker = invoke): ReposClient {
  return createReposClient(invokeFn);
}
