use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    Ignored,
    UpdatedButUnmerged,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ChangedFile {
    pub path: String,
    pub status: FileStatus,
    pub original_path: Option<String>,
}

trait ChangesEnvironment {
    fn path_exists(&self, path: &str) -> bool;
    fn is_directory(&self, path: &str) -> bool;
    fn git_status_porcelain(&self, path: &str) -> Result<Vec<u8>, String>;
}

struct SystemChangesEnvironment;

impl ChangesEnvironment for SystemChangesEnvironment {
    fn path_exists(&self, path: &str) -> bool {
        Path::new(path).exists()
    }

    fn is_directory(&self, path: &str) -> bool {
        Path::new(path).is_dir()
    }

    fn git_status_porcelain(&self, path: &str) -> Result<Vec<u8>, String> {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .arg("status")
            .arg("--porcelain=v1")
            .arg("-z")
            .output()
            .map_err(|error| format!("failed to run git status: {error}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let message = if stderr.is_empty() {
                "git status command failed".to_string()
            } else {
                format!("git status command failed: {stderr}")
            };
            return Err(message);
        }

        Ok(output.stdout)
    }
}

pub fn parse_porcelain_status(raw: &[u8]) -> Result<Vec<ChangedFile>, String> {
    let mut entries = raw.split(|byte| *byte == 0).peekable();
    let mut changed_files = Vec::new();

    while let Some(entry) = entries.next() {
        if entry.is_empty() {
            continue;
        }

        if entry.len() < 4 {
            return Err("invalid porcelain entry: status line too short".to_string());
        }

        let x = entry[0] as char;
        let y = entry[1] as char;

        if entry[2] != b' ' {
            return Err("invalid porcelain entry: missing status separator".to_string());
        }

        let status = pick_status(x, y)
            .ok_or_else(|| format!("unsupported porcelain status code pair: '{x}{y}'"))?;

        let path = String::from_utf8(entry[3..].to_vec())
            .map_err(|error| format!("invalid utf-8 path in porcelain entry: {error}"))?;

        let original_path = if matches!(status, FileStatus::Renamed | FileStatus::Copied) {
            let source_entry = entries
                .next()
                .ok_or_else(|| "invalid porcelain entry: missing original path".to_string())?;

            let source = String::from_utf8(source_entry.to_vec()).map_err(|error| {
                format!("invalid utf-8 original path in porcelain entry: {error}")
            })?;
            Some(source)
        } else {
            None
        };

        changed_files.push(ChangedFile {
            path,
            status,
            original_path,
        });
    }

    Ok(changed_files)
}

pub fn get_changed_files_for_path(worktree_path: &str) -> Result<Vec<ChangedFile>, String> {
    let environment = SystemChangesEnvironment;
    get_changed_files_for_path_with_environment(worktree_path, &environment)
}

fn get_changed_files_for_path_with_environment<E: ChangesEnvironment>(
    worktree_path: &str,
    environment: &E,
) -> Result<Vec<ChangedFile>, String> {
    if !environment.path_exists(worktree_path) {
        return Err(format!("path '{worktree_path}' does not exist"));
    }

    if !environment.is_directory(worktree_path) {
        return Err(format!("path '{worktree_path}' is not a directory"));
    }

    let stdout = environment.git_status_porcelain(worktree_path)?;
    parse_porcelain_status(&stdout)
}

#[tauri::command]
pub fn get_changed_files(worktree_path: String) -> Result<Vec<ChangedFile>, String> {
    get_changed_files_for_path(&worktree_path)
}

fn pick_status(x: char, y: char) -> Option<FileStatus> {
    map_status_code(x).or_else(|| map_status_code(y))
}

fn map_status_code(code: char) -> Option<FileStatus> {
    match code {
        'M' => Some(FileStatus::Modified),
        'A' => Some(FileStatus::Added),
        'D' => Some(FileStatus::Deleted),
        'R' => Some(FileStatus::Renamed),
        'C' => Some(FileStatus::Copied),
        '?' => Some(FileStatus::Untracked),
        '!' => Some(FileStatus::Ignored),
        'U' => Some(FileStatus::UpdatedButUnmerged),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{
        get_changed_files_for_path_with_environment, parse_porcelain_status, ChangedFile,
        ChangesEnvironment, FileStatus,
    };

    struct MockChangesEnvironment {
        exists: HashMap<String, bool>,
        directories: HashMap<String, bool>,
        git_outputs: HashMap<String, Result<Vec<u8>, String>>,
    }

    impl MockChangesEnvironment {
        fn new() -> Self {
            Self {
                exists: HashMap::new(),
                directories: HashMap::new(),
                git_outputs: HashMap::new(),
            }
        }

        fn with_path(mut self, path: &str, exists: bool, is_directory: bool) -> Self {
            self.exists.insert(path.to_string(), exists);
            self.directories.insert(path.to_string(), is_directory);
            self
        }
    }

    impl ChangesEnvironment for MockChangesEnvironment {
        fn path_exists(&self, path: &str) -> bool {
            *self.exists.get(path).unwrap_or(&false)
        }

        fn is_directory(&self, path: &str) -> bool {
            *self.directories.get(path).unwrap_or(&false)
        }

        fn git_status_porcelain(&self, path: &str) -> Result<Vec<u8>, String> {
            self.git_outputs
                .get(path)
                .cloned()
                .unwrap_or_else(|| Ok(Vec::new()))
        }
    }

    #[test]
    fn parse_porcelain_status_handles_common_entries() {
        let raw = b" M modified.txt\0A  added.txt\0 D removed.txt\0?? untracked.txt\0";

        let parsed = parse_porcelain_status(raw).expect("porcelain parsing should succeed");

        assert_eq!(
            parsed,
            vec![
                ChangedFile {
                    path: "modified.txt".to_string(),
                    status: FileStatus::Modified,
                    original_path: None,
                },
                ChangedFile {
                    path: "added.txt".to_string(),
                    status: FileStatus::Added,
                    original_path: None,
                },
                ChangedFile {
                    path: "removed.txt".to_string(),
                    status: FileStatus::Deleted,
                    original_path: None,
                },
                ChangedFile {
                    path: "untracked.txt".to_string(),
                    status: FileStatus::Untracked,
                    original_path: None,
                },
            ]
        );
    }

    #[test]
    fn parse_porcelain_status_handles_rename_entries() {
        let raw = b"R  new-name.txt\0old-name.txt\0";

        let parsed = parse_porcelain_status(raw).expect("rename parsing should succeed");

        assert_eq!(
            parsed,
            vec![ChangedFile {
                path: "new-name.txt".to_string(),
                status: FileStatus::Renamed,
                original_path: Some("old-name.txt".to_string()),
            }]
        );
    }

    #[test]
    fn parse_porcelain_status_empty_output_returns_empty_list() {
        let parsed = parse_porcelain_status(b"").expect("empty output should parse");
        assert!(parsed.is_empty());
    }

    #[test]
    fn get_changed_files_invalid_path_returns_error() {
        let environment =
            MockChangesEnvironment::new().with_path("/virtual/missing/path", false, false);
        let result =
            get_changed_files_for_path_with_environment("/virtual/missing/path", &environment);

        assert!(result.is_err());
        let error = result.expect_err("invalid path should return an error");
        assert!(error.contains("does not exist"));
    }
}
