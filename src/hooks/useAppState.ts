import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { createReposClient } from "./useRepos";
import { listWorktrees, startWatchingRepo, stopWatchingRepo } from "./useWorktrees";
import type { RepoInfo, SelectionState, WorktreeInfo } from "../types";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

export type AppState = SelectionState & {
  repos: RepoInfo[];
  worktreesByRepoId: Record<string, WorktreeInfo[]>;
  notification: string | null;
};

type SetReposAction = {
  type: "SET_REPOS";
  repos: RepoInfo[];
};

type AddRepoAction = {
  type: "ADD_REPO";
  repo: RepoInfo;
};

type RemoveRepoAction = {
  type: "REMOVE_REPO";
  repoId: string;
};

type SetWorktreesAction = {
  type: "SET_WORKTREES";
  repoId: string;
  worktrees: WorktreeInfo[];
};

type SelectWorktreeAction = {
  type: "SELECT_WORKTREE";
  repoId: string;
  worktreePath: string;
};

type SetSelectedRepoAction = {
  type: "SET_SELECTED_REPO";
  repoId: string | null;
};

type ClearSelectionAction = {
  type: "CLEAR_SELECTION";
};

type ClearNotificationAction = {
  type: "CLEAR_NOTIFICATION";
};

type SetWorktreeWaitingStateAction = {
  type: "SET_WORKTREE_WAITING_STATE";
  worktreePath: string;
  isWaiting: boolean;
};

export type AppStateAction =
  | SetReposAction
  | AddRepoAction
  | RemoveRepoAction
  | SetWorktreesAction
  | SelectWorktreeAction
  | SetSelectedRepoAction
  | ClearSelectionAction
  | ClearNotificationAction
  | SetWorktreeWaitingStateAction;

export const initialAppState: AppState = {
  repos: [],
  worktreesByRepoId: {},
  selectedRepoId: null,
  selectedWorktreePath: null,
  notification: null
};

function getFirstAvailableSelection(
  repos: RepoInfo[],
  worktreesByRepoId: Record<string, WorktreeInfo[]>
): SelectionState {
  for (const repo of repos) {
    const firstWorktree = worktreesByRepoId[repo.id]?.[0];
    if (firstWorktree) {
      return {
        selectedRepoId: repo.id,
        selectedWorktreePath: firstWorktree.path
      };
    }
  }

  return {
    selectedRepoId: repos[0]?.id ?? null,
    selectedWorktreePath: null
  };
}

export function appStateReducer(
  state: AppState,
  action: AppStateAction
): AppState {
  switch (action.type) {
    case "SET_REPOS": {
      const nextRepos = action.repos;
      const nextRepoIds = new Set(nextRepos.map((repo) => repo.id));
      const nextWorktreesByRepoId: Record<string, WorktreeInfo[]> = {};

      for (const repoId of Object.keys(state.worktreesByRepoId)) {
        if (nextRepoIds.has(repoId)) {
          nextWorktreesByRepoId[repoId] = state.worktreesByRepoId[repoId];
        }
      }

      const selectedRepoStillExists =
        state.selectedRepoId !== null && nextRepoIds.has(state.selectedRepoId);

      const selectedWorktreeStillExists =
        selectedRepoStillExists &&
        state.selectedRepoId !== null &&
        state.selectedWorktreePath !== null &&
        (nextWorktreesByRepoId[state.selectedRepoId] ?? []).some(
          (worktree) => worktree.path === state.selectedWorktreePath
        );

      if (selectedWorktreeStillExists) {
        return {
          ...state,
          repos: nextRepos,
          worktreesByRepoId: nextWorktreesByRepoId
        };
      }

      const nextSelection = getFirstAvailableSelection(
        nextRepos,
        nextWorktreesByRepoId
      );

      return {
        ...state,
        repos: nextRepos,
        worktreesByRepoId: nextWorktreesByRepoId,
        selectedRepoId: nextSelection.selectedRepoId,
        selectedWorktreePath: nextSelection.selectedWorktreePath
      };
    }

    case "ADD_REPO": {
      const exists = state.repos.some((repo) => repo.id === action.repo.id);
      if (exists) {
        return state;
      }

      return {
        ...state,
        repos: [...state.repos, action.repo],
        selectedRepoId: state.selectedRepoId ?? action.repo.id
      };
    }

    case "REMOVE_REPO": {
      const nextRepos = state.repos.filter((repo) => repo.id !== action.repoId);
      const nextWorktreesByRepoId = { ...state.worktreesByRepoId };
      delete nextWorktreesByRepoId[action.repoId];

      if (state.selectedRepoId !== action.repoId) {
        return {
          ...state,
          repos: nextRepos,
          worktreesByRepoId: nextWorktreesByRepoId
        };
      }

      const nextSelection = getFirstAvailableSelection(
        nextRepos,
        nextWorktreesByRepoId
      );

      return {
        ...state,
        repos: nextRepos,
        worktreesByRepoId: nextWorktreesByRepoId,
        selectedRepoId: nextSelection.selectedRepoId,
        selectedWorktreePath: nextSelection.selectedWorktreePath
      };
    }

    case "SET_WORKTREES": {
      const existingWorktrees = state.worktreesByRepoId[action.repoId] || [];
      const waitingPaths = new Set(
        existingWorktrees
          .filter((w) => w.is_waiting_for_user)
          .map((w) => w.path)
      );

      const mergedWorktrees = action.worktrees.map((w) => ({
        ...w,
        is_waiting_for_user: waitingPaths.has(w.path) || w.is_waiting_for_user
      }));

      const nextWorktreesByRepoId = {
        ...state.worktreesByRepoId,
        [action.repoId]: mergedWorktrees
      };

      if (state.selectedRepoId === null) {
        const nextSelection = getFirstAvailableSelection(
          state.repos,
          nextWorktreesByRepoId
        );

        return {
          ...state,
          worktreesByRepoId: nextWorktreesByRepoId,
          selectedRepoId: nextSelection.selectedRepoId,
          selectedWorktreePath: nextSelection.selectedWorktreePath
        };
      }

      if (state.selectedRepoId !== action.repoId) {
        return {
          ...state,
          worktreesByRepoId: nextWorktreesByRepoId
        };
      }

      if (state.selectedWorktreePath === null) {
        return {
          ...state,
          worktreesByRepoId: nextWorktreesByRepoId,
          selectedWorktreePath: action.worktrees[0]?.path ?? null
        };
      }

      const selectedStillExists = action.worktrees.some(
        (worktree) => worktree.path === state.selectedWorktreePath
      );

      if (selectedStillExists) {
        return {
          ...state,
          worktreesByRepoId: nextWorktreesByRepoId
        };
      }

      return {
        ...state,
        worktreesByRepoId: nextWorktreesByRepoId,
        selectedWorktreePath: action.worktrees[0]?.path ?? null
      };
    }

    case "SET_WORKTREE_WAITING_STATE": {
      const nextWorktreesByRepoId = { ...state.worktreesByRepoId };
      let updated = false;

      for (const [repoId, worktrees] of Object.entries(nextWorktreesByRepoId)) {
        const index = worktrees.findIndex((w) => w.path === action.worktreePath);
        if (index !== -1) {
          const nextWorktrees = [...worktrees];
          nextWorktrees[index] = { ...nextWorktrees[index], is_waiting_for_user: action.isWaiting };
          nextWorktreesByRepoId[repoId] = nextWorktrees;
          updated = true;
          break;
        }
      }

      if (!updated) {
        return state;
      }

      return {
        ...state,
        worktreesByRepoId: nextWorktreesByRepoId
      };
    }

    case "SELECT_WORKTREE": {
      const nextWorktreesByRepoId = { ...state.worktreesByRepoId };
      const worktrees = nextWorktreesByRepoId[action.repoId];
      
      if (worktrees) {
        nextWorktreesByRepoId[action.repoId] = worktrees.map(w => 
          w.path === action.worktreePath ? { ...w, is_waiting_for_user: false } : w
        );
      }

      return {
        ...state,
        selectedRepoId: action.repoId,
        selectedWorktreePath: action.worktreePath,
        worktreesByRepoId: nextWorktreesByRepoId,
        notification: null
      };
    }

    case "SET_SELECTED_REPO":
      return {
        ...state,
        selectedRepoId: action.repoId,
        selectedWorktreePath: null
      };

    case "CLEAR_SELECTION":
      return {
        ...state,
        selectedRepoId: null,
        selectedWorktreePath: null
      };

    case "CLEAR_NOTIFICATION":
      return {
        ...state,
        notification: null
      };

    default:
      return state;
  }
}

export function useAppState() {
  const reposClient = useMemo(() => createReposClient(), []);
  const [state, dispatch] = useReducer(appStateReducer, initialAppState);
  const latestReposRef = useRef<RepoInfo[]>([]);
  const selectedWorktreePathRef = useRef<string | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    latestReposRef.current = state.repos;
    selectedWorktreePathRef.current = state.selectedWorktreePath;
  }, [state.repos, state.selectedWorktreePath]);

  const setWorktrees = useCallback((repoId: string, worktrees: WorktreeInfo[]) => {
    dispatch({ type: "SET_WORKTREES", repoId, worktrees });
  }, []);

  const clearNotification = useCallback(() => {
    dispatch({ type: "CLEAR_NOTIFICATION" });
  }, []);

  const addRepository = useCallback(
    async (repoPath: string) => {
      const repo = await reposClient.addRepo(repoPath);
      dispatch({ type: "ADD_REPO", repo });
      await startWatchingRepo(repo.id, repo.path);
      const worktrees = await listWorktrees(repo.path);
      dispatch({ type: "SET_WORKTREES", repoId: repo.id, worktrees });
      return repo;
    },
    [reposClient]
  );

  const removeRepository = useCallback(
    async (repoId: string) => {
      await reposClient.removeRepo(repoId);
      await stopWatchingRepo(repoId);
      dispatch({ type: "REMOVE_REPO", repoId });
    },
    [reposClient]
  );

  const idleTimeoutsRef = useRef<Map<string, number>>(new Map());
  const isWaitingMapRef = useRef<Map<string, boolean>>(new Map());
  const isBusyMapRef = useRef<Map<string, boolean>>(new Map());
  const activeSessionIdByWorktreeRef = useRef<Record<string, string>>({});

  const selectWorktree = useCallback((repoId: string, worktreePath: string) => {
    dispatch({ type: "SELECT_WORKTREE", repoId, worktreePath });
  }, []);

  const setActiveSession = useCallback((worktreePath: string, sessionId: string) => {
    activeSessionIdByWorktreeRef.current[worktreePath] = sessionId;
    // When switching sessions, if the new session was waiting, clear it
    if (isWaitingMapRef.current.get(sessionId)) {
      dispatch({ type: "SET_WORKTREE_WAITING_STATE", worktreePath, isWaiting: false });
      isWaitingMapRef.current.set(sessionId, false);
    }
  }, []);

  const setWorktreeWaitingState = useCallback((worktreePath: string, isWaiting: boolean) => {
    dispatch({ type: "SET_WORKTREE_WAITING_STATE", worktreePath, isWaiting });
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      const currentPath = selectedWorktreePathRef.current;
      if (currentPath) {
        const activeSessionId = activeSessionIdByWorktreeRef.current[currentPath];
        if (activeSessionId && isWaitingMapRef.current.get(activeSessionId)) {
          setWorktreeWaitingState(currentPath, false);
          isWaitingMapRef.current.set(activeSessionId, false);
        }
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [setWorktreeWaitingState]);

  useEffect(() => {
    let unlistenAgentFinished: (() => void) | undefined;
    let unlistenTerminalOutput: (() => void) | undefined;
    
    async function triggerOSNotification(title: string, body: string) {
      const permissionGranted = await isPermissionGranted() || (await requestPermission() === "granted");
      
      if (permissionGranted) {
        // Try the plugin first
        void sendNotification({ title, body });
        // Direct Rust/AppleScript fallback for macOS dev mode
        void invoke("send_system_notification", { title, body });
      }
    }

    async function triggerWaiting(sessionId: string, worktreePath: string, force: boolean = false) {
      // If not "busy", don't trigger idle notification (prevents spam)
      if (!force && !isBusyMapRef.current.get(sessionId)) return;
      if (isWaitingMapRef.current.get(sessionId)) return;
      
      const isSelectedWorktree = selectedWorktreePathRef.current === worktreePath;
      const isActiveSession = activeSessionIdByWorktreeRef.current[worktreePath] === sessionId;
      const isWindowFocused = document.hasFocus();

      // If the user is already looking at this EXACT terminal tab in the foreground, 
      // they don't need a notification or a blue dot.
      if (isSelectedWorktree && isActiveSession && isWindowFocused) {
        isBusyMapRef.current.set(sessionId, false);
        return;
      }

      setWorktreeWaitingState(worktreePath, true);
      isWaitingMapRef.current.set(sessionId, true);
      isBusyMapRef.current.set(sessionId, false);
      
      const branchName = worktreePath.split("/").pop() || "workspace";
      void triggerOSNotification(
        "Agent Waiting",
        `Terminal is ready in ${branchName}.`
      );
    }

    async function setupListeners() {
      unlistenAgentFinished = await listen<{ session_id: string; worktree_path: string }>(
        "agent-finished",
        (event) => {
          const { session_id, worktree_path } = event.payload;
          const timeout = idleTimeoutsRef.current.get(session_id);
          if (timeout) {
            clearTimeout(timeout);
            idleTimeoutsRef.current.delete(session_id);
          }
          void triggerWaiting(session_id, worktree_path, true);
        }
      );

      unlistenTerminalOutput = await listen<{ session_id: string; worktree_path: string; data: string }>(
        "terminal-output",
        (event) => {
          const { session_id, worktree_path } = event.payload;
          
          // Mark as busy so we know it's worth notifying when it becomes idle
          isBusyMapRef.current.set(session_id, true);

          if (isWaitingMapRef.current.get(session_id)) {
            setWorktreeWaitingState(worktree_path, false);
            isWaitingMapRef.current.set(session_id, false);
          }

          const existingTimeout = idleTimeoutsRef.current.get(session_id);
          if (existingTimeout) {
            clearTimeout(existingTimeout);
          }

          const timeout = window.setTimeout(() => {
            idleTimeoutsRef.current.delete(session_id);
            void triggerWaiting(session_id, worktree_path);
          }, 3000);

          idleTimeoutsRef.current.set(session_id, timeout);
        }
      );
    }

    void setupListeners();

    return () => {
      if (unlistenAgentFinished) unlistenAgentFinished();
      if (unlistenTerminalOutput) unlistenTerminalOutput();
      idleTimeoutsRef.current.forEach(clearTimeout);
    };
  }, [setWorktreeWaitingState]);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const repos = await reposClient.listRepos();
        if (!active) return;
        dispatch({ type: "SET_REPOS", repos });

        const lastSelection = await reposClient.getLastSelection();
        if (!active) return;

        const hasLastSelection = repos.some((repo) => repo.id === lastSelection);
        if (hasLastSelection) {
          dispatch({ type: "SET_SELECTED_REPO", repoId: lastSelection });
        }

        await Promise.all(
          repos.map(async (repo) => {
            await startWatchingRepo(repo.id, repo.path);
            const worktrees = await listWorktrees(repo.path);
            if (!active) return;
            dispatch({ type: "SET_WORKTREES", repoId: repo.id, worktrees });
          })
        );
      } catch {
        return;
      } finally {
        initializedRef.current = true;
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, [reposClient]);

  useEffect(() => {
    if (!initializedRef.current) {
      return;
    }

    void reposClient.setLastSelection(state.selectedRepoId).catch(() => {
      return;
    });
  }, [reposClient, state.selectedRepoId]);

  useEffect(() => {
    return () => {
      void Promise.all(
        latestReposRef.current.map((repo) => stopWatchingRepo(repo.id))
      ).catch(() => {
        return;
      });
    };
  }, []);

  return {
    state,
    addRepository,
    removeRepository,
    selectWorktree,
    setActiveSession,
    setWorktrees,
    clearNotification
  };
}
