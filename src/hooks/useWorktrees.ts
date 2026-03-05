import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect } from "react";
import type { WorktreeInfo } from "../types";

type WorktreesChangedEvent = {
  repo_id: string;
  worktrees: WorktreeInfo[];
};

export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  return invoke<WorktreeInfo[]>("list_worktrees", { repoPath });
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
