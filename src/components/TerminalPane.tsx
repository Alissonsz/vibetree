import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { X, Plus, SquareTerminal } from "lucide-react";

import { createTerminalClient } from "../hooks/useTerminal";
import { useWindowFocus } from "../hooks/useWindowFocus";
import TerminalInstance from "./TerminalInstance";
import type { AttentionProfile, AttentionRuntimeCapability, WorktreeInfo } from "../types";
import { getProfileById } from "../terminal/attentionProfiles";
import { signalAttention, syncAttentionBadgeCount } from "../terminal/attentionSignals";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Select } from "./ui/Select";

type TerminalPaneProps = {
  repoOpen: boolean;
  changesOpen: boolean;
  onToggleRepo: () => void;
  onToggleChanges: () => void;
  selectedWorktreePath: string | null;
  selectedWorktree: WorktreeInfo | null;
  startupCommand: string | null;
  startupConfigReady: boolean;
  attentionProfiles: AttentionProfile[];
  attentionRuntimeCapability: AttentionRuntimeCapability;
  worktreeDefaultAttentionProfileByPath: Record<string, string>;
  onSetWorktreeDefaultAttentionProfile: (worktreePath: string, profileId: string | null) => Promise<void>;
};

type SessionState = {
  sessionId: string;
  initialTitle: string;
};

type SessionsByWorktree = Record<string, SessionState[]>;

export default function TerminalPane({
  repoOpen,
  changesOpen,
  onToggleRepo,
  onToggleChanges,
  selectedWorktreePath,
  selectedWorktree,
  startupCommand,
  startupConfigReady,
  attentionProfiles,
  attentionRuntimeCapability,
  worktreeDefaultAttentionProfileByPath,
  onSetWorktreeDefaultAttentionProfile
}: TerminalPaneProps) {
  const terminalClient = useMemo(() => createTerminalClient(), []);
  const windowFocused = useWindowFocus();

  const [sessionsByWorktree, setSessionsByWorktree] = useState<SessionsByWorktree>({});
  const [activeSessionIdByWorktree, setActiveSessionIdByWorktree] = useState<Record<string, string>>({});
  const [dynamicTitles, setDynamicTitles] = useState<Record<string, string>>({});
  const [sessionProfileOverrideById, setSessionProfileOverrideById] = useState<Record<string, string | "off">>({});
  const [needsAttentionBySessionId, setNeedsAttentionBySessionId] = useState<Record<string, boolean>>({});
  const [startupCommandAtCreateBySessionId, setStartupCommandAtCreateBySessionId] = useState<Record<string, string | null>>({});
  const [attentionRuntimeWarning, setAttentionRuntimeWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionsRef = useRef<SessionsByWorktree>({});

  useEffect(() => {
    sessionsRef.current = sessionsByWorktree;
  }, [sessionsByWorktree]);

  const findWorktreePathBySessionId = useCallback((sessionId: string): string | null => {
    for (const [worktreePath, sessions] of Object.entries(sessionsByWorktree)) {
      if (sessions.some((session) => session.sessionId === sessionId)) {
        return worktreePath;
      }
    }
    return null;
  }, [sessionsByWorktree]);

  const resolveProfileId = useCallback(
    (sessionId: string, sessionWorktreePath: string | null): string | null => {
      const override = sessionProfileOverrideById[sessionId];
      if (override) {
        return override === "off" ? null : override;
      }

      if (sessionWorktreePath && worktreeDefaultAttentionProfileByPath[sessionWorktreePath]) {
        return worktreeDefaultAttentionProfileByPath[sessionWorktreePath];
      }

      const startup = startupCommandAtCreateBySessionId[sessionId] ?? null;
      if (startup && /\bopencode\b/i.test(startup)) {
        return "opencode";
      }

      return null;
    },
    [sessionProfileOverrideById, startupCommandAtCreateBySessionId, worktreeDefaultAttentionProfileByPath]
  );

  const resolveAttentionProfile = useCallback(
    (sessionId: string): AttentionProfile | null => {
      const worktreePath = findWorktreePathBySessionId(sessionId);
      const profileId = resolveProfileId(sessionId, worktreePath);
      return getProfileById(attentionProfiles, profileId);
    },
    [attentionProfiles, findWorktreePathBySessionId, resolveProfileId]
  );

  const createSession = useCallback(
    async (worktreePath: string, branchName?: string) => {
      setError(null);
      try {
        const sessionId = await terminalClient.createSession(
          worktreePath,
          startupCommand
        );
        const initialTitle = branchName?.replace("refs/heads/", "") || "Terminal";

        setSessionsByWorktree((prev) => {
          const existing = prev[worktreePath] || [];
          return {
            ...prev,
            [worktreePath]: [...existing, { sessionId, initialTitle }]
          };
        });
        setStartupCommandAtCreateBySessionId((prev) => ({
          ...prev,
          [sessionId]: startupCommand
        }));
        setActiveSessionIdByWorktree((prev) => ({
          ...prev,
          [worktreePath]: sessionId
        }));
      } catch {
        setError("Unable to start terminal session.");
      }
    },
    [startupCommand, terminalClient]
  );

  useEffect(() => {
    if (!startupConfigReady || !selectedWorktreePath || !selectedWorktree) return;

    const existingSessions = sessionsRef.current[selectedWorktreePath];
    if (!existingSessions || existingSessions.length === 0) {
      void createSession(selectedWorktreePath, selectedWorktree.branch || undefined);
    }
  }, [startupConfigReady, selectedWorktreePath, selectedWorktree, createSession]);

  const activeSessionId = selectedWorktreePath ? activeSessionIdByWorktree[selectedWorktreePath] : null;

  useEffect(() => {
    if (!windowFocused || !activeSessionId) {
      return;
    }

    setNeedsAttentionBySessionId((prev) => {
      if (!prev[activeSessionId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[activeSessionId];
      return next;
    });
  }, [activeSessionId, windowFocused]);

  useEffect(() => {
    const unreadCount = Object.values(needsAttentionBySessionId).filter(Boolean).length;
    void syncAttentionBadgeCount(unreadCount);
  }, [needsAttentionBySessionId]);

  const clearSessionAttention = useCallback((sessionId: string) => {
    setNeedsAttentionBySessionId((prev) => {
      if (!prev[sessionId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);

  const handlePromptReady = useCallback(
    (sessionId: string) => {
      if (windowFocused && sessionId === activeSessionId) {
        return;
      }

      const profile = resolveAttentionProfile(sessionId);
      if (!profile || profile.attention_mode === "off") {
        return;
      }

      const withNotification = profile.attention_mode === "attention+notification";
      setNeedsAttentionBySessionId((prev) => {
        if (prev[sessionId]) {
          return prev;
        }
        const next = { ...prev, [sessionId]: true };
        const unreadCount = Object.values(next).filter(Boolean).length;
        void signalAttention(unreadCount, withNotification);
        return next;
      });
    },
    [activeSessionId, resolveAttentionProfile, windowFocused]
  );

  const handleCloseSession = useCallback(
    async (worktreePath: string, sessionIdToClose: string) => {
      try {
        await terminalClient.closeSession(sessionIdToClose);
      } catch {
        setError("Unable to close terminal session.");
      }

      setSessionsByWorktree((prev) => {
        const existing = prev[worktreePath] || [];
        const next = existing.filter((s) => s.sessionId !== sessionIdToClose);
        return { ...prev, [worktreePath]: next };
      });

      setActiveSessionIdByWorktree((prev) => {
        const currentActiveId = prev[worktreePath];
        if (currentActiveId !== sessionIdToClose) return prev;

        const existing = sessionsRef.current[worktreePath] || [];
        const closedIndex = existing.findIndex((s) => s.sessionId === sessionIdToClose);

        let nextActiveId = existing.length > 1 ? existing[0].sessionId : undefined;
        if (closedIndex > 0) {
          nextActiveId = existing[closedIndex - 1].sessionId;
        } else if (closedIndex === 0 && existing.length > 1) {
          nextActiveId = existing[1].sessionId;
        }

        const nextMap = { ...prev };
        if (nextActiveId) {
          nextMap[worktreePath] = nextActiveId;
        } else {
          delete nextMap[worktreePath];
        }
        return nextMap;
      });

      setDynamicTitles((prev) => {
        const next = { ...prev };
        delete next[sessionIdToClose];
        return next;
      });

      setSessionProfileOverrideById((prev) => {
        const next = { ...prev };
        delete next[sessionIdToClose];
        return next;
      });

      setStartupCommandAtCreateBySessionId((prev) => {
        const next = { ...prev };
        delete next[sessionIdToClose];
        return next;
      });

      clearSessionAttention(sessionIdToClose);
    },
    [clearSessionAttention, terminalClient]
  );

  const worktreeSessions = selectedWorktreePath ? (sessionsByWorktree[selectedWorktreePath] || []) : [];
  const allSessions = Object.values(sessionsByWorktree).flat();

  const handleTitleChange = useCallback((sessionId: string, newTitle: string) => {
    if (newTitle && newTitle.trim()) {
      if (
        newTitle.includes("@") ||
        newTitle.includes(":") ||
        newTitle.startsWith("~") ||
        newTitle.includes("/")
      ) {
        setDynamicTitles((prev) => {
          if (!prev[sessionId]) return prev;
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
        return;
      }

      setDynamicTitles((prev) => {
        if (prev[sessionId] === newTitle) return prev;
        return { ...prev, [sessionId]: newTitle };
      });
    }
  }, []);

  const activeSessionAttentionValue = useMemo(() => {
    if (!activeSessionId) {
      return "off";
    }
    const worktreePath = findWorktreePathBySessionId(activeSessionId);
    const profileId = resolveProfileId(activeSessionId, worktreePath);
    return profileId ?? "off";
  }, [activeSessionId, findWorktreePathBySessionId, resolveProfileId]);

  const profileOptions = useMemo(
    () => [
      { value: "off", label: "Off" },
      ...attentionProfiles.map((profile) => ({
        value: profile.id,
        label: profile.name
      }))
    ],
    [attentionProfiles]
  );

  const handleAttentionProfileChange = useCallback(
    async (value: string) => {
      if (!activeSessionId || !selectedWorktreePath) {
        return;
      }

      if (value !== "off" && !attentionRuntimeCapability.supported) {
        setAttentionRuntimeWarning(
          attentionRuntimeCapability.reason ??
            "This runtime session may not support window attention blinking."
        );
      } else {
        setAttentionRuntimeWarning(null);
      }

      const normalized = value === "off" ? "off" : value;
      setSessionProfileOverrideById((prev) => ({
        ...prev,
        [activeSessionId]: normalized
      }));

      await onSetWorktreeDefaultAttentionProfile(
        selectedWorktreePath,
        value === "off" ? null : value
      );
    },
    [activeSessionId, attentionRuntimeCapability, onSetWorktreeDefaultAttentionProfile, selectedWorktreePath]
  );

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden bg-base"
      data-testid="terminal-pane"
      role="main"
      aria-label="Terminal"
    >
      <div className="flex-1 flex flex-col min-h-0 relative">
        <div className="md:hidden flex gap-2 p-2 absolute top-0 right-0 z-50">
          <Button
            size="sm"
            className={repoOpen ? "bg-blue border-blue text-base" : "bg-transparent border-surface0 text-subtext1"}
            onClick={onToggleRepo}
          >
            Repos
          </Button>
          <Button
            size="sm"
            className={changesOpen ? "bg-blue border-blue text-base" : "bg-transparent border-surface0 text-subtext1"}
            onClick={onToggleChanges}
          >
            Changes
          </Button>
        </div>

        {selectedWorktreePath && worktreeSessions.length > 0 ? (
          <div className="border-b border-surface0 bg-mantle" role="tablist">
            <div className="flex items-center">
            <div className="flex min-w-0 flex-1">
              {worktreeSessions.map((session) => {
                const isActive = session.sessionId === activeSessionId;
                const displayTitle = dynamicTitles[session.sessionId] || session.initialTitle;
                const needsAttention = !!needsAttentionBySessionId[session.sessionId];

                return (
                  <div
                    key={session.sessionId}
                    className={`flex items-center gap-3 px-4 py-2 border-r border-surface0 text-xs font-medium transition-colors group cursor-pointer ${
                      isActive
                        ? "bg-base text-text"
                        : "text-subtext1 hover:bg-surface0/30 hover:text-text"
                    }`}
                    data-testid="terminal-tab"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => {
                      setActiveSessionIdByWorktree((prev) => ({ ...prev, [selectedWorktreePath]: session.sessionId }));
                      clearSessionAttention(session.sessionId);
                    }}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        needsAttention
                          ? "bg-amber-400 animate-pulse"
                          : isActive
                            ? "bg-[#fab387]"
                            : "bg-surface2"
                      }`}
                      data-testid={needsAttention ? "terminal-attention-dot" : undefined}
                    />
                    <span className="truncate max-w-[160px]" title={displayTitle}>
                      {displayTitle}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 group-hover:opacity-100 w-4 h-4 p-0"
                      data-testid="close-terminal-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleCloseSession(selectedWorktreePath, session.sessionId);
                      }}
                    >
                      <X size={10} />
                    </Button>
                  </div>
                );
              })}
              <Button
                variant="ghost"
                className="px-3 py-2 border-r border-surface0 h-full rounded-none group"
                onClick={() => void createSession(selectedWorktreePath, selectedWorktree?.branch || undefined)}
                title="New Terminal"
                disabled={!startupConfigReady}
              >
                <div className="bg-surface0/50 group-hover:bg-surface1 p-1 rounded-sm w-5 h-5 flex items-center justify-center transition-colors">
                  <Plus size={12} />
                </div>
              </Button>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 border-l border-surface0 min-w-[260px]">
              <span className="text-[11px] uppercase tracking-wide text-subtext1">Attention:</span>
              <Select
                value={activeSessionAttentionValue}
                onChange={(value) => {
                  void handleAttentionProfileChange(value);
                }}
                options={profileOptions}
                className="w-full"
                disabled={!activeSessionId}
              />
            </div>
          </div>
            {attentionRuntimeWarning ? (
              <div className="px-3 pb-2">
                <Card variant="warning" className="text-xs" data-testid="attention-runtime-warning">
                  {attentionRuntimeWarning}
                </Card>
              </div>
            ) : null}
          </div>
        ) : null}

        {!selectedWorktreePath ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-base">
            <SquareTerminal size={48} className="text-surface1 mb-4" />
            <h3 className="text-text font-medium mb-1">No workspace selected</h3>
            <p className="text-subtext1 text-sm">Select a workspace from the sidebar to open a terminal.</p>
          </div>
        ) : null}

        {selectedWorktreePath && worktreeSessions.length === 0 && !error ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-subtext1 text-sm bg-base">
            <div className="w-12 h-12 border-2 border-surface1 border-t-blue animate-spin rounded-full" />
            Starting terminal session...
          </div>
        ) : null}

        <div className="flex-1 min-h-0 relative bg-base">
          {allSessions.map((session) => (
            <TerminalInstance
              key={session.sessionId}
              sessionId={session.sessionId}
              isActive={session.sessionId === activeSessionId}
              onTitleChange={(title) => handleTitleChange(session.sessionId, title)}
              attentionProfile={resolveAttentionProfile(session.sessionId)}
              onPromptReady={handlePromptReady}
            />
          ))}
        </div>

        {error && (
          <div className="absolute bottom-4 left-4 right-4 z-50">
            <Card variant="error" className="shadow-lg">
              <p className="font-semibold mb-1">Terminal error</p>
              <p>{error}</p>
            </Card>
          </div>
        )}
      </div>
    </section>
  );
}
