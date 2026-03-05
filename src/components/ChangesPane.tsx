import { useCallback, useEffect, useMemo, useState } from "react";

import { createChangesClient } from "../hooks/useChanges";
import type { ChangedFile, FileStatus } from "../types";

type ChangesPaneProps = {
  mobileOpen: boolean;
  onRequestClose: () => void;
  selectedWorktreePath: string | null;
};

const STATUS_LABELS: Record<FileStatus, string> = {
  Added: "A",
  Deleted: "D",
  Modified: "M",
  Renamed: "R",
  Typechange: "T",
  Untracked: "?",
  Unmodified: " ",
};

export default function ChangesPane({
  mobileOpen,
  onRequestClose,
  selectedWorktreePath,
}: ChangesPaneProps) {
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changesClient = useMemo(() => createChangesClient(), []);

  const loadChanges = useCallback(async () => {
    if (!selectedWorktreePath) {
      setChangedFiles([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const files = await changesClient.getChangedFiles(selectedWorktreePath);
      setChangedFiles(files);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [selectedWorktreePath, changesClient]);

  useEffect(() => {
    void loadChanges();
  }, [loadChanges]);

  return (
    <aside
      id="wb-changes-pane"
      className={`flex h-full min-h-0 flex-col overflow-hidden bg-base border-l border-surface0 ${
        mobileOpen
          ? "fixed inset-y-0 right-0 w-4/5 z-50 shadow-2xl"
          : "hidden md:flex"
      }`}
      data-testid="changes-pane"
      role="complementary"
      aria-label="Changed files"
    >
      <div className="flex items-center justify-between p-4 mb-2">
        <div className="text-sm font-medium text-text">Review Changes</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-subtext1 hover:text-text text-xs flex items-center gap-1 transition-colors"
            data-testid="refresh-changes-btn"
            onClick={() => void loadChanges()}
            disabled={!selectedWorktreePath || isLoading}
            title="Refresh"
          >
            ↻
          </button>
          <button
            type="button"
            className="md:hidden text-subtext1 hover:text-text"
            onClick={onRequestClose}
            aria-label="Close changes pane"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 pb-4">
        {selectedWorktreePath && !isLoading && !error && (
          <div className="mb-6 space-y-2">
            <input
              type="text"
              placeholder="Commit message..."
              className="w-full bg-mantle border border-surface0 rounded-md px-3 py-2 text-sm text-text placeholder-subtext1 focus:outline-none focus:border-surface1 transition-colors"
            />
            <button className="w-full cursor-pointer bg-mantle hover:bg-surface0 border border-surface0 text-text rounded-md py-1.5 text-sm font-medium transition-colors flex items-center justify-center gap-2">
              ↑ Push
            </button>
          </div>
        )}

        {!selectedWorktreePath ? (
          <div className="p-4 text-subtext1 text-sm text-center">
            Select a workspace to load changed files.
          </div>
        ) : null}

        {selectedWorktreePath && isLoading ? (
          <div className="p-4 text-subtext1 text-sm text-center">
            Loading changed files...
          </div>
        ) : null}

        {selectedWorktreePath && !isLoading && error ? (
          <div
            className="bg-red/10 text-red p-3 rounded-md text-sm"
            role="alert"
          >
            <div className="font-semibold mb-1">Git status failed</div>
            <div>{error}</div>
          </div>
        ) : null}

        {selectedWorktreePath &&
        !isLoading &&
        !error &&
        changedFiles.length === 0 ? (
          <div className="p-4 text-subtext1 text-sm text-center">
            This workspace has a clean status.
          </div>
        ) : null}

        {selectedWorktreePath &&
        !isLoading &&
        !error &&
        changedFiles.length > 0 ? (
          <ul className="space-y-1" data-testid="changed-file-list">
            {changedFiles.map((file) => {
              const isAdded =
                file.status === "Added" || file.status === "Untracked";
              const isDeleted = file.status === "Deleted";
              const statusColor = isAdded
                ? "text-green"
                : isDeleted
                  ? "text-red"
                  : "text-text";

              return (
                <li
                  key={`${file.path}:${file.status}:${file.original_path ?? ""}`}
                  className="flex items-center justify-between px-2 py-1.5 hover:bg-surface0/30 rounded-md transition-colors group cursor-pointer"
                  data-testid="changed-file-item"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span
                      className={`text-[10px] font-mono font-bold w-3 text-center ${statusColor}`}
                      aria-label={file.status}
                    >
                      {STATUS_LABELS[file.status]}
                    </span>
                    <span className="text-sm text-subtext1 group-hover:text-text truncate transition-colors">
                      {file.path}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </aside>
  );
}
