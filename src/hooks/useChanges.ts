import { invoke } from "@tauri-apps/api/core";
import type { ChangedFile } from "../types";

export type ChangesInvoker = <T>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>;

export type ChangesClient = {
  getChangedFiles: (worktreePath: string) => Promise<ChangedFile[]>;
};

export function getChangedFiles(
  worktreePath: string,
  invokeFn: ChangesInvoker = invoke
): Promise<ChangedFile[]> {
  return invokeFn<ChangedFile[]>("get_changed_files", { worktreePath });
}

export function createChangesClient(
  invokeFn: ChangesInvoker = invoke
): ChangesClient {
  return {
    getChangedFiles: (worktreePath) => getChangedFiles(worktreePath, invokeFn)
  };
}

export function useChanges(invokeFn: ChangesInvoker = invoke): ChangesClient {
  return createChangesClient(invokeFn);
}
