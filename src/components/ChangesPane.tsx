import { useCallback, useEffect, useMemo, useState } from "react";

import { createChangesClient } from "../hooks/useChanges";
import type { ChangedFile, FileStatus } from "../types";

type ChangesPaneProps = {
  mobileOpen: boolean;
  onRequestClose: () => void;
  selectedWorktreePath: string | null;
};

type TreeNode = {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  children: TreeNode[];
  file?: ChangedFile;
};

const STATUS_LABELS: Record<FileStatus, string> = {
  Added: "A",
  Copied: "C",
  Deleted: "D",
  Ignored: "!",
  Modified: "M",
  Renamed: "R",
  Typechange: "T",
  Untracked: "?",
  Unmodified: " ",
  UpdatedButUnmerged: "U",
};

export default function ChangesPane({
  mobileOpen,
  onRequestClose,
  selectedWorktreePath,
}: ChangesPaneProps) {
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(
    () => new Set()
  );

  const changesClient = useMemo(() => createChangesClient(), []);

  const tree = useMemo(() => {
    type TreeNodeInternal = {
      name: string;
      fullPath: string;
      isDirectory: boolean;
      children: TreeNodeInternal[];
      childrenByName: Map<string, TreeNodeInternal>;
      file?: ChangedFile;
    };

    const getSegments = (path: string) => path.split("/").filter(Boolean);

    const root: TreeNodeInternal = {
      name: "",
      fullPath: "",
      isDirectory: true,
      children: [],
      childrenByName: new Map(),
    };

    const ensureDirectory = (
      parent: TreeNodeInternal,
      name: string,
      fullPath: string
    ) => {
      const existing = parent.childrenByName.get(name);
      if (existing && existing.isDirectory) return existing;

      const node: TreeNodeInternal = {
        name,
        fullPath,
        isDirectory: true,
        children: [],
        childrenByName: new Map(),
      };
      parent.childrenByName.set(name, node);
      parent.children.push(node);
      return node;
    };

    for (const file of changedFiles) {
      const segments = getSegments(file.path);
      if (segments.length === 0) continue;

      let current = root;
      let currentPath = "";
      for (let i = 0; i < segments.length; i += 1) {
        const segment = segments[i];
        const isLeaf = i === segments.length - 1;

        if (isLeaf) {
          const leafNode: TreeNodeInternal = {
            name: segment,
            fullPath: file.path,
            isDirectory: false,
            children: [],
            childrenByName: new Map(),
            file,
          };
          current.children.push(leafNode);
          continue;
        }

        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        current = ensureDirectory(current, segment, currentPath);
      }
    }

    const sortTree = (node: TreeNodeInternal) => {
      node.children.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const child of node.children) {
        if (child.isDirectory) sortTree(child);
      }
    };

    sortTree(root);

    const stripInternal = (node: TreeNodeInternal): TreeNode => {
      return {
        name: node.name,
        fullPath: node.fullPath,
        isDirectory: node.isDirectory,
        children: node.children.map(stripInternal),
        file: node.file,
      };
    };

    return root.children.map(stripInternal);
  }, [changedFiles]);

  const getBasename = (path: string) => {
    const segments = path.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? path;
  };

  const toggleDirectory = (dirPath: string) => {
    setCollapsedDirectories((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  const renderTreeNodes = (nodes: TreeNode[], depth: number): JSX.Element[] => {
    return nodes.flatMap((node) => {
      if (node.isDirectory) {
        const isExpanded = !collapsedDirectories.has(node.fullPath);
        const row = (
          <li key={`dir:${node.fullPath}`}>
            <button
              type="button"
              data-testid="tree-directory"
              className="w-full flex items-center gap-2 py-1.5 pr-2 hover:bg-surface0/30 rounded-md transition-colors text-left"
              style={{ paddingLeft: depth * 16 }}
              onClick={() => toggleDirectory(node.fullPath)}
            >
              <span className="text-subtext1 w-3 text-center select-none">
                {isExpanded ? "▾" : "▸"}
              </span>
              <span className="text-subtext1 font-medium text-xs truncate">
                {node.name}
              </span>
            </button>
          </li>
        );

        return isExpanded
          ? [row, ...renderTreeNodes(node.children, depth + 1)]
          : [row];
      }

      const file = node.file;
      if (!file) return [];

      const isAdded = file.status === "Added" || file.status === "Untracked";
      const isDeleted = file.status === "Deleted";
      const statusColor = isAdded
        ? "text-green"
        : isDeleted
          ? "text-red"
          : "text-text";

      const additions = file.additions;
      const deletions = file.deletions;
      const showAdditions = additions != null && additions !== 0;
      const showDeletions = deletions != null && deletions !== 0;
      const showStats = showAdditions || showDeletions;

      const displayName =
        file.status === "Renamed" && file.original_path
          ? `${getBasename(file.original_path)} -> ${getBasename(file.path)}`
          : node.name;

      return [
        <li
          key={`${file.path}:${file.status}:${file.original_path ?? ""}`}
          className="flex items-center justify-between pr-2 py-1.5 hover:bg-surface0/30 rounded-md transition-colors group cursor-pointer"
          style={{ paddingLeft: depth * 16 }}
          data-testid="changed-file-item"
        >
          <div className="flex items-center gap-2 overflow-hidden min-w-0">
            <span
              className={`text-[10px] font-mono font-bold w-3 text-center ${statusColor}`}
              aria-label={file.status}
            >
              {STATUS_LABELS[file.status]}
            </span>
            <span className="text-sm text-subtext1 group-hover:text-text truncate transition-colors">
              {displayName}
            </span>
          </div>
          {showStats ? (
            <div className="flex items-center gap-2 shrink-0 pl-3 font-mono text-[11px]">
              {showAdditions ? (
                <span className="text-green">+{additions}</span>
              ) : null}
              {showDeletions ? (
                <span className="text-red">-{deletions}</span>
              ) : null}
            </div>
          ) : null}
        </li>,
      ];
    });
  };

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
            {renderTreeNodes(tree, 0)}
          </ul>
        ) : null}
      </div>
    </aside>
  );
}
