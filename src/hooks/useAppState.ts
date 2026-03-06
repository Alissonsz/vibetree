import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { createReposClient } from "./useRepos";
import { listWorktrees, startWatchingRepo, stopWatchingRepo } from "./useWorktrees";
import type { RepoInfo, SelectionState, WorktreeInfo } from "../types";

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

export type AppStateAction =
  | SetReposAction
  | AddRepoAction
  | RemoveRepoAction
  | SetWorktreesAction
  | SelectWorktreeAction
  | SetSelectedRepoAction
  | ClearSelectionAction
  | ClearNotificationAction;

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
      const nextWorktreesByRepoId = {
        ...state.worktreesByRepoId,
        [action.repoId]: action.worktrees
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

    case "SELECT_WORKTREE":
      return {
        ...state,
        selectedRepoId: action.repoId,
        selectedWorktreePath: action.worktreePath,
        notification: null
      };

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
  const initializedRef = useRef(false);

  useEffect(() => {
    latestReposRef.current = state.repos;
  }, [state.repos]);

  const setWorktrees = useCallback((repoId: string, worktrees: WorktreeInfo[]) => {
    dispatch({ type: "SET_WORKTREES", repoId, worktrees });
  }, []);

  const selectWorktree = useCallback((repoId: string, worktreePath: string) => {
    dispatch({ type: "SELECT_WORKTREE", repoId, worktreePath });
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
    setWorktrees,
    clearNotification
  };
}
