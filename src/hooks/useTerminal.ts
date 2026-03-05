import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect } from "react";

export type TerminalOutputEvent = {
  session_id: string;
  data: string;
};

export type TerminalExitEvent = {
  session_id: string;
  exit_code: number;
};

export type TerminalSessionInfo = {
  session_id: string;
  worktree_path: string;
};

export type TerminalInvoker = <T>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>;

export type TerminalClient = {
  createSession: (worktreePath: string, startWithOpenCodeSession?: boolean) => Promise<string>;
  closeSession: (sessionId: string) => Promise<void>;
  writeInput: (sessionId: string, data: string) => Promise<void>;
  resizeSession: (sessionId: string, rows: number, cols: number) => Promise<void>;
  listSessions: () => Promise<TerminalSessionInfo[]>;
};

export function createTerminalClient(
  invokeFn: TerminalInvoker = invoke
): TerminalClient {
  return {
    createSession: (worktreePath, startWithOpenCodeSession = false) =>
      invokeFn<string>("create_terminal_session", {
        worktreePath,
        startWithOpenCodeSession
      }),
    closeSession: (sessionId) =>
      invokeFn<void>("close_terminal_session", { sessionId }),
    writeInput: (sessionId, data) =>
      invokeFn<void>("write_terminal_input", { sessionId, data }),
    resizeSession: (sessionId, rows, cols) =>
      invokeFn<void>("resize_terminal_session", { sessionId, rows, cols }),
    listSessions: () =>
      invokeFn<TerminalSessionInfo[]>("list_terminal_sessions")
  };
}

export function useTerminal(invokeFn: TerminalInvoker = invoke): TerminalClient {
  return createTerminalClient(invokeFn);
}

export function useTerminalOutput(
  sessionId: string,
  callback: (data: string) => void
): void {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let active = true;

    void listen<TerminalOutputEvent>("terminal-output", (event) => {
      if (event.payload.session_id === sessionId) {
        callback(event.payload.data);
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
  }, [callback, sessionId]);
}
