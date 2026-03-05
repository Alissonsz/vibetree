import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useWorktreeChanges } from "../hooks/useWorktrees";
import type { RepoInfo, WorktreeInfo } from "../types";

type RepoPaneProps = {
  mobileOpen: boolean;
  onRequestClose: () => void;
  repos: RepoInfo[];
  selectedRepoId: string | null;
  selectedWorktreePath: string | null;
  worktreesByRepoId: Record<string, WorktreeInfo[]>;
  notification?: string | null;
  startupConfigError?: string | null;
  onAddRepo: (path: string) => Promise<unknown>;
  onRemoveRepo: (repoId: string) => Promise<void>;
  onSelectWorktree: (repoId: string, worktreePath: string) => void;
  onWorktreesChanged?: (repoId: string, worktrees: WorktreeInfo[]) => void;
  onDismissNotification?: () => void;
  isGlobalStartupSaving?: boolean;
  globalStartupCommand: string;
  repoStartupCommandsByRepoId: Record<string, string>;
  onSetRepoStartupCommand: (repoId: string, command: string | null) => Promise<void>;
  onSetGlobalStartupCommand: (command: string | null) => Promise<void>;
};

type RepoWatchProps = {
  repoId: string;
  onWorktreesChanged?: (repoId: string, worktrees: WorktreeInfo[]) => void;
};

function RepoWatch({ repoId, onWorktreesChanged }: RepoWatchProps) {
  const handleWorktreesChanged = useCallback(
    (worktrees: WorktreeInfo[]) => {
      onWorktreesChanged?.(repoId, worktrees);
    },
    [onWorktreesChanged, repoId]
  );

  useWorktreeChanges(repoId, handleWorktreesChanged);

  return null;
}

export default function RepoPane({
  mobileOpen,
  onRequestClose,
  repos,
  selectedRepoId,
  selectedWorktreePath,
  worktreesByRepoId,
  notification,
  startupConfigError,
  onAddRepo,
  onRemoveRepo,
  onSelectWorktree,
  onWorktreesChanged,
  onDismissNotification,
  isGlobalStartupSaving = false,
  globalStartupCommand,
  repoStartupCommandsByRepoId,
  onSetRepoStartupCommand,
  onSetGlobalStartupCommand
}: RepoPaneProps) {
  const repoIds = useMemo(() => repos.map((repo) => repo.id), [repos]);

  const [expandedRepos, setExpandedRepos] = useState<Record<string, boolean>>({});
  const [configRepoId, setConfigRepoId] = useState<string | null>(null);
  const [startupDraftByRepoId, setStartupDraftByRepoId] = useState<Record<string, string>>({});
  const [startupSaveErrorByRepoId, setStartupSaveErrorByRepoId] = useState<Record<string, string>>({});
  const [startupSavingByRepoId, setStartupSavingByRepoId] = useState<Record<string, boolean>>({});
  const startupSaveInFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!configRepoId) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-repo-config-root='true']")) return;
      setConfigRepoId(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfigRepoId(null);
      }
    };

    window.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [configRepoId]);

  const toggleExpanded = (repoId: string) => {
    setExpandedRepos((current) => ({
      ...current,
      [repoId]: !(current[repoId] ?? true)
    }));
  };

  const isExpanded = (repoId: string) => expandedRepos[repoId] ?? true;

  async function handleAddRepo() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Add Repository",
    });

    if (selected === null || typeof selected !== "string") {
      return;
    }

    await onAddRepo(selected);
  }

  async function handleRemoveRepo(repoId: string) {
    await onRemoveRepo(repoId);
  }

  function runStartupSave(repoId: string, operation: () => Promise<void>) {
    if (startupSaveInFlightRef.current.has(repoId)) {
      return;
    }

    startupSaveInFlightRef.current.add(repoId);
    setStartupSaveErrorByRepoId((current) => {
      const next = { ...current };
      delete next[repoId];
      return next;
    });
    setStartupSavingByRepoId((current) => ({
      ...current,
      [repoId]: true
    }));

    void operation()
      .catch(() => {
        setStartupSaveErrorByRepoId((current) => ({
          ...current,
          [repoId]: "Unable to save startup command."
        }));
      })
      .finally(() => {
        startupSaveInFlightRef.current.delete(repoId);
        setStartupSavingByRepoId((current) => ({
          ...current,
          [repoId]: false
        }));
      });
  }

  return (
    <aside
      id="wb-repo-pane"
      className={`flex h-full min-h-0 flex-col overflow-hidden bg-base border-r border-surface0 ${
        mobileOpen ? "fixed inset-y-0 left-0 w-4/5 z-50 shadow-2xl" : "hidden md:flex"
      }`}
      data-testid="repo-pane"
      role="complementary"
      aria-label="Repositories"
    >
      <div className="flex items-center justify-between p-4 mb-2">
        <button
          type="button"
          className="text-sm font-medium text-subtext1 hover:text-text transition-colors flex items-center gap-2"
          data-testid="add-repo-btn"
          onClick={() => void handleAddRepo()}
        >
          <span className="text-lg leading-none">+</span> New Workspace
        </button>
        <button
          type="button"
          className="md:hidden text-subtext1 hover:text-text"
          onClick={onRequestClose}
          aria-label="Close repositories pane"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-auto px-2 pb-4">
        {repoIds.map((repoId) => (
          <RepoWatch
            key={repoId}
            repoId={repoId}
            onWorktreesChanged={onWorktreesChanged}
          />
        ))}

        {notification && (
          <div className="bg-red/10 text-red p-3 rounded-md mb-4 flex justify-between text-sm mx-2" role="status">
            <span>{notification}</span>
            <button type="button" onClick={onDismissNotification} className="hover:text-text">
              ✕
            </button>
          </div>
        )}

        {startupConfigError ? (
          <div
            className="bg-yellow/10 text-yellow p-3 rounded-md mb-4 text-sm mx-2"
            data-testid="startup-config-error"
            role="status"
          >
            {startupConfigError}
          </div>
        ) : null}

        {repos.length === 0 ? (
          <div className="p-4 text-subtext1 text-sm text-center">
            Add a workspace to get started.
          </div>
        ) : (
          <div className="space-y-6">
            {repos.map((repo) => {
              const worktrees = worktreesByRepoId[repo.id] || [];
              const expanded = isExpanded(repo.id);
              const isStartupSaving = startupSavingByRepoId[repo.id] ?? false;

              return (
                <div key={repo.id} data-testid={`repo-item-${repo.id}`}>
                  <div className="flex items-center justify-between group px-2 py-1 mb-1 relative min-h-7">
                    <button
                      type="button"
                      className="text-xs font-semibold uppercase tracking-wider text-text inline-flex items-center gap-2 min-w-0 h-6 leading-none"
                      onClick={() => toggleExpanded(repo.id)}
                    >
                      <span className="truncate">{repo.name}</span>
                      <span className="inline-flex h-6 items-center text-subtext1 text-[10px] normal-case leading-none">
                        ({worktrees.length})
                      </span>
                    </button>
                    <div className="relative ml-2 flex h-6 items-center" data-repo-config-root="true">
                      <button
                        type="button"
                        className="inline-flex h-6 w-6 items-center justify-center rounded text-sm leading-none text-subtext1 transition-colors hover:bg-surface0/50 hover:text-text"
                        data-testid="repo-config-btn"
                        aria-label={`Configure ${repo.name}`}
                        aria-expanded={configRepoId === repo.id}
                        aria-controls={`repo-config-menu-${repo.id}`}
                        title="Workspace configuration"
                        onClick={() => {
                          const isOpening = configRepoId !== repo.id;
                          setConfigRepoId((current) => (current === repo.id ? null : repo.id));
                          if (isOpening) {
                            setStartupDraftByRepoId((current) => {
                              return {
                                ...current,
                                [repo.id]:
                                  repoStartupCommandsByRepoId[repo.id] ?? globalStartupCommand
                              };
                            });
                          }
                        }}
                      >
                        ⚙
                      </button>

                      {configRepoId === repo.id ? (
                        <div
                          id={`repo-config-menu-${repo.id}`}
                          data-testid="repo-config-menu"
                          className="absolute right-0 top-full z-30 mt-1 w-72 rounded-md border border-surface0 bg-mantle p-2 shadow-xl"
                          role="menu"
                          aria-label={`${repo.name} workspace options`}
                        >
                          <div className="rounded px-2 py-1.5 text-xs text-subtext1">
                            <p className="text-[11px] uppercase tracking-wide text-subtext1/80">Terminal startup</p>
                            <p className="mt-1 text-[11px] text-subtext1/80">
                              {Object.prototype.hasOwnProperty.call(repoStartupCommandsByRepoId, repo.id)
                                ? "Workspace override active."
                                : globalStartupCommand
                                  ? "Using global default unless you override."
                                  : "No startup command configured."}
                            </p>
                            <input
                              type="text"
                              data-testid="repo-startup-command-input"
                              className="mt-2 w-full rounded border border-surface0 bg-base px-2 py-1.5 text-xs text-text placeholder:text-subtext1/60 focus:border-blue focus:outline-none"
                              placeholder="opencode, tmux, npm run dev..."
                              value={
                                startupDraftByRepoId[repo.id] ??
                                repoStartupCommandsByRepoId[repo.id] ??
                                globalStartupCommand
                              }
                              onChange={(event) => {
                                const value = event.target.value;
                                setStartupDraftByRepoId((current) => ({
                                  ...current,
                                  [repo.id]: value
                                }));
                              }}
                              aria-label={`Startup command for ${repo.name}`}
                              disabled={isStartupSaving}
                            />
                            <div className="mt-2 flex items-center gap-1">
                              <button
                                type="button"
                                className="rounded border border-surface0 px-2 py-1 text-[11px] text-subtext1 hover:bg-surface0/60 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                                data-testid="repo-save-workspace-startup-btn"
                                onClick={() => {
                                  const command =
                                    startupDraftByRepoId[repo.id] ??
                                    repoStartupCommandsByRepoId[repo.id] ??
                                    globalStartupCommand;
                                  runStartupSave(repo.id, () =>
                                    onSetRepoStartupCommand(repo.id, command)
                                  );
                                }}
                                disabled={isStartupSaving}
                              >
                                Save workspace
                              </button>
                              <button
                                type="button"
                                className="rounded border border-surface0 px-2 py-1 text-[11px] text-subtext1 hover:bg-surface0/60 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                                data-testid="repo-save-global-startup-btn"
                                onClick={() => {
                                  const command =
                                    startupDraftByRepoId[repo.id] ??
                                    repoStartupCommandsByRepoId[repo.id] ??
                                    globalStartupCommand;
                                  runStartupSave(repo.id, () =>
                                    onSetGlobalStartupCommand(command)
                                  );
                                }}
                                disabled={isStartupSaving || isGlobalStartupSaving}
                              >
                                {isGlobalStartupSaving ? "Saving global..." : "Save global"}
                              </button>
                            </div>
                            <button
                              type="button"
                              className="mt-2 rounded border border-surface0 px-2 py-1 text-[11px] text-subtext1 hover:bg-surface0/60 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                              data-testid="repo-use-global-startup-btn"
                              disabled={
                                isStartupSaving ||
                                !Object.prototype.hasOwnProperty.call(repoStartupCommandsByRepoId, repo.id)
                              }
                              onClick={() => {
                                runStartupSave(repo.id, async () => {
                                  await onSetRepoStartupCommand(repo.id, null);
                                  setStartupDraftByRepoId((current) => ({
                                    ...current,
                                    [repo.id]: globalStartupCommand
                                  }));
                                });
                              }}
                            >
                              {isStartupSaving ? "Saving..." : "Use global default"}
                            </button>
                            {startupSaveErrorByRepoId[repo.id] ? (
                              <p
                                className="mt-2 text-[11px] text-red"
                                data-testid="repo-startup-save-error"
                              >
                                {startupSaveErrorByRepoId[repo.id]}
                              </p>
                            ) : null}
                          </div>

                          <div className="my-1 h-px bg-surface0" />

                          <button
                            type="button"
                            className="w-full rounded px-2 py-1.5 text-left text-xs text-red hover:bg-surface0/60"
                            data-testid="remove-repo-btn"
                            role="menuitem"
                            onClick={() => {
                              setConfigRepoId(null);
                              void handleRemoveRepo(repo.id);
                            }}
                            aria-label={`Remove ${repo.name}`}
                          >
                            Remove workspace
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {expanded && (
                    <div className="space-y-0.5">
                      {worktrees.map((worktree: WorktreeInfo) => {
                        const selected = selectedRepoId === repo.id && selectedWorktreePath === worktree.path;

                        return (
                          <div key={worktree.path} className="relative">
                            {selected && (
                              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-blue rounded-full" />
                            )}
                            <button
                              type="button"
                              data-testid="worktree-item"
                              className={`w-full text-left px-3 py-2 rounded-md text-sm truncate transition-colors ${
                                selected
                                  ? "bg-surface0/50 text-text"
                                  : "text-subtext1 hover:bg-surface0/30 hover:text-text"
                              }`}
                              onClick={() => {
                                onSelectWorktree(repo.id, worktree.path);
                                onRequestClose();
                              }}
                            >
                              <div className="flex flex-col">
                                <span className="font-medium truncate text-[13px]">
                                  {worktree.branch?.replace("refs/heads/", "") || worktree.head.slice(0, 7)}
                                </span>
                                <span className="text-[10px] text-subtext1/60 truncate mt-0.5 font-mono">
                                  {worktree.path.split('/').pop()}
                                </span>
                              </div>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
