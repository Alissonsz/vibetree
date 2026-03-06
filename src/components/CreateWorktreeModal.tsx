import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { addWorktree, listBranches, getCurrentBranch } from "../hooks/useWorktrees";

interface CreateWorktreeModalProps {
  isOpen: boolean;
  onClose: () => void;
  repoPath: string;
  baseDir?: string;
}

export function CreateWorktreeModal({
  isOpen,
  onClose,
  repoPath,
  baseDir = "",
}: CreateWorktreeModalProps) {
  const [path, setPath] = useState("");
  const [branch, setBranch] = useState("");
  const [baseRef, setBaseRef] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && repoPath) {
      setIsLoadingBranches(true);
      
      const loadData = async () => {
        try {
          const [branchesList, currentBranch] = await Promise.all([
            listBranches(repoPath).catch(() => [] as string[]),
            getCurrentBranch(repoPath).catch(() => "")
          ]);
          setBranches(branchesList);
          setBaseRef(currentBranch);
          
          if (baseDir) {
            const normalizedBase = baseDir.endsWith("/") || baseDir.endsWith("\\") 
              ? baseDir 
              : `${baseDir}/`;
            setPath(normalizedBase);
          }
        } finally {
          setIsLoadingBranches(false);
        }
      };

      void loadData();
    } else {
      setPath("");
      setBranch("");
      setBaseRef("");
      setError(null);
    }
  }, [isOpen, repoPath, baseDir]);

  const handleBrowse = async () => {
    try {
      let defaultPath = repoPath;
      if (baseDir) {
        try {
          const { join } = await import("@tauri-apps/api/path");
          defaultPath = await join(repoPath, baseDir);
        } catch {
          defaultPath = `${repoPath}/${baseDir}`;
        }
      }

      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Worktree Location",
        defaultPath,
      });
      if (selected !== null && typeof selected === "string") {
        setPath(selected);
      }
    } catch (err) {
      console.error("Failed to open dialog:", err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!path || (baseDir && path === `${baseDir}/`)) {
      setError("A valid destination path is required");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await addWorktree(
        repoPath,
        path,
        branch.trim() || undefined,
        baseRef.trim() || undefined
      );
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Worktree"
      maxWidth="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={(e) => void handleSubmit(e)}
            disabled={isSubmitting || !path}
          >
            {isSubmitting ? "Creating..." : "Create"}
          </Button>
        </div>
      }
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {error && (
          <div className="p-2 text-sm text-red bg-red/10 border border-red/20 rounded-sm">
            {error}
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-medium text-text block">
            Location (Path) *
          </label>
          <div className="flex gap-2">
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="e.g. ../.worktrees/my-feature"
              className="flex-1"
              required
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleBrowse()}
            >
              Browse...
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-text block">
            New Branch Name (Optional)
          </label>
          <Input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="e.g. feature/my-new-feature"
          />
          <p className="text-[10px] text-subtext1">
            If left blank, git will derive a branch name from the path.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-text block">
            Base Branch
          </label>
          <Select
            value={baseRef}
            onChange={(val) => setBaseRef(val)}
            disabled={isLoadingBranches}
            options={[
              { value: "", label: "(Default / HEAD)" },
              ...branches.map((b) => ({ value: b, label: b }))
            ]}
          />
          <p className="text-[10px] text-subtext1">
            The starting point for the new worktree/branch.
          </p>
        </div>
      </form>
    </Modal>
  );
}
