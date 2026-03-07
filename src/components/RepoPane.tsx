import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, Settings2, FolderRoot, GitBranch, Trash, Loader2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useWorktreeChanges, removeWorktree } from "../hooks/useWorktrees";
import { getChangedFiles } from "../hooks/useChanges";
import { DEFAULT_ATTENTION_PROFILES, type AttentionMode } from "../terminal/attentionProfiles";
import { compilePromptRegex } from "../terminal/promptReady";
import type { RepoInfo, WorktreeInfo, ChangedFile } from "../types";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Card } from "./ui/Card";
import { Modal } from "./ui/Modal";
import { CreateWorktreeModal } from "./CreateWorktreeModal";
import { Select } from "./ui/Select";

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
  onSetRepoStartupCommand: (
    repoId: string,
    command: string | null,
  ) => Promise<void>;
  onSetGlobalStartupCommand: (command: string | null) => Promise<void>;
  globalWorktreeBaseDir: string;
  repoWorktreeBaseDirsByRepoId: Record<string, string>;
  onSetRepoWorktreeBaseDir: (
    repoId: string,
    dir: string | null,
  ) => Promise<void>;
  onSetGlobalWorktreeBaseDir: (dir: string | null) => Promise<void>;
  attentionProfiles: Array<{
    id: string;
    name: string;
    prompt_regex: string | null;
    attention_mode: AttentionMode;
    debounce_ms: number;
  }>;
  onSetAttentionProfiles: (
    profiles: Array<{
      id: string;
      name: string;
      prompt_regex: string | null;
      attention_mode: AttentionMode;
      debounce_ms: number;
    }>,
  ) => Promise<void>;
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
    [onWorktreesChanged, repoId],
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
  onSetGlobalStartupCommand,
  globalWorktreeBaseDir,
  repoWorktreeBaseDirsByRepoId,
  onSetRepoWorktreeBaseDir,
  onSetGlobalWorktreeBaseDir,
  attentionProfiles,
  onSetAttentionProfiles,
}: RepoPaneProps) {
  const repoIds = useMemo(() => repos.map((repo) => repo.id), [repos]);

  const [expandedRepos, setExpandedRepos] = useState<Record<string, boolean>>(
    {},
  );
  const [configRepoId, setConfigRepoId] = useState<string | null>(null);
  const [startupDraftByRepoId, setStartupDraftByRepoId] = useState<
    Record<string, string>
  >({});
  const [baseDirDraftByRepoId, setBaseDirDraftByRepoId] = useState<
    Record<string, string>
  >({});
  const [startupSaveErrorByRepoId, setStartupSaveErrorByRepoId] = useState<
    Record<string, string>
  >({});
  const [startupSavingByRepoId, setStartupSavingByRepoId] = useState<
    Record<string, boolean>
  >({});
  const [attentionProfilesDraft, setAttentionProfilesDraft] = useState(attentionProfiles);
  const [attentionSaveError, setAttentionSaveError] = useState<string | null>(null);
  const [attentionSaving, setAttentionSaving] = useState(false);
  const startupSaveInFlightRef = useRef<Set<string>>(new Set());

  const [createWorktreeRepoId, setCreateWorktreeRepoId] = useState<string | null>(null);
  const [removingWorktrees, setRemovingWorktrees] = useState<Set<string>>(new Set());
  const [forceRemovePrompt, setForceRemovePrompt] = useState<{
    repoPath: string;
    worktreePath: string;
    error?: string;
    changes?: ChangedFile[];
  } | null>(null);

  const handleRemoveWorktree = async (repoPath: string, worktreePath: string, force: boolean = false) => {
    if (force) {
      setForceRemovePrompt(null);
    }
    setRemovingWorktrees((prev) => new Set(prev).add(worktreePath));
    try {
      if (!force) {
        try {
          const changes = await getChangedFiles(worktreePath);
          if (changes.length > 0) {
            setForceRemovePrompt({
              repoPath,
              worktreePath,
              changes,
            });
            return;
          }
        } catch (e) {
          // Ignore if getChangedFiles fails (e.g., path doesn't exist), just try removing
        }
      }
      
      await removeWorktree(repoPath, worktreePath, force);
    } catch (err) {
      if (!force) {
        setForceRemovePrompt({
          repoPath,
          worktreePath,
          error: String(err).replace(/^fatal:\s*/i, ""),
        });
      } else {
        window.alert(`Force remove failed: ${String(err)}`);
      }
    } finally {
      setRemovingWorktrees((prev) => {
        const next = new Set(prev);
        next.delete(worktreePath);
        return next;
      });
    }
  };

  useEffect(() => {
    setAttentionProfilesDraft(attentionProfiles);
  }, [attentionProfiles]);

  useEffect(() => {
    if (!configRepoId) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-repo-config-root='true']")) return;
      if (target.closest("[data-select-dropdown='true']")) return;
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
      [repoId]: !(current[repoId] ?? true),
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
      [repoId]: true,
    }));

    void operation()
      .catch(() => {
        setStartupSaveErrorByRepoId((current) => ({
          ...current,
          [repoId]: "Unable to save startup command.",
        }));
      })
      .finally(() => {
        startupSaveInFlightRef.current.delete(repoId);
        setStartupSavingByRepoId((current) => ({
          ...current,
          [repoId]: false,
        }));
      });
  }

  return (
    <aside
      id="wb-repo-pane"
      className={`flex h-full min-h-0 flex-col overflow-hidden bg-base border-r border-surface0 ${
        mobileOpen
          ? "fixed inset-y-0 left-0 w-4/5 z-50 shadow-2xl"
          : "hidden md:flex"
      }`}
      data-testid="repo-pane"
      role="complementary"
      aria-label="Repositories"
    >
      <div className="flex items-center justify-between p-4 mb-2">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          data-testid="add-repo-btn"
          onClick={() => void handleAddRepo()}
        >
          <Plus size={16} /> New Workspace
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="md:hidden"
          onClick={onRequestClose}
          aria-label="Close repositories pane"
        >
          <X size={16} />
        </Button>
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
          <Card
            variant="error"
            className="mb-4 flex justify-between items-center mx-2"
          >
            <span>{notification}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDismissNotification}
              className="h-6 w-6"
            >
              <X size={14} />
            </Button>
          </Card>
        )}

        {startupConfigError ? (
          <Card
            variant="warning"
            className="mb-4 mx-2"
            data-testid="startup-config-error"
          >
            {startupConfigError}
          </Card>
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
                      className="text-xs font-semibold uppercase tracking-wider text-text inline-flex items-center gap-2 min-w-0 h-6 leading-none cursor-pointer"
                      onClick={() => toggleExpanded(repo.id)}
                    >
                      <FolderRoot size={14} className="text-subtext1/70" />
                      <span className="truncate">{repo.name}</span>
                      <span className="inline-flex h-6 items-center text-subtext1 text-[10px] normal-case leading-none">
                        ({worktrees.length})
                      </span>
                    </button>
                    <div
                      className="relative ml-2 flex h-6 items-center"
                      data-repo-config-root="true"
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label={`Create worktree in ${repo.name}`}
                        title="Create worktree"
                        onClick={() => setCreateWorktreeRepoId(repo.id)}
                      >
                        <Plus size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        data-testid="repo-config-btn"
                        aria-label={`Configure ${repo.name}`}
                        aria-expanded={configRepoId === repo.id}
                        aria-controls={`repo-config-menu-${repo.id}`}
                        title="Workspace configuration"
                        onClick={() => {
                          const isOpening = configRepoId !== repo.id;
                          setConfigRepoId((current) =>
                            current === repo.id ? null : repo.id,
                          );
                          if (isOpening) {
                            setStartupDraftByRepoId((current) => {
                              return {
                                ...current,
                                [repo.id]:
                                  repoStartupCommandsByRepoId[repo.id] ??
                                  globalStartupCommand,
                              };
                            });
                            setAttentionProfilesDraft(attentionProfiles);
                            setAttentionSaveError(null);
                          }
                        }}
                      >
                        <Settings2 size={14} />
                      </Button>

                      {configRepoId === repo.id ? (
                        <div
                          id={`repo-config-menu-${repo.id}`}
                          data-testid="repo-config-menu"
                          className="absolute right-0 top-full z-30 mt-1 w-72 rounded-sm border border-surface0 bg-mantle p-2 shadow-xl"
                          role="menu"
                          aria-label={`${repo.name} workspace options`}
                        >
                          <div className="px-2 py-1.5 text-xs text-subtext1">
                            <p className="text-[11px] uppercase tracking-wide text-subtext1/80">
                              Terminal startup
                            </p>
                            <p className="mt-1 text-[11px] text-subtext1/80">
                              {Object.prototype.hasOwnProperty.call(
                                repoStartupCommandsByRepoId,
                                repo.id,
                              )
                                ? "Workspace override active."
                                : globalStartupCommand
                                  ? "Using global default unless you override."
                                  : "No startup command configured."}
                            </p>
                            <Input
                              type="text"
                              data-testid="repo-startup-command-input"
                              className="mt-2"
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
                                  [repo.id]: value,
                                }));
                              }}
                              aria-label={`Startup command for ${repo.name}`}
                              disabled={isStartupSaving}
                            />
                            <div className="mt-2 flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="secondary"
                                className="text-[11px]"
                                data-testid="repo-save-workspace-startup-btn"
                                onClick={() => {
                                  const command =
                                    startupDraftByRepoId[repo.id] ??
                                    repoStartupCommandsByRepoId[repo.id] ??
                                    globalStartupCommand;
                                  runStartupSave(repo.id, () =>
                                    onSetRepoStartupCommand(repo.id, command),
                                  );
                                }}
                                disabled={isStartupSaving}
                              >
                                Save workspace
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                className="text-[11px]"
                                data-testid="repo-save-global-startup-btn"
                                onClick={() => {
                                  const command =
                                    startupDraftByRepoId[repo.id] ??
                                    repoStartupCommandsByRepoId[repo.id] ??
                                    globalStartupCommand;
                                  runStartupSave(repo.id, () =>
                                    onSetGlobalStartupCommand(command),
                                  );
                                }}
                                disabled={
                                  isStartupSaving || isGlobalStartupSaving
                                }
                              >
                                {isGlobalStartupSaving
                                  ? "Saving global..."
                                  : "Save global"}
                              </Button>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="mt-2 w-full text-[11px] border border-surface0"
                              data-testid="repo-use-global-startup-btn"
                              disabled={
                                isStartupSaving ||
                                !Object.prototype.hasOwnProperty.call(
                                  repoStartupCommandsByRepoId,
                                  repo.id,
                                )
                              }
                              onClick={() => {
                                runStartupSave(repo.id, async () => {
                                  await onSetRepoStartupCommand(repo.id, null);
                                  setStartupDraftByRepoId((current) => ({
                                    ...current,
                                    [repo.id]: globalStartupCommand,
                                  }));
                                });
                              }}
                            >
                              {isStartupSaving
                                ? "Saving..."
                                : "Use global default"}
                            </Button>
                            {startupSaveErrorByRepoId[repo.id] ? (
                              <p
                                className="mt-2 text-[11px] text-red"
                                data-testid="repo-startup-save-error"
                              >
                                {startupSaveErrorByRepoId[repo.id]}
                              </p>
                            ) : null}

                            <div className="my-3 h-px bg-surface0" />

                            <p className="text-[11px] uppercase tracking-wide text-subtext1/80">
                              Worktree base path (relative)
                            </p>
                            <p className="mt-1 text-[11px] text-subtext1/80">
                              {Object.prototype.hasOwnProperty.call(
                                repoWorktreeBaseDirsByRepoId,
                                repo.id,
                              )
                                ? "Workspace override active."
                                : globalWorktreeBaseDir
                                  ? "Using global default unless you override."
                                  : "Defaulting to workspace root."}
                            </p>
                            <Input
                              type="text"
                              data-testid="repo-basedir-input"
                              className="mt-2"
                              placeholder="../.worktrees"
                              value={
                                baseDirDraftByRepoId[repo.id] ??
                                repoWorktreeBaseDirsByRepoId[repo.id] ??
                                globalWorktreeBaseDir
                              }
                              onChange={(event) => {
                                const value = event.target.value;
                                setBaseDirDraftByRepoId((current) => ({
                                  ...current,
                                  [repo.id]: value,
                                }));
                              }}
                              aria-label={`Worktree base path for ${repo.name}`}
                              disabled={isStartupSaving}
                            />
                            <div className="mt-2 flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="secondary"
                                className="text-[11px]"
                                data-testid="repo-save-workspace-basedir-btn"
                                onClick={() => {
                                  const dir =
                                    baseDirDraftByRepoId[repo.id] ??
                                    repoWorktreeBaseDirsByRepoId[repo.id] ??
                                    globalWorktreeBaseDir;
                                  runStartupSave(repo.id, () =>
                                    onSetRepoWorktreeBaseDir(repo.id, dir),
                                  );
                                }}
                                disabled={isStartupSaving}
                              >
                                Save workspace
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                className="text-[11px]"
                                data-testid="repo-save-global-basedir-btn"
                                onClick={() => {
                                  const dir =
                                    baseDirDraftByRepoId[repo.id] ??
                                    repoWorktreeBaseDirsByRepoId[repo.id] ??
                                    globalWorktreeBaseDir;
                                  runStartupSave(repo.id, () =>
                                    onSetGlobalWorktreeBaseDir(dir),
                                  );
                                }}
                                disabled={
                                  isStartupSaving || isGlobalStartupSaving
                                }
                              >
                                {isGlobalStartupSaving
                                  ? "Saving global..."
                                  : "Save global"}
                              </Button>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="mt-2 w-full text-[11px] border border-surface0"
                              data-testid="repo-use-global-basedir-btn"
                              disabled={
                                isStartupSaving ||
                                !Object.prototype.hasOwnProperty.call(
                                  repoWorktreeBaseDirsByRepoId,
                                  repo.id,
                                )
                              }
                              onClick={() => {
                                runStartupSave(repo.id, async () => {
                                  await onSetRepoWorktreeBaseDir(repo.id, null);
                                  setBaseDirDraftByRepoId((current) => ({
                                    ...current,
                                    [repo.id]: globalWorktreeBaseDir,
                                  }));
                                });
                              }}
                            >
                              {isStartupSaving
                                ? "Saving..."
                                : "Use global default"}
                            </Button>

                            <div className="my-3 h-px bg-surface0" />

                            <p className="text-[11px] uppercase tracking-wide text-subtext1/80">
                              Attention profiles
                            </p>
                            <div className="mt-2 space-y-2">
                              {attentionProfilesDraft.map((profile, index) => {
                                const regexValue = profile.prompt_regex ?? "";
                                const regexResult = regexValue.trim()
                                  ? compilePromptRegex(regexValue)
                                  : null;
                                const regexError = regexResult && !regexResult.ok ? regexResult.error : null;

                                return (
                                  <div
                                    key={profile.id}
                                    className="rounded-sm border border-surface0 px-2 py-2"
                                  >
                                    <p className="text-[11px] text-text font-medium">{profile.name}</p>
                                    <Input
                                      type="text"
                                      className="mt-1"
                                      data-testid={`attention-regex-input-${profile.id}`}
                                      value={regexValue}
                                      placeholder="Prompt regex (empty uses built-in)"
                                      onChange={(event) => {
                                        const nextRegex = event.target.value;
                                        setAttentionProfilesDraft((current) => {
                                          const next = [...current];
                                          next[index] = {
                                            ...next[index],
                                            prompt_regex: nextRegex.trim() ? nextRegex : null
                                          };
                                          return next;
                                        });
                                      }}
                                      aria-label={`Prompt regex for ${profile.name}`}
                                    />
                                    <Select
                                      className="mt-1"
                                      value={profile.attention_mode}
                                      onChange={(value) => {
                                        const mode = value as AttentionMode;
                                        setAttentionProfilesDraft((current) => {
                                          const next = [...current];
                                          next[index] = {
                                            ...next[index],
                                            attention_mode: mode
                                          };
                                          return next;
                                        });
                                      }}
                                      options={[
                                        { value: "off", label: "Off" },
                                        { value: "attention", label: "Attention" },
                                        {
                                          value: "attention+notification",
                                          label: "Attention + OS Notification"
                                        }
                                      ]}
                                    />
                                    <Input
                                      type="number"
                                      className="mt-1"
                                      value={String(profile.debounce_ms)}
                                      min={50}
                                      max={2000}
                                      onChange={(event) => {
                                        const parsed = Number(event.target.value);
                                        const debounceMs = Number.isFinite(parsed)
                                          ? Math.max(50, Math.min(2000, Math.round(parsed)))
                                          : 300;
                                        setAttentionProfilesDraft((current) => {
                                          const next = [...current];
                                          next[index] = {
                                            ...next[index],
                                            debounce_ms: debounceMs
                                          };
                                          return next;
                                        });
                                      }}
                                      aria-label={`Debounce milliseconds for ${profile.name}`}
                                    />
                                    {regexError ? (
                                      <p className="mt-1 text-[10px] text-red">{regexError}</p>
                                    ) : null}
                                  </div>
                                );
                              })}

                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="text-[11px]"
                                  data-testid="attention-save-global-btn"
                                  onClick={() => {
                                    const invalid = attentionProfilesDraft.some((profile) => {
                                      if (!profile.prompt_regex || !profile.prompt_regex.trim()) {
                                        return false;
                                      }
                                      const compiled = compilePromptRegex(profile.prompt_regex);
                                      return !compiled.ok;
                                    });

                                    if (invalid) {
                                      return;
                                    }

                                    setAttentionSaving(true);
                                    setAttentionSaveError(null);
                                    void onSetAttentionProfiles(attentionProfilesDraft)
                                      .catch(() => {
                                        setAttentionSaveError("Unable to save attention profiles.");
                                      })
                                      .finally(() => {
                                        setAttentionSaving(false);
                                      });
                                  }}
                                  disabled={attentionSaving || attentionProfilesDraft.some((profile) => {
                                    if (!profile.prompt_regex || !profile.prompt_regex.trim()) {
                                      return false;
                                    }
                                    const compiled = compilePromptRegex(profile.prompt_regex);
                                    return !compiled.ok;
                                  })}
                                >
                                  {attentionSaving ? "Saving..." : "Save global"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="text-[11px]"
                                  data-testid="attention-reset-defaults-btn"
                                  onClick={() => {
                                    setAttentionProfilesDraft(DEFAULT_ATTENTION_PROFILES);
                                  }}
                                  disabled={attentionSaving}
                                >
                                  Reset to defaults
                                </Button>
                              </div>
                              {attentionSaveError ? (
                                <p className="text-[11px] text-red">{attentionSaveError}</p>
                              ) : null}
                            </div>
                          </div>

                          <div className="my-1 h-px bg-surface0" />

                          <Button
                            variant="danger"
                            size="sm"
                            className="w-full justify-start px-2 py-1.5 text-xs bg-transparent border-none"
                            data-testid="remove-repo-btn"
                            onClick={() => {
                              setConfigRepoId(null);
                              void handleRemoveRepo(repo.id);
                            }}
                            aria-label={`Remove ${repo.name}`}
                          >
                            Remove workspace
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {expanded && (
                    <div className="space-y-0.5">
                      {worktrees.map((worktree: WorktreeInfo) => {
                        const selected =
                          selectedRepoId === repo.id &&
                          selectedWorktreePath === worktree.path;

                        return (
                          <div key={worktree.path} className="relative">
                            {selected && (
                              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-blue" />
                            )}
                            <button
                              type="button"
                              data-testid="worktree-item"
                              className={`w-full text-left px-3 py-2 rounded-sm text-sm truncate transition-colors cursor-pointer group/wt ${
                                selected
                                  ? "bg-surface0/50 text-text"
                                  : "text-subtext1 hover:bg-surface0/30 hover:text-text"
                              }`}
                              onClick={() => {
                                onSelectWorktree(repo.id, worktree.path);
                                onRequestClose();
                              }}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="shrink-0 w-4 flex items-center justify-center">
                                    <GitBranch
                                      size={14}
                                      className={
                                        selected
                                          ? "text-blue"
                                          : "text-subtext1/50 group-hover/wt:text-text/50"
                                      }
                                    />
                                  </div>
                                  <div className="flex flex-col min-w-0">
                                    <span className="font-medium truncate text-[13px] leading-tight text-text">
                                      {worktree.branch?.replace(
                                        "refs/heads/",
                                        "",
                                      ) || worktree.head.slice(0, 7)}
                                    </span>
                                    <span className="text-[10px] text-subtext1/60 truncate font-mono leading-tight">
                                      {worktree.path.split("/").pop()}
                                    </span>
                                  </div>
                                </div>
                                <div className={`shrink-0 flex items-center transition-opacity ${removingWorktrees.has(worktree.path) ? "opacity-100" : "opacity-0 group-hover/wt:opacity-100"}`}>
                                  {removingWorktrees.has(worktree.path) ? (
                                    <div className="h-6 w-6 flex items-center justify-center text-subtext1">
                                      <Loader2 size={12} className="animate-spin" />
                                    </div>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 hover:text-red hover:bg-red/10"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void handleRemoveWorktree(repo.path, worktree.path);
                                      }}
                                      aria-label="Remove worktree"
                                      title="Remove worktree"
                                    >
                                      <Trash size={12} />
                                    </Button>
                                  )}
                                </div>
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

      <CreateWorktreeModal
        isOpen={createWorktreeRepoId !== null}
        onClose={() => setCreateWorktreeRepoId(null)}
        repoPath={repos.find((r) => r.id === createWorktreeRepoId)?.path || ""}
        baseDir={
          createWorktreeRepoId
            ? repoWorktreeBaseDirsByRepoId[createWorktreeRepoId] ?? globalWorktreeBaseDir ?? ""
            : ""
        }
      />

      <Modal
        isOpen={forceRemovePrompt !== null}
        onClose={() => setForceRemovePrompt(null)}
        title="Uncommitted Changes"
        maxWidth="max-w-md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setForceRemovePrompt(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (forceRemovePrompt) {
                  void handleRemoveWorktree(forceRemovePrompt.repoPath, forceRemovePrompt.worktreePath, true);
                }
              }}
            >
              Force Remove
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-text">
            {forceRemovePrompt?.changes ? "This worktree contains uncommitted files:" : "Failed to remove worktree. It might have uncommitted changes or be unclean."}
          </p>
          
          {forceRemovePrompt?.changes ? (
            <div className="max-h-48 overflow-y-auto border border-surface0 rounded-sm bg-mantle p-2 space-y-1">
              {forceRemovePrompt.changes.map((file, i) => (
                <div key={i} className="flex items-center gap-2 text-xs font-mono">
                  <span className={`w-3 text-center shrink-0 ${file.status === 'Modified' ? 'text-blue' : file.status === 'Added' || file.status === 'Untracked' ? 'text-green' : file.status === 'Deleted' ? 'text-red' : 'text-subtext1'}`}>
                    {file.status === 'Modified' ? 'M' : file.status === 'Added' ? 'A' : file.status === 'Untracked' ? 'U' : file.status === 'Deleted' ? 'D' : file.status.charAt(0)}
                  </span>
                  <span className="text-subtext1 truncate" title={file.path}>{file.path}</span>
                </div>
              ))}
            </div>
          ) : forceRemovePrompt?.error ? (
            <div className="p-2 text-xs text-red bg-red/10 border border-red/20 rounded-sm font-mono whitespace-pre-wrap break-all">
              {forceRemovePrompt.error}
            </div>
          ) : null}

          <p className="text-sm text-text">
            Do you want to force remove it?
          </p>
        </div>
      </Modal>
    </aside>
  );
}
