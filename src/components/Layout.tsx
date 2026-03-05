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

  const [leftPx, setLeftPx] = useState(DEFAULT_LEFT_PX);
  const [rightPx, setRightPx] = useState(DEFAULT_RIGHT_PX);
  const [isDragging, setIsDragging] = useState(false);

  const [repoOpen, setRepoOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);

  const {
    state,
    addRepository,
    removeRepository,
    selectWorktree,
    setWorktrees,
    clearNotification
  } = useAppState();

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

  return (
    <div className={`relative h-full ${isDragging ? "cursor-col-resize select-none" : ""}`}>
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
        className="h-full grid bg-base"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <RepoPane
          mobileOpen={repoOpen}
          onRequestClose={() => setRepoOpen(false)}
          repos={state.repos}
          selectedRepoId={state.selectedRepoId}
          selectedWorktreePath={state.selectedWorktreePath}
          worktreesByRepoId={state.worktreesByRepoId}
          notification={state.notification}
          onAddRepo={addRepository}
          onRemoveRepo={removeRepository}
          onSelectWorktree={selectWorktree}
          onWorktreesChanged={setWorktrees}
          onDismissNotification={clearNotification}
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