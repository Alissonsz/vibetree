import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect } from "react";
import type { WorktreeInfo } from "../types";

type WorktreesChangedEvent = {
  repo_id: string;
  worktrees: WorktreeInfo[];
};

export async function listBranches(repoPath: string): Promise<string[]> {
  return invoke<string[]>("list_branches", { repoPath });
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  return invoke<string>("get_current_branch", { repoPath });
}

export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  return invoke<WorktreeInfo[]>("list_worktrees", { repoPath });
}

export async function addWorktree(
  repoPath: string,
  path: string,
  branch?: string,
  baseRef?: string
): Promise<void> {
  await invoke<void>("add_worktree", {
    repoPath,
    path,
    branch: branch || null,
    baseRef: baseRef || null,
  });
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force: boolean = false
): Promise<void> {
  await invoke<void>("remove_worktree", { repoPath, worktreePath, force });
}

export async function startWatchingRepo(
  repoId: string,
  repoPath: string
): Promise<void> {
  await invoke<void>("start_watching_repo", { repoId, repoPath });
}

export async function stopWatchingRepo(repoId: string): Promise<void> {
  await invoke<void>("stop_watching_repo", { repoId });
}

export function useWorktreeChanges(
  repoId: string,
  callback: (worktrees: WorktreeInfo[]) => void
): void {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let active = true;

    void listen<WorktreesChangedEvent>("worktrees-changed", (event) => {
      if (event.payload.repo_id === repoId) {
        callback(event.payload.worktrees);
      }
    }).then((unsubscribe) => {
      if (active) {
        unlisten = unsubscribe;
      } else {
        unsubscribe();
      }
    });

    return () => {
      active = false;
      if (unlisten) {
        void unlisten();
      }
    };
  }, [callback, repoId]);
}
