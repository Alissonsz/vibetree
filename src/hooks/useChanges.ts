import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect } from "react";
import type { ChangedFile } from "../types";

export type ChangesInvoker = <T>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>;

export type ChangesClient = {
  getChangedFiles: (worktreePath: string) => Promise<ChangedFile[]>;
  getFileContent: (worktreePath: string, filePath: string) => Promise<string>;
  getFileDiff: (worktreePath: string, filePath: string) => Promise<string>;
  startWatchingChanges: (worktreePath: string) => Promise<void>;
  stopWatchingChanges: (worktreePath: string) => Promise<void>;
};

export function getChangedFiles(
  worktreePath: string,
  invokeFn: ChangesInvoker = invoke
): Promise<ChangedFile[]> {
  return invokeFn<ChangedFile[]>("get_changed_files", { worktreePath });
}

export function getFileContent(
  worktreePath: string,
  filePath: string,
  invokeFn: ChangesInvoker = invoke
): Promise<string> {
  return invokeFn<string>("get_file_content", { worktreePath, filePath });
}

export function getFileDiff(
  worktreePath: string,
  filePath: string,
  invokeFn: ChangesInvoker = invoke
): Promise<string> {
  return invokeFn<string>("get_file_diff", { worktreePath, filePath });
}

export function startWatchingChanges(
  worktreePath: string,
  invokeFn: ChangesInvoker = invoke
): Promise<void> {
  return invokeFn<void>("start_watching_changes", { worktreePath });
}

export function stopWatchingChanges(
  worktreePath: string,
  invokeFn: ChangesInvoker = invoke
): Promise<void> {
  return invokeFn<void>("stop_watching_changes", { worktreePath });
}

export function useChangesWatcher(
  worktreePath: string | null,
  onChangesDetected: (silent?: boolean) => void
): void {
  useEffect(() => {
    if (!worktreePath) return;

    let unlisten: UnlistenFn | undefined;
    let active = true;

    void startWatchingChanges(worktreePath).catch(() => {
      return;
    });

    void listen<string>("changes-detected", (event) => {
      if (event.payload === worktreePath) {
        onChangesDetected(true);
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
      void stopWatchingChanges(worktreePath).catch(() => {
        return;
      });
    };
  }, [worktreePath, onChangesDetected]);
}

export function createChangesClient(
  invokeFn: ChangesInvoker = invoke
): ChangesClient {
  return {
    getChangedFiles: (worktreePath) => getChangedFiles(worktreePath, invokeFn),
    getFileContent: (worktreePath, filePath) =>
      getFileContent(worktreePath, filePath, invokeFn),
    getFileDiff: (worktreePath, filePath) =>
      getFileDiff(worktreePath, filePath, invokeFn),
    startWatchingChanges: (worktreePath) =>
      startWatchingChanges(worktreePath, invokeFn),
    stopWatchingChanges: (worktreePath) =>
      stopWatchingChanges(worktreePath, invokeFn)
  };
}

export function useChanges(invokeFn: ChangesInvoker = invoke): ChangesClient {
  return createChangesClient(invokeFn);
}
