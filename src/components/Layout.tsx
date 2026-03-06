import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from "react";

import ChangesPane from "./ChangesPane";
import { useAppState } from "../hooks/useAppState";
import { createReposClient } from "../hooks/useRepos";
import RepoPane from "./RepoPane";
import TerminalPane from "./TerminalPane";

const SPLITTER_PX = 4;
const MIN_LEFT_PX = 200;
const MIN_RIGHT_PX = 200;
const MIN_MIDDLE_PX = 300;

const DEFAULT_LEFT_PX = 320;
const DEFAULT_RIGHT_PX = 320;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type DragTarget = "left" | "right";

type DragState = {
  target: DragTarget;
  startX: number;
  startLeft: number;
  startRight: number;
};

export default function Layout() {
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const startupConfigMutatedRef = useRef(false);
  const globalStartupSaveInFlightRef = useRef(false);
  const reposClient = useMemo(() => createReposClient(), []);

  const [leftPx, setLeftPx] = useState(DEFAULT_LEFT_PX);
  const [rightPx, setRightPx] = useState(DEFAULT_RIGHT_PX);
  const [isDragging, setIsDragging] = useState(false);

  const [repoOpen, setRepoOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [startupConfigLoaded, setStartupConfigLoaded] = useState(false);
  const [startupConfigError, setStartupConfigError] = useState<string | null>(null);
  const [isGlobalStartupSaving, setIsGlobalStartupSaving] = useState(false);
  const [globalTerminalStartupCommand, setGlobalTerminalStartupCommand] = useState<string | null>(null);
  const [repoTerminalStartupByRepoId, setRepoTerminalStartupByRepoId] = useState<Record<string, string>>({});
  
  const [globalWorktreeBaseDir, setGlobalWorktreeBaseDir] = useState<string | null>(null);
  const [repoWorktreeBaseDirsByRepoId, setRepoWorktreeBaseDirsByRepoId] = useState<Record<string, string>>({});

  const {
    state,
    addRepository,
    removeRepository,
    selectWorktree,
    setWorktrees,
    clearNotification
  } = useAppState();

  const normalizeConfigValue = useCallback((command: string | null) => {
    if (command === null) return null;

    const singleLine = command.replace(/[\r\n]+/g, " ");
    const trimmed = singleLine.trim();
    return trimmed.length > 0 ? trimmed : null;
  }, []);

  useEffect(() => {
    let active = true;

    async function loadConfig() {
      try {
        const [globalCommand, repoCommands, globalBaseDir, repoBaseDirs] = await Promise.all([
          reposClient.getGlobalTerminalStartupCommand(),
          reposClient.listRepoTerminalStartupCommands(),
          reposClient.getGlobalWorktreeBaseDir(),
          reposClient.listRepoWorktreeBaseDirs()
        ]);

        if (!active) return;
        if (!startupConfigMutatedRef.current) {
          setGlobalTerminalStartupCommand(normalizeConfigValue(globalCommand));
          setRepoTerminalStartupByRepoId(
            Object.fromEntries(
              Object.entries(repoCommands)
                .map(([repoId, command]) => [repoId, normalizeConfigValue(command)])
              .filter((entry): entry is [string, string] => entry[1] !== null)
            )
          );
          
          setGlobalWorktreeBaseDir(normalizeConfigValue(globalBaseDir));
          setRepoWorktreeBaseDirsByRepoId(
            Object.fromEntries(
              Object.entries(repoBaseDirs)
                .map(([repoId, dir]) => [repoId, normalizeConfigValue(dir)])
              .filter((entry): entry is [string, string] => entry[1] !== null)
            )
          );
        }
        setStartupConfigError(null);
      } catch {
        if (active) {
          setStartupConfigError(
            "Unable to load configuration. Using defaults until settings are saved again."
          );
        }
      } finally {
        if (active) {
          setStartupConfigLoaded(true);
        }
      }
    }

    void loadConfig();

    return () => {
      active = false;
    };
  }, [reposClient, normalizeConfigValue]);

  useEffect(() => {
    const repoIdSet = new Set(state.repos.map((repo) => repo.id));
    setRepoTerminalStartupByRepoId((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([repoId]) => repoIdSet.has(repoId))
      );

      if (Object.keys(next).length === Object.keys(current).length) {
        return current;
      }

      return next;
    });
    
    setRepoWorktreeBaseDirsByRepoId((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([repoId]) => repoIdSet.has(repoId))
      );

      if (Object.keys(next).length === Object.keys(current).length) {
        return current;
      }

      return next;
    });
  }, [state.repos]);

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || !layoutRef.current) return;

      const deltaX = event.clientX - drag.startX;
      const totalWidth = layoutRef.current.clientWidth;

      if (drag.target === "left") {
        const maxLeft = totalWidth - rightPx - SPLITTER_PX * 2 - MIN_MIDDLE_PX;
        const nextLeft = clamp(drag.startLeft + deltaX, MIN_LEFT_PX, maxLeft);
        setLeftPx(nextLeft);
      } else {
        const maxRight = totalWidth - leftPx - SPLITTER_PX * 2 - MIN_MIDDLE_PX;
        const nextRight = clamp(drag.startRight - deltaX, MIN_RIGHT_PX, maxRight);
        setRightPx(nextRight);
      }
    },
    [leftPx, rightPx]
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
    document.body.classList.remove("wbNoSelect");
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", endDrag);
  }, [handleMouseMove]);

  function beginDrag(target: DragTarget, event: ReactMouseEvent) {
    event.preventDefault();

    dragRef.current = {
      target,
      startX: event.clientX,
      startLeft: leftPx,
      startRight: rightPx
    };

    setIsDragging(true);
    document.body.classList.add("wbNoSelect");
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", endDrag);
  }

  const gridTemplate = useMemo(() => {
    return `${leftPx}px ${SPLITTER_PX}px 1fr ${SPLITTER_PX}px ${rightPx}px`;
  }, [leftPx, rightPx]);

  const closeOverlays = () => {
    setRepoOpen(false);
    setChangesOpen(false);
  };

  const selectedWorktree = useMemo(() => {
    if (!state.selectedWorktreePath || !state.selectedRepoId) return null;
    const worktrees = state.worktreesByRepoId[state.selectedRepoId] || [];
    return worktrees.find((w) => w.path === state.selectedWorktreePath) || null;
  }, [state.selectedWorktreePath, state.selectedRepoId, state.worktreesByRepoId]);

  const selectedRepoStartupCommand =
    state.selectedRepoId !== null ? repoTerminalStartupByRepoId[state.selectedRepoId] ?? null : null;
  const resolvedStartupCommand = selectedRepoStartupCommand ?? globalTerminalStartupCommand;

  return (
    <div className={`relative h-full w-full overflow-hidden ${isDragging ? "cursor-col-resize select-none" : ""}`}>
      {/* Backdrop for mobile */}
      <div
        className={`fixed inset-0 bg-crust/60 z-40 md:hidden transition-opacity ${
          repoOpen || changesOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onMouseDown={closeOverlays}
        aria-hidden="true"
      />
      <div
        ref={layoutRef}
        className="h-full w-full grid bg-base"
        style={{ gridTemplateColumns: gridTemplate, gridTemplateRows: "minmax(0, 1fr)" }}
      >
        <RepoPane
          mobileOpen={repoOpen}
          onRequestClose={() => setRepoOpen(false)}
          repos={state.repos}
          selectedRepoId={state.selectedRepoId}
          selectedWorktreePath={state.selectedWorktreePath}
          worktreesByRepoId={state.worktreesByRepoId}
          notification={state.notification}
          startupConfigError={startupConfigError}
          onAddRepo={addRepository}
          onRemoveRepo={removeRepository}
          onSelectWorktree={selectWorktree}
          onWorktreesChanged={setWorktrees}
          onDismissNotification={clearNotification}
          isGlobalStartupSaving={isGlobalStartupSaving}
          globalStartupCommand={globalTerminalStartupCommand ?? ""}
          repoStartupCommandsByRepoId={repoTerminalStartupByRepoId}
          onSetRepoStartupCommand={async (repoId: string, command: string | null) => {
            startupConfigMutatedRef.current = true;
            const normalized = normalizeConfigValue(command);
            const globalNormalized = normalizeConfigValue(globalTerminalStartupCommand);
            const nextRepoOverride = normalized === globalNormalized ? null : normalized;

            await reposClient.setRepoTerminalStartupCommand(repoId, nextRepoOverride);
            setRepoTerminalStartupByRepoId((current) => {
              const next = { ...current };
              if (nextRepoOverride === null) {
                delete next[repoId];
              } else {
                next[repoId] = nextRepoOverride;
              }
              return next;
            });
            setStartupConfigError(null);
          }}
          onSetGlobalStartupCommand={async (command: string | null) => {
            if (globalStartupSaveInFlightRef.current) {
              return;
            }

            globalStartupSaveInFlightRef.current = true;
            setIsGlobalStartupSaving(true);
            startupConfigMutatedRef.current = true;
            const normalized = normalizeConfigValue(command);
            try {
              await reposClient.setGlobalTerminalStartupCommand(normalized);
              setGlobalTerminalStartupCommand(normalized);
              setStartupConfigError(null);
            } finally {
              globalStartupSaveInFlightRef.current = false;
              setIsGlobalStartupSaving(false);
            }
          }}
          globalWorktreeBaseDir={globalWorktreeBaseDir ?? ""}
          repoWorktreeBaseDirsByRepoId={repoWorktreeBaseDirsByRepoId}
          onSetRepoWorktreeBaseDir={async (repoId: string, dir: string | null) => {
            startupConfigMutatedRef.current = true;
            const normalized = normalizeConfigValue(dir);
            const globalNormalized = normalizeConfigValue(globalWorktreeBaseDir);
            const nextOverride = normalized === globalNormalized ? null : normalized;

            await reposClient.setRepoWorktreeBaseDir(repoId, nextOverride);
            setRepoWorktreeBaseDirsByRepoId(current => {
              const next = { ...current };
              if (nextOverride === null) delete next[repoId];
              else next[repoId] = nextOverride;
              return next;
            });
            setStartupConfigError(null);
          }}
          onSetGlobalWorktreeBaseDir={async (dir: string | null) => {
            startupConfigMutatedRef.current = true;
            const normalized = normalizeConfigValue(dir);
            await reposClient.setGlobalWorktreeBaseDir(normalized);
            setGlobalWorktreeBaseDir(normalized);
            setStartupConfigError(null);
          }}
        />

        <div
          className="wbSplitter hidden md:block"
          onMouseDown={(e) => beginDrag("left", e)}
        />

        <TerminalPane
          repoOpen={repoOpen}
          changesOpen={changesOpen}
          onToggleRepo={() => setRepoOpen(!repoOpen)}
          onToggleChanges={() => setChangesOpen(!changesOpen)}
          selectedWorktreePath={state.selectedWorktreePath}
          selectedWorktree={selectedWorktree}
          startupCommand={resolvedStartupCommand}
          startupConfigReady={startupConfigLoaded}
        />

        <div
          className="wbSplitter hidden md:block"
          onMouseDown={(e) => beginDrag("right", e)}
        />

        <ChangesPane
          mobileOpen={changesOpen}
          onRequestClose={() => setChangesOpen(false)}
          selectedWorktreePath={state.selectedWorktreePath}
        />
      </div>
    </div>
  );
}
