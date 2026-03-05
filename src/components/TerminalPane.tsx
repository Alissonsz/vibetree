import { useEffect, useMemo, useRef, useState, useCallback } from "react";

import { createTerminalClient } from "../hooks/useTerminal";
import TerminalInstance from "./TerminalInstance";
import type { WorktreeInfo } from "../types";

type TerminalPaneProps = {
  repoOpen: boolean;
  changesOpen: boolean;
  onToggleRepo: () => void;
  onToggleChanges: () => void;
  selectedWorktreePath: string | null;
  selectedWorktree: WorktreeInfo | null;
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
  selectedWorktree
}: TerminalPaneProps) {
  const terminalClient = useMemo(() => createTerminalClient(), []);
  const [sessionsByWorktree, setSessionsByWorktree] = useState<SessionsByWorktree>({});
  const [activeSessionIdByWorktree, setActiveSessionIdByWorktree] = useState<Record<string, string>>({});
  const [dynamicTitles, setDynamicTitles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const sessionsRef = useRef<SessionsByWorktree>({});

  useEffect(() => {
    sessionsRef.current = sessionsByWorktree;
  }, [sessionsByWorktree]);

  const createSession = useCallback(
    async (worktreePath: string, branchName?: string) => {
      setError(null);
      try {
        const sessionId = await terminalClient.createSession(worktreePath);
        const initialTitle = branchName?.replace("refs/heads/", "") || "Terminal";
        
        setSessionsByWorktree((prev) => {
          const existing = prev[worktreePath] || [];
          return {
            ...prev,
            [worktreePath]: [...existing, { sessionId, initialTitle }]
          };
        });
        setActiveSessionIdByWorktree((prev) => ({
          ...prev,
          [worktreePath]: sessionId
        }));
      } catch {
        setError("Unable to start terminal session.");
      }
    },
    [terminalClient]
  );

  useEffect(() => {
    if (!selectedWorktreePath || !selectedWorktree) return;

    const existingSessions = sessionsRef.current[selectedWorktreePath];
    if (!existingSessions || existingSessions.length === 0) {
      void createSession(selectedWorktreePath, selectedWorktree.branch || undefined);
    }
  }, [selectedWorktreePath, selectedWorktree, createSession]);

  const activeSessionId = selectedWorktreePath ? activeSessionIdByWorktree[selectedWorktreePath] : null;

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
    },
    [terminalClient]
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

  return (
    <section
      className="flex flex-col bg-base h-full"
      data-testid="terminal-pane"
      role="main"
      aria-label="Terminal"
    >
      <div className="flex-1 flex flex-col min-h-0 relative">
        {/* Mobile Toggles */}
        <div className="md:hidden flex gap-2 p-2 absolute top-0 right-0 z-50">
          <button
            type="button"
            className={`px-3 py-1 text-xs rounded-md border ${
              repoOpen ? "bg-blue border-blue text-base" : "bg-transparent border-surface0 text-subtext1"
            }`}
            onClick={onToggleRepo}
          >
            Repos
          </button>
          <button
            type="button"
            className={`px-3 py-1 text-xs rounded-md border ${
              changesOpen ? "bg-blue border-blue text-base" : "bg-transparent border-surface0 text-subtext1"
            }`}
            onClick={onToggleChanges}
          >
            Changes
          </button>
        </div>

        {selectedWorktreePath && worktreeSessions.length > 0 ? (
          <div className="flex items-center border-b border-surface0 bg-mantle" role="tablist">
            {worktreeSessions.map((session) => {
              const isActive = session.sessionId === activeSessionId;
              const displayTitle = dynamicTitles[session.sessionId] || session.initialTitle;
              
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
                  onClick={() => setActiveSessionIdByWorktree((prev) => ({ ...prev, [selectedWorktreePath]: session.sessionId }))}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-[#fab387]' : 'bg-surface2'}`}></span>
                  <span className="truncate max-w-[160px]" title={displayTitle}>
                    {displayTitle}
                  </span>
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-4 h-4 rounded hover:bg-surface1 text-subtext1 hover:text-text transition-all"
                    data-testid="close-terminal-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleCloseSession(selectedWorktreePath, session.sessionId);
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="text-subtext1 hover:text-text px-3 py-2 flex items-center justify-center transition-colors border-r border-surface0"
              onClick={() => void createSession(selectedWorktreePath, selectedWorktree?.branch || undefined)}
              title="New Terminal"
            >
              <div className="bg-surface0/50 hover:bg-surface1 p-1 rounded-md text-[10px] w-5 h-5 flex items-center justify-center text-subtext1 hover:text-text">+</div>
            </button>
          </div>
        ) : null}

        {!selectedWorktreePath ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-base">
            <h3 className="text-text font-medium mb-1">No workspace selected</h3>
            <p className="text-subtext1 text-sm">Select a workspace from the sidebar to open a terminal.</p>
          </div>
        ) : null}

        {selectedWorktreePath && worktreeSessions.length === 0 && !error ? (
          <div className="flex-1 flex items-center justify-center text-subtext1 text-sm bg-base">
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
            />
          ))}
        </div>

        {error && (
          <div className="absolute bottom-4 left-4 right-4 bg-red/10 text-red p-3 rounded-md text-sm border border-red/20 shadow-lg z-50">
            <p className="font-semibold mb-1">Terminal error</p>
            <p>{error}</p>
          </div>
        )}
      </div>
    </section>
  );
}