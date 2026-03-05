import { useCallback, useMemo, useState } from "react";
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
  onAddRepo: (path: string) => Promise<unknown>;
  onRemoveRepo: (repoId: string) => Promise<void>;
  onSelectWorktree: (repoId: string, worktreePath: string) => void;
  onWorktreesChanged?: (repoId: string, worktrees: WorktreeInfo[]) => void;
  onDismissNotification?: () => void;
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
  onAddRepo,
  onRemoveRepo,
  onSelectWorktree,
  onWorktreesChanged,
  onDismissNotification
}: RepoPaneProps) {
  const repoIds = useMemo(() => repos.map((repo) => repo.id), [repos]);

  const [expandedRepos, setExpandedRepos] = useState<Record<string, boolean>>({});

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

  return (
    <aside
      id="wb-repo-pane"
      className={`flex flex-col bg-base border-r border-surface0 h-full ${
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

        {repos.length === 0 ? (
          <div className="p-4 text-subtext1 text-sm text-center">
            Add a workspace to get started.
          </div>
        ) : (
          <div className="space-y-6">
            {repos.map((repo) => {
              const worktrees = worktreesByRepoId[repo.id] || [];
              const expanded = isExpanded(repo.id);

              return (
                <div key={repo.id} data-testid={`repo-item-${repo.id}`}>
                  <div className="flex items-center justify-between group px-2 py-1 mb-1">
                    <button
                      type="button"
                      className="text-xs font-semibold uppercase tracking-wider text-text flex items-center gap-2 min-w-0"
                      onClick={() => toggleExpanded(repo.id)}
                    >
                      <span className="truncate">{repo.name}</span>
                      <span className="text-subtext1 text-[10px] normal-case">({worktrees.length})</span>
                    </button>
                    <div className="flex items-center gap-2 ml-2">
                      <button
                        type="button"
                        className="text-subtext1 hover:text-text text-xs transition-colors"
                        data-testid="repo-config-btn"
                        aria-label={`Configure ${repo.name}`}
                        title="Workspace configuration"
                      >
                        ⚙
                      </button>
                      <button
                        type="button"
                        className="opacity-0 group-hover:opacity-100 text-subtext1 hover:text-red text-xs transition-opacity"
                        data-testid="remove-repo-btn"
                        onClick={() => void handleRemoveRepo(repo.id)}
                        aria-label={`Remove ${repo.name}`}
                      >
                        Remove
                      </button>
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
