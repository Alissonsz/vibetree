import { useCallback, useEffect, useMemo, useState } from "react";
import { 
  RefreshCw, 
  X, 
  ArrowUp, 
  ChevronDown, 
  ChevronRight, 
  Folder, 
  FileText
} from "lucide-react";

import { createChangesClient, useChangesWatcher } from "../hooks/useChanges";
import type { ChangedFile, FileStatus } from "../types";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Modal } from "./ui/Modal";
import { Badge } from "./ui/Badge";

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
  Untracked: "A",
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

  const [viewingFile, setViewingFile] = useState<{
    name: string;
    path: string;
  } | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [fileDiff, setFileDiff] = useState<string>("");
  const [viewMode, setViewMode] = useState<"content" | "diff">("diff");
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const changesClient = useMemo(() => createChangesClient(), []);

  const renderDiffLine = (line: string, index: number) => {
    let bgColor = "";
    let textColor = "text-text";

    if (line.startsWith("+")) {
      bgColor = "bg-green/15";
      textColor = "text-green";
    } else if (line.startsWith("-")) {
      bgColor = "bg-red/15";
      textColor = "text-red";
    } else if (line.startsWith("@@")) {
      bgColor = "bg-blue/10";
      textColor = "text-blue";
    } else if (line.startsWith("diff") || line.startsWith("index") || line.startsWith("---") || line.startsWith("+++")) {
      textColor = "text-subtext0";
    }

    return (
      <div key={index} className={`whitespace-pre-wrap font-mono text-sm px-4 py-0.5 ${bgColor} ${textColor}`}>
        {line || " "}
      </div>
    );
  };

  const handleFileClick = useCallback(
    async (file: ChangedFile) => {
      if (!selectedWorktreePath || file.path.endsWith("/")) return;

      setViewingFile({ name: getBasename(file.path), path: file.path });
      setViewMode("diff");
      setIsFileLoading(true);
      setFileError(null);
      setFileContent("");
      setFileDiff("");

      try {
        const [content, diff] = await Promise.all([
          changesClient.getFileContent(selectedWorktreePath, file.path),
          changesClient.getFileDiff(selectedWorktreePath, file.path),
        ]);
        setFileContent(content);
        setFileDiff(diff);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsFileLoading(false);
      }
    },
    [selectedWorktreePath, changesClient]
  );

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
      const isActuallyDirectory = file.path.endsWith("/");
      const segments = getSegments(file.path);
      if (segments.length === 0) continue;

      let current = root;
      let currentPath = "";
      for (let i = 0; i < segments.length; i += 1) {
        const segment = segments[i];
        const isLastSegment = i === segments.length - 1;

        currentPath = currentPath ? `${currentPath}/${segment}` : segment;

        if (isLastSegment && !isActuallyDirectory) {
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
              className="w-full flex items-center gap-2 py-1.5 pr-2 hover:bg-surface0/30 rounded-sm transition-colors text-left cursor-pointer group"
              style={{ paddingLeft: depth * 16 }}
              onClick={() => toggleDirectory(node.fullPath)}
            >
              <span className="text-subtext1 w-4 flex items-center justify-center select-none">
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
              <Folder size={14} className="text-blue/70 shrink-0" />
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
      const badgeVariant = isAdded
        ? "green"
        : isDeleted
          ? "red"
          : "default";

      const additions = file.additions;
      const deletions = file.deletions;
      const isNew = file.status === "Added" || file.status === "Untracked";
      
      const showAdditions = additions != null && (additions !== 0 || isNew);
      const showDeletions = deletions != null && deletions !== 0;
      const showStats = showAdditions || showDeletions;

      const displayName =
        file.status === "Renamed" && file.original_path
          ? `${getBasename(file.original_path)} -> ${getBasename(file.path)}`
          : node.name;

      return [
        <li
          key={`${file.path}:${file.status}:${file.original_path ?? ""}`}
          className="flex items-center justify-between pr-2 py-1.5 hover:bg-surface0/30 rounded-sm transition-colors group cursor-pointer"
          style={{ paddingLeft: depth * 16 + 20 }}
          data-testid="changed-file-item"
          onClick={() => handleFileClick(file)}
        >
          <div className="flex items-center gap-2 overflow-hidden min-w-0">
            <Badge
              variant={badgeVariant}
              aria-label={file.status}
            >
              {STATUS_LABELS[file.status]}
            </Badge>
            <FileText size={14} className="text-subtext1/50 shrink-0" />
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

  const loadChanges = useCallback(async (silent = false) => {
    if (!selectedWorktreePath) {
      setChangedFiles([]);
      return;
    }

    if (!silent) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const files = await changesClient.getChangedFiles(selectedWorktreePath);
      setChangedFiles(files);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, [selectedWorktreePath, changesClient]);

  useChangesWatcher(selectedWorktreePath, loadChanges);

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
          <Button
            variant="ghost"
            size="icon"
            data-testid="refresh-changes-btn"
            onClick={() => void loadChanges()}
            disabled={!selectedWorktreePath || isLoading}
            title="Refresh"
          >
            <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={onRequestClose}
            aria-label="Close changes pane"
          >
            <X size={14} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 pb-4">
        {selectedWorktreePath && (
          <div className="mb-6 space-y-2">
            <Input
              type="text"
              placeholder="Commit message..."
            />
            <Button className="w-full flex items-center justify-center gap-2">
              <ArrowUp size={14} /> Push
            </Button>
          </div>
        )}

        {!selectedWorktreePath ? (
          <div className="p-4 text-subtext1 text-sm text-center">
            Select a workspace to load changed files.
          </div>
        ) : null}

        {selectedWorktreePath && isLoading && changedFiles.length === 0 ? (
          <div className="p-4 text-subtext1 text-sm text-center">
            Loading changed files...
          </div>
        ) : null}

        {selectedWorktreePath && !isLoading && error ? (
          <div
            className="bg-red/10 text-red p-3 rounded-sm text-sm"
            role="alert"
          >
            <div className="font-semibold mb-1">Git status failed</div>
            <div>{error}</div>
          </div>
        ) : null}

        {selectedWorktreePath &&
        (!isLoading || changedFiles.length > 0) &&
        !error &&
        changedFiles.length === 0 ? (
          <div className="p-4 text-subtext1 text-sm text-center">
            This workspace has a clean status.
          </div>
        ) : null}

        {selectedWorktreePath &&
        (!isLoading || changedFiles.length > 0) &&
        !error &&
        changedFiles.length > 0 ? (
          <ul className="space-y-1" data-testid="changed-file-list">
            {renderTreeNodes(tree, 0)}
          </ul>
        ) : null}
      </div>

      <Modal
        isOpen={!!viewingFile}
        onClose={() => setViewingFile(null)}
        title={viewingFile?.name ?? ""}
      >
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex items-center gap-6 mb-4">
            <div className="flex bg-base rounded-sm p-0.5 border border-surface0">
              <Button
                variant="tab"
                size="sm"
                isActive={viewMode === "diff"}
                onClick={() => setViewMode("diff")}
              >
                Diff
              </Button>
              <Button
                variant="tab"
                size="sm"
                isActive={viewMode === "content"}
                onClick={() => setViewMode("content")}
              >
                Full File
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-auto bg-base font-mono">
            {isFileLoading ? (
              <div className="flex items-center justify-center h-full text-subtext1">
                Loading...
              </div>
            ) : fileError ? (
              <div className="p-8">
                <div className="text-red p-4 bg-red/10 rounded-sm">{fileError}</div>
              </div>
            ) : (
              <div className="py-4">
                {viewMode === "diff" ? (
                  fileDiff.split("\n").map(renderDiffLine)
                ) : (
                  <pre className="text-text whitespace-pre-wrap px-4 selection:bg-surface1">
                    <code>{fileContent}</code>
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </aside>
  );
}
