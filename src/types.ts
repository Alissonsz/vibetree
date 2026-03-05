export type RepoInfo = {
  id: string;
  path: string;
  name: string;
};

export type WorktreeInfo = {
  path: string;
  head: string;
  branch: string | null;
  is_bare: boolean;
};

export type SelectionState = {
  selectedRepoId: string | null;
  selectedWorktreePath: string | null;
};

export type FileStatus =
  | "Modified"
  | "Added"
  | "Deleted"
  | "Renamed"
  | "Copied"
  | "Untracked"
  | "Ignored"
  | "UpdatedButUnmerged";

export type ChangedFile = {
  path: string;
  status: FileStatus;
  original_path: string | null;
};
