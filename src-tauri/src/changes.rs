use rayon::prelude::*;
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

const CHANGES_EVENT_NAME: &str = "changes-detected";
const DEBOUNCE_WINDOW: Duration = Duration::from_millis(300);
const POLL_INTERVAL: Duration = Duration::from_millis(100);
const MAX_FILE_SIZE_FOR_STATS: u64 = 1024 * 1024; // 1MB limit for line counting

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
    pub additions: Option<i64>,
    pub deletions: Option<i64>,
}

trait ChangesEnvironment {
    fn path_exists(&self, path: &str) -> bool;
    fn is_directory(&self, path: &str) -> bool;
    fn get_file_size(&self, worktree_path: &str, file_path: &str) -> u64;
    fn git_status_porcelain(&self, path: &str) -> Result<Vec<u8>, String>;
    fn git_diff_numstat(&self, path: &str) -> Result<Vec<u8>, String>;
    fn read_file_content(&self, worktree_path: &str, file_path: &str) -> Result<Vec<u8>, String>;
}

struct SystemChangesEnvironment;

impl ChangesEnvironment for SystemChangesEnvironment {
    fn path_exists(&self, path: &str) -> bool {
        Path::new(path).exists()
    }

    fn is_directory(&self, path: &str) -> bool {
        Path::new(path).is_dir()
    }

    fn get_file_size(&self, worktree_path: &str, file_path: &str) -> u64 {
        let full_path = Path::new(worktree_path).join(file_path);
        std::fs::metadata(full_path).map(|m| m.len()).unwrap_or(0)
    }

    fn git_status_porcelain(&self, path: &str) -> Result<Vec<u8>, String> {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .arg("status")
            .arg("--porcelain=v1")
            .arg("-uall") // Show all individual files in untracked directories
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

    fn git_diff_numstat(&self, path: &str) -> Result<Vec<u8>, String> {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .arg("diff")
            .arg("HEAD")
            .arg("--numstat")
            .arg("--find-renames")
            .arg("--find-copies")
            .arg("--")
            .output()
            .map_err(|error| format!("failed to run git diff HEAD --numstat: {error}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let message = if stderr.is_empty() {
                "git diff HEAD --numstat command failed".to_string()
            } else {
                format!("git diff HEAD --numstat command failed: {stderr}")
            };
            return Err(message);
        }

        Ok(output.stdout)
    }

    fn read_file_content(&self, worktree_path: &str, file_path: &str) -> Result<Vec<u8>, String> {
        let full_path = Path::new(worktree_path).join(file_path);
        std::fs::read(&full_path)
            .map_err(|error| format!("failed to read file {}: {}", full_path.display(), error))
    }
}

struct ChangesWatcher {
    stop_tx: Sender<()>,
    thread_handle: Option<JoinHandle<()>>,
    _watcher: Option<RecommendedWatcher>,
}

impl ChangesWatcher {
    fn start(worktree_path: String, app: AppHandle) -> Result<Self, String> {
        let (event_tx, event_rx) = mpsc::channel();
        let (stop_tx, stop_rx) = mpsc::channel();

        let mut watcher = RecommendedWatcher::new(
            move |result: notify::Result<notify::Event>| {
                if result.is_ok() {
                    let _ = event_tx.send(());
                }
            },
            Config::default(),
        )
        .map_err(|error| format!("failed to initialize changes watcher: {error}"))?;

        watcher
            .watch(Path::new(&worktree_path), RecursiveMode::Recursive)
            .map_err(|error| {
                format!(
                    "failed to watch worktree path '{}': {error}",
                    worktree_path
                )
            })?;

        let worktree_path_for_thread = worktree_path.clone();
        let thread_handle = thread::spawn(move || {
            loop {
                if stop_rx.try_recv().is_ok() {
                    break;
                }

                match event_rx.recv_timeout(POLL_INTERVAL) {
                    Ok(_) => {
                        drain_debounced_events(&event_rx, DEBOUNCE_WINDOW);
                        let _ = app.emit(CHANGES_EVENT_NAME, worktree_path_for_thread.clone());
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        Ok(Self {
            stop_tx,
            thread_handle: Some(thread_handle),
            _watcher: Some(watcher),
        })
    }

    fn stop(mut self) {
        let _ = self.stop_tx.send(());
        if let Some(handle) = self.thread_handle.take() {
            let _ = handle.join();
        }
    }
}

#[derive(Default)]
pub struct ChangesService {
    watchers: HashMap<String, ChangesWatcher>,
}

impl ChangesService {
    pub fn start_watching(
        &mut self,
        worktree_path: String,
        app: AppHandle,
    ) -> Result<(), String> {
        if let Some(existing) = self.watchers.remove(&worktree_path) {
            existing.stop();
        }

        let watcher = ChangesWatcher::start(worktree_path.clone(), app)?;
        self.watchers.insert(worktree_path, watcher);
        Ok(())
    }

    pub fn stop_watching(&mut self, worktree_path: &str) {
        if let Some(watcher) = self.watchers.remove(worktree_path) {
            watcher.stop();
        }
    }
}

fn drain_debounced_events(event_rx: &Receiver<()>, debounce_window: Duration) -> usize {
    let mut drained = 0;
    while event_rx.recv_timeout(debounce_window).is_ok() {
        drained += 1;
    }
    drained
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
            additions: None,
            deletions: None,
        });
    }

    Ok(changed_files)
}

pub fn parse_numstat(raw: &[u8]) -> HashMap<String, (Option<i64>, Option<i64>)> {
    let mut stats = HashMap::new();

    if raw.is_empty() {
        return stats;
    }

    for line in raw.split(|byte| *byte == b'\n') {
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&[u8]> = line.splitn(3, |byte| *byte == b'\t').collect();
        if parts.len() != 3 {
            continue;
        }

        let additions = parse_numstat_value(parts[0]);
        let deletions = parse_numstat_value(parts[1]);
        let raw_path = String::from_utf8_lossy(parts[2]).to_string();
        let normalized_path = normalize_numstat_path(&raw_path);

        stats.insert(normalized_path, (additions, deletions));
    }

    stats
}

fn parse_numstat_value(bytes: &[u8]) -> Option<i64> {
    if bytes == b"-" {
        None
    } else {
        let s = String::from_utf8_lossy(bytes);
        s.parse().ok()
    }
}

fn normalize_numstat_path(path: &str) -> String {
    // Handle both plain rename (old => new) and brace rename (src/{old => new}.rs)
    if let Some(brace_start) = path.find('{') {
        // Brace rename format: prefix/{old => new}suffix
        if let Some(arrow_pos) = path.find(" => ") {
            let prefix = &path[..brace_start];
            let after_arrow = &path[arrow_pos + 4..];
            // Find the closing brace to get the suffix
            if let Some(brace_end) = after_arrow.find('}') {
                let dest_name = &after_arrow[..brace_end];
                let suffix = &after_arrow[brace_end + 1..];
                return format!("{}{}{}", prefix, dest_name, suffix);
            }
        }
    }
    // Plain rename or no rename: use last " => " to get destination
    if let Some(arrow_pos) = path.rfind(" => ") {
        path[arrow_pos + 4..].to_string()
    } else {
        path.to_string()
    }
}

pub fn merge_numstat_into_files(
    files: Vec<ChangedFile>,
    numstat: &HashMap<String, (Option<i64>, Option<i64>)>,
) -> Vec<ChangedFile> {
    files
        .into_iter()
        .map(|mut file| {
            let lookup_key = &file.path;

            if let Some((additions, deletions)) = numstat.get(lookup_key) {
                file.additions = *additions;
                file.deletions = *deletions;
            }

            file
        })
        .collect()
}

/// Compute line count for a file's content.
/// Returns None if the content cannot be reliably counted (e.g., binary content).
fn compute_line_count(content: &[u8]) -> Option<i64> {
    // Check for null bytes which indicate binary content
    if content.iter().any(|&b| b == 0) {
        return None;
    }

    // Try to parse as UTF-8
    match std::str::from_utf8(content) {
        Ok(text) => {
            // Count lines - a file with content "foo\nbar" has 2 lines
            let count = text.lines().count() as i64;
            // If file doesn't end with newline, lines() already handles it correctly
            // But we need to handle empty file case - empty file has 0 lines
            if content.is_empty() {
                Some(0)
            } else {
                Some(count)
            }
        }
        Err(_) => None,
    }
}

pub fn get_changed_files_for_path(worktree_path: &str) -> Result<Vec<ChangedFile>, String> {
    let environment = SystemChangesEnvironment;
    get_changed_files_for_path_with_environment(worktree_path, &environment)
}

fn get_changed_files_for_path_with_environment<E: ChangesEnvironment + Sync>(
    worktree_path: &str,
    environment: &E,
) -> Result<Vec<ChangedFile>, String> {
    if !environment.path_exists(worktree_path) {
        return Err(format!("path '{worktree_path}' does not exist"));
    }

    if !environment.is_directory(worktree_path) {
        return Err(format!("path '{worktree_path}' is not a directory"));
    }

    let porcelain_output = environment.git_status_porcelain(worktree_path)?;
    let mut files = parse_porcelain_status(&porcelain_output)?;

    // Gracefully handle numstat failure - keep porcelain entries with None stats
    let numstat = match environment.git_diff_numstat(worktree_path) {
        Ok(numstat_output) => parse_numstat(&numstat_output),
        Err(_) => HashMap::new(), // Empty map means all files retain None stats
    };

    files = merge_numstat_into_files(files, &numstat);

    // For Added/Untracked files without stats from numstat, compute line count from file content
    // Use parallel processing to speed up file reading and line counting
    files.par_iter_mut().for_each(|file| {
        if file.additions.is_none() && file.deletions.is_none() {
            if matches!(file.status, FileStatus::Added | FileStatus::Untracked) {
                // Skip line counting for exceptionally large files
                if environment.get_file_size(worktree_path, &file.path) > MAX_FILE_SIZE_FOR_STATS {
                    return;
                }

                // Try to read file content and count lines
                match environment.read_file_content(worktree_path, &file.path) {
                    Ok(content) => {
                        if let Some(line_count) = compute_line_count(&content) {
                            file.additions = Some(line_count);
                            file.deletions = Some(0);
                        }
                    }
                    Err(_) => {}
                }
            }
        }
    });

    Ok(files)
}

#[tauri::command]
pub fn get_file_content(worktree_path: String, file_path: String) -> Result<String, String> {
    let environment = SystemChangesEnvironment;
    let bytes = environment.read_file_content(&worktree_path, &file_path)?;
    String::from_utf8(bytes).map_err(|error| format!("file is not valid utf-8: {error}"))
}

#[tauri::command]
pub fn get_file_diff(worktree_path: String, file_path: String) -> Result<String, String> {
    // For untracked files, we want to show the whole file as an addition.
    // We check status first to decide the command.
    let status_output = Command::new("git")
        .arg("-C")
        .arg(&worktree_path)
        .arg("status")
        .arg("--porcelain")
        .arg("--")
        .arg(&file_path)
        .output()
        .map_err(|error| format!("failed to check file status: {error}"))?;

    let status_str = String::from_utf8_lossy(&status_output.stdout);
    let is_untracked = status_str.starts_with("??");

    let output = if is_untracked {
        // For untracked files, diff against /dev/null
        Command::new("git")
            .arg("-C")
            .arg(&worktree_path)
            .arg("diff")
            .arg("--no-index")
            .arg("--patch")
            .arg("/dev/null")
            .arg(&file_path)
            .output()
            .map_err(|error| format!("failed to run git diff: {error}"))?
    } else {
        Command::new("git")
            .arg("-C")
            .arg(&worktree_path)
            .arg("diff")
            .arg("HEAD")
            .arg("--patch")
            .arg("--")
            .arg(&file_path)
            .output()
            .map_err(|error| format!("failed to run git diff: {error}"))?
    };

    // Note: git diff --no-index returns exit code 1 if there are differences, 
    // which is expected. We only error if it's not success AND stderr is not empty.
    if !output.status.success() && !output.stderr.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("git diff command failed: {stderr}"));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn get_changed_files(worktree_path: String) -> Result<Vec<ChangedFile>, String> {
    get_changed_files_for_path(&worktree_path)
}

fn lock_service<'a>(
    state: &'a State<'_, Mutex<ChangesService>>,
) -> Result<std::sync::MutexGuard<'a, ChangesService>, String> {
    state
        .lock()
        .map_err(|error| format!("failed to lock changes state: {error}"))
}

#[tauri::command]
pub fn start_watching_changes(
    worktree_path: String,
    app: AppHandle,
    state: State<'_, Mutex<ChangesService>>,
) -> Result<(), String> {
    let mut service = lock_service(&state)?;
    service.start_watching(worktree_path, app)
}

#[tauri::command]
pub fn stop_watching_changes(
    worktree_path: String,
    state: State<'_, Mutex<ChangesService>>,
) -> Result<(), String> {
    let mut service = lock_service(&state)?;
    service.stop_watching(&worktree_path);
    Ok(())
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
        get_changed_files_for_path_with_environment, merge_numstat_into_files, parse_numstat,
        parse_porcelain_status, ChangedFile, ChangesEnvironment, FileStatus,
    };

    struct MockChangesEnvironment {
        exists: HashMap<String, bool>,
        directories: HashMap<String, bool>,
        git_status_outputs: HashMap<String, Result<Vec<u8>, String>>,
        git_numstat_outputs: HashMap<String, Result<Vec<u8>, String>>,
        file_contents: HashMap<String, Result<Vec<u8>, String>>,
    }

    impl MockChangesEnvironment {
        fn new() -> Self {
            Self {
                exists: HashMap::new(),
                directories: HashMap::new(),
                git_status_outputs: HashMap::new(),
                git_numstat_outputs: HashMap::new(),
                file_contents: HashMap::new(),
            }
        }

        fn with_path(mut self, path: &str, exists: bool, is_directory: bool) -> Self {
            self.exists.insert(path.to_string(), exists);
            self.directories.insert(path.to_string(), is_directory);
            self
        }

        fn with_git_status_output(mut self, path: &str, output: Vec<u8>) -> Self {
            self.git_status_outputs.insert(path.to_string(), Ok(output));
            self
        }

        fn with_git_numstat_output(mut self, path: &str, output: Vec<u8>) -> Self {
            self.git_numstat_outputs
                .insert(path.to_string(), Ok(output));
            self
        }

        fn with_git_numstat_error(mut self, path: &str, err: String) -> Self {
            self.git_numstat_outputs.insert(path.to_string(), Err(err));
            self
        }

        fn with_file_content(mut self, worktree: &str, file_path: &str, content: Vec<u8>) -> Self {
            let key = format!("{}:{}", worktree, file_path);
            self.file_contents.insert(key, Ok(content));
            self
        }

        fn with_file_error(mut self, worktree: &str, file_path: &str, err: String) -> Self {
            let key = format!("{}:{}", worktree, file_path);
            self.file_contents.insert(key, Err(err));
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

        fn get_file_size(&self, _worktree_path: &str, _file_path: &str) -> u64 {
            0
        }

        fn git_status_porcelain(&self, path: &str) -> Result<Vec<u8>, String> {
            self.git_status_outputs
                .get(path)
                .cloned()
                .unwrap_or_else(|| Ok(Vec::new()))
        }

        fn git_diff_numstat(&self, path: &str) -> Result<Vec<u8>, String> {
            self.git_numstat_outputs
                .get(path)
                .cloned()
                .unwrap_or_else(|| Ok(Vec::new()))
        }

        fn read_file_content(&self, worktree_path: &str, file_path: &str) -> Result<Vec<u8>, String> {
            let key = format!("{}:{}", worktree_path, file_path);
            self.file_contents
                .get(&key)
                .cloned()
                .unwrap_or_else(|| Err("file not found".to_string()))
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
                    additions: None,
                    deletions: None,
                },
                ChangedFile {
                    path: "added.txt".to_string(),
                    status: FileStatus::Added,
                    original_path: None,
                    additions: None,
                    deletions: None,
                },
                ChangedFile {
                    path: "removed.txt".to_string(),
                    status: FileStatus::Deleted,
                    original_path: None,
                    additions: None,
                    deletions: None,
                },
                ChangedFile {
                    path: "untracked.txt".to_string(),
                    status: FileStatus::Untracked,
                    original_path: None,
                    additions: None,
                    deletions: None,
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
                additions: None,
                deletions: None,
            }]
        );
    }

    #[test]
    fn parse_porcelain_status_empty_output_returns_empty_list() {
        let parsed = parse_porcelain_status(b"").expect("empty output should parse");
        assert!(parsed.is_empty());
    }

    #[test]
    fn parse_numstat_handles_common_entries() {
        let raw = b"21\t5\tsrc/main.rs\n10\t0\tsrc/lib.rs\n-\t-\tbinary.png\n";

        let stats = parse_numstat(raw);

        assert_eq!(stats.len(), 3);
        assert_eq!(stats.get("src/main.rs"), Some(&(Some(21), Some(5))));
        assert_eq!(stats.get("src/lib.rs"), Some(&(Some(10), Some(0))));
        // Binary file shows None for both
        assert_eq!(stats.get("binary.png"), Some(&(None, None)));
    }

    #[test]
    fn parse_numstat_empty_output_returns_empty_map() {
        let stats = parse_numstat(b"");
        assert!(stats.is_empty());
    }

    #[test]
    fn merge_numstat_into_files_associates_stats_correctly() {
        let files = vec![
            ChangedFile {
                path: "src/main.rs".to_string(),
                status: FileStatus::Modified,
                original_path: None,
                additions: None,
                deletions: None,
            },
            ChangedFile {
                path: "src/lib.rs".to_string(),
                status: FileStatus::Added,
                original_path: None,
                additions: None,
                deletions: None,
            },
        ];

        let numstat = {
            let mut m = HashMap::new();
            m.insert("src/main.rs".to_string(), (Some(21), Some(5)));
            m.insert("src/lib.rs".to_string(), (Some(10), Some(0)));
            m
        };

        let merged = merge_numstat_into_files(files, &numstat);

        assert_eq!(merged[0].additions, Some(21));
        assert_eq!(merged[0].deletions, Some(5));
        assert_eq!(merged[1].additions, Some(10));
        assert_eq!(merged[1].deletions, Some(0));
    }

    #[test]
    fn merge_numstat_into_files_handles_renamed_files_by_destination_path() {
        let files = vec![ChangedFile {
            path: "new-name.rs".to_string(),
            status: FileStatus::Renamed,
            original_path: Some("old-name.rs".to_string()),
            additions: None,
            deletions: None,
        }];

        // Numstat uses destination path (new name)
        let numstat = {
            let mut m = HashMap::new();
            m.insert("new-name.rs".to_string(), (Some(15), Some(3)));
            m
        };

        let merged = merge_numstat_into_files(files, &numstat);

        assert_eq!(merged[0].additions, Some(15));
        assert_eq!(merged[0].deletions, Some(3));
        // Original path should be preserved
        assert_eq!(merged[0].original_path, Some("old-name.rs".to_string()));
    }

    #[test]
    fn merge_numstat_into_files_keeps_none_when_no_match() {
        let files = vec![ChangedFile {
            path: "untracked.rs".to_string(),
            status: FileStatus::Untracked,
            original_path: None,
            additions: None,
            deletions: None,
        }];

        // No numstat for untracked file
        let numstat = HashMap::new();

        let merged = merge_numstat_into_files(files, &numstat);

        // Stats should remain None
        assert_eq!(merged[0].additions, None);
        assert_eq!(merged[0].deletions, None);
    }

    #[test]
    fn merge_numstat_into_files_handles_binary_files() {
        let files = vec![ChangedFile {
            path: "image.png".to_string(),
            status: FileStatus::Modified,
            original_path: None,
            additions: None,
            deletions: None,
        }];

        // Binary file shows "-" in numstat
        let numstat = {
            let mut m = HashMap::new();
            m.insert("image.png".to_string(), (None, None));
            m
        };

        let merged = merge_numstat_into_files(files, &numstat);

        // Binary files should have None for both
        assert_eq!(merged[0].additions, None);
        assert_eq!(merged[0].deletions, None);
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

    #[test]
    fn get_changed_files_with_numstat_merge_integration() {
        let environment = MockChangesEnvironment::new()
            .with_path("/test/repo", true, true)
            .with_git_status_output(
                "/test/repo",
                b" M modified.txt\0A  added.txt\0?? untracked.txt\0".to_vec(),
            )
            .with_git_numstat_output(
                "/test/repo",
                b"10\t5\tmodified.txt\n20\t0\tadded.txt\n".to_vec(),
            );

        let result = get_changed_files_for_path_with_environment("/test/repo", &environment);

        assert!(result.is_ok());
        let files = result.unwrap();

        assert_eq!(files.len(), 3);

        // Modified file should have stats
        let modified = files.iter().find(|f| f.path == "modified.txt").unwrap();
        assert_eq!(modified.additions, Some(10));
        assert_eq!(modified.deletions, Some(5));

        // Added file should have stats
        let added = files.iter().find(|f| f.path == "added.txt").unwrap();
        assert_eq!(added.additions, Some(20));
        assert_eq!(added.deletions, Some(0));

        // Untracked file should have None (not in numstat)
        let untracked = files.iter().find(|f| f.path == "untracked.txt").unwrap();
        assert_eq!(untracked.additions, None);
        assert_eq!(untracked.deletions, None);
    }

    // New edge case tests for diff-stat merge rules and rename behavior

    #[test]
    fn parse_numstat_handles_additions_only() {
        // When a file has additions but deletions is "-" (binary-like or additions-only)
        let raw = b"10\t-\tnew-file.txt\n";

        let stats = parse_numstat(raw);

        assert_eq!(stats.len(), 1);
        // Additions should be Some(10), deletions should be None (the "-")
        assert_eq!(stats.get("new-file.txt"), Some(&(Some(10), None)));
    }

    #[test]
    fn parse_numstat_handles_zero_deletions() {
        // When a file has additions and zero deletions (not the same as "-")
        let raw = b"10\t0\tadded-file.txt\n";

        let stats = parse_numstat(raw);

        assert_eq!(stats.len(), 1);
        // Both should be Some values - 0 is a valid number, not "-"
        assert_eq!(stats.get("added-file.txt"), Some(&(Some(10), Some(0))));
    }

    #[test]
    fn parse_numstat_skips_malformed_lines() {
        // Malformed lines with fewer than 3 tab-separated parts should be skipped
        let raw = b"10\t5\tvalid.txt\n10\tinvalid.txt\n5\tonly-one-part.txt\n";

        let stats = parse_numstat(raw);

        // Only the valid line should be parsed
        assert_eq!(stats.len(), 1);
        assert!(stats.contains_key("valid.txt"));
        // Malformed lines should not create entries
        assert!(!stats.contains_key("invalid.txt"));
        assert!(!stats.contains_key("only-one-part.txt"));
    }

    #[test]
    fn merge_numstat_with_additions_only_stats() {
        // Test merge when numstat has additions-only (Some, None)
        let files = vec![ChangedFile {
            path: "new-content.rs".to_string(),
            status: FileStatus::Modified,
            original_path: None,
            additions: None,
            deletions: None,
        }];

        let numstat = {
            let mut m = HashMap::new();
            m.insert("new-content.rs".to_string(), (Some(25), None));
            m
        };

        let merged = merge_numstat_into_files(files, &numstat);

        assert_eq!(merged[0].additions, Some(25));
        assert_eq!(merged[0].deletions, None);
    }

    #[test]
    fn merge_numstat_with_rename_destination_key() {
        // Explicitly test that rename lookups use destination path (new name)
        let files = vec![
            ChangedFile {
                path: "src/renamed.rs".to_string(),
                status: FileStatus::Renamed,
                original_path: Some("src/old.rs".to_string()),
                additions: None,
                deletions: None,
            },
            ChangedFile {
                path: "src/also-renamed.rs".to_string(),
                status: FileStatus::Renamed,
                original_path: Some("src/also-old.rs".to_string()),
                additions: None,
                deletions: None,
            },
        ];

        // Numstat only has entry for one of the renamed files
        let numstat = {
            let mut m = HashMap::new();
            m.insert("src/renamed.rs".to_string(), (Some(8), Some(2)));
            // Note: src/also-renamed.rs is NOT in numstat
            m
        };

        let merged = merge_numstat_into_files(files, &numstat);

        // First renamed file should have stats (found by destination path)
        let renamed = merged.iter().find(|f| f.path == "src/renamed.rs").unwrap();
        assert_eq!(renamed.additions, Some(8));
        assert_eq!(renamed.deletions, Some(2));
        assert_eq!(renamed.original_path, Some("src/old.rs".to_string()));

        // Second renamed file should NOT have stats (not in numstat)
        let also_renamed = merged
            .iter()
            .find(|f| f.path == "src/also-renamed.rs")
            .unwrap();
        assert_eq!( also_renamed.additions, None);
        assert_eq!(also_renamed.deletions, None);
        assert_eq!(
            also_renamed.original_path,
            Some("src/also-old.rs".to_string())
        );
    }

    #[test]
    fn parse_numstat_handles_rename_syntax() {
        let raw = b"10\t5\tsrc/old.rs => src/new.rs\n20\t3\told-name.txt => new-name.txt\n";

        let stats = parse_numstat(raw);

        assert_eq!(stats.len(), 2);
        assert_eq!(stats.get("src/new.rs"), Some(&(Some(10), Some(5))));
        assert_eq!(stats.get("new-name.txt"), Some(&(Some(20), Some(3))));
    }

    #[test]
    fn parse_numstat_handles_copy_syntax() {
        let raw = b"15\t0\toriginal.txt => copy.txt\n";

        let stats = parse_numstat(raw);

        assert_eq!(stats.len(), 1);
        assert_eq!(stats.get("copy.txt"), Some(&(Some(15), Some(0))));
    }

    #[test]
    fn parse_numstat_handles_brace_rename_simple() {
        // Git brace rename format: src/{old => new}.rs
        let raw = b"10\t5\tsrc/{old => new}.rs\n";

        let stats = parse_numstat(raw);

        assert_eq!(stats.len(), 1);
        assert_eq!(stats.get("src/new.rs"), Some(&(Some(10), Some(5))));
    }

    #[test]
    fn parse_numstat_handles_brace_rename_nested_path() {
        // Nested path with brace rename
        let raw = b"20\t8\tlib/{utils => helpers}/mod.rs\n";

        let stats = parse_numstat(raw);

        assert_eq!(stats.len(), 1);
        assert_eq!(stats.get("lib/helpers/mod.rs"), Some(&(Some(20), Some(8))));
    }

    #[test]
    fn parse_numstat_handles_brace_rename_deep_path() {
        // Deep nested path with brace rename
        let raw = b"5\t2\tfrontend/src/{Button => components/Button}/index.tsx\n";

        let stats = parse_numstat(raw);

        assert_eq!(stats.len(), 1);
        assert_eq!(
            stats.get("frontend/src/components/Button/index.tsx"),
            Some(&(Some(5), Some(2)))
        );
    }

    #[test]
    fn parse_numstat_handles_brace_rename_multiple_in_line() {
        // Multiple brace renames in same output
        let raw = b"3\t1\tsrc/{a => b}/x.rs\n7\t2\tsrc/{c => d}/y.rs\n";

        let stats = parse_numstat(raw);

        assert_eq!(stats.len(), 2);
        assert_eq!(stats.get("src/b/x.rs"), Some(&(Some(3), Some(1))));
        assert_eq!(stats.get("src/d/y.rs"), Some(&(Some(7), Some(2))));
    }

    #[test]
    fn parse_numstat_brace_rename_does_not_conflict_with_plain_rename() {
        // Mix of plain and brace rename formats
        let raw = b"10\t5\told.txt => new.txt\n15\t3\tsrc/{foo => bar}/file.rs\n";

        let stats = parse_numstat(raw);

        assert_eq!(stats.len(), 2);
        assert_eq!(stats.get("new.txt"), Some(&(Some(10), Some(5))));
        assert_eq!(stats.get("src/bar/file.rs"), Some(&(Some(15), Some(3))));
    }

    #[test]
    fn get_changed_files_returns_files_when_numstat_fails() {
        let environment = MockChangesEnvironment::new()
            .with_path("/test/repo", true, true)
            .with_git_status_output("/test/repo", b" M modified.txt\0A  added.txt\0".to_vec())
            .with_git_numstat_error("/test/repo", "git diff failed".to_string());

        let result = get_changed_files_for_path_with_environment("/test/repo", &environment);

        assert!(result.is_ok());
        let files = result.unwrap();

        assert_eq!(files.len(), 2);

        let modified = files.iter().find(|f| f.path == "modified.txt").unwrap();
        assert_eq!(modified.additions, None);
        assert_eq!(modified.deletions, None);

        let added = files.iter().find(|f| f.path == "added.txt").unwrap();
        assert_eq!(added.additions, None);
        assert_eq!(added.deletions, None);
    }

    #[test]
    fn get_changed_files_merges_stats_when_numstat_succeeds() {
        let environment = MockChangesEnvironment::new()
            .with_path("/test/repo", true, true)
            .with_git_status_output("/test/repo", b" M modified.txt\0".to_vec())
            .with_git_numstat_output("/test/repo", b"10\t5\tmodified.txt\n".to_vec());

        let result = get_changed_files_for_path_with_environment("/test/repo", &environment);

        assert!(result.is_ok());
        let files = result.unwrap();

        let modified = files.iter().find(|f| f.path == "modified.txt").unwrap();
        assert_eq!(modified.additions, Some(10));
        assert_eq!(modified.deletions, Some(5));
    }

    // New tests for line count fallback feature

    #[test]
    fn get_changed_files_computes_line_count_for_untracked_file() {
        let environment = MockChangesEnvironment::new()
            .with_path("/test/repo", true, true)
            .with_git_status_output("/test/repo", b"?? new-file.txt\0".to_vec())
            .with_git_numstat_output("/test/repo", b"".to_vec()) // Empty numstat
            .with_file_content("/test/repo", "new-file.txt", b"line 1\nline 2\nline 3\n".to_vec());

        let result = get_changed_files_for_path_with_environment("/test/repo", &environment);

        assert!(result.is_ok());
        let files = result.unwrap();

        assert_eq!(files.len(), 1);
        let file = &files[0];
        assert_eq!(file.path, "new-file.txt");
        assert_eq!(file.status, FileStatus::Untracked);
        assert_eq!(file.additions, Some(3));
        assert_eq!(file.deletions, Some(0));
    }

    #[test]
    fn get_changed_files_computes_line_count_for_added_file() {
        let environment = MockChangesEnvironment::new()
            .with_path("/test/repo", true, true)
            .with_git_status_output("/test/repo", b"A  added-file.txt\0".to_vec())
            .with_git_numstat_output("/test/repo", b"".to_vec()) // Empty numstat
            .with_file_content("/test/repo", "added-file.txt", b"fn main() {}\nprintln!(\"hello\");\n".to_vec());

        let result = get_changed_files_for_path_with_environment("/test/repo", &environment);

        assert!(result.is_ok());
        let files = result.unwrap();

        assert_eq!(files.len(), 1);
        let file = &files[0];
        assert_eq!(file.path, "added-file.txt");
        assert_eq!(file.status, FileStatus::Added);
        assert_eq!(file.additions, Some(2));
        assert_eq!(file.deletions, Some(0));
    }

    #[test]
    fn get_changed_files_keeps_numstat_when_available_for_added_file() {
        // When numstat has values, use them (don't override with line count)
        let environment = MockChangesEnvironment::new()
            .with_path("/test/repo", true, true)
            .with_git_status_output("/test/repo", b"A  added-file.txt\0".to_vec())
            .with_git_numstat_output("/test/repo", b"5\t2\tadded-file.txt\n".to_vec())
            .with_file_content("/test/repo", "added-file.txt", b"line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\n".to_vec());

        let result = get_changed_files_for_path_with_environment("/test/repo", &environment);

        assert!(result.is_ok());
        let files = result.unwrap();

        let file = &files[0];
        // Should use numstat values, not computed line count
        assert_eq!(file.additions, Some(5));
        assert_eq!(file.deletions, Some(2));
    }

    #[test]
    fn get_changed_files_leaves_binary_file_as_none() {
        // Binary file with null bytes should remain None
        let environment = MockChangesEnvironment::new()
            .with_path("/test/repo", true, true)
            .with_git_status_output("/test/repo", b"?? image.png\0".to_vec())
            .with_git_numstat_output("/test/repo", b"".to_vec())
            .with_file_content("/test/repo", "image.png", vec![0x89, 0x50, 0x4E, 0x47]); // PNG header

        let result = get_changed_files_for_path_with_environment("/test/repo", &environment);

        assert!(result.is_ok());
        let files = result.unwrap();

        let file = &files[0];
        assert_eq!(file.additions, None);
        assert_eq!(file.deletions, None);
    }

    #[test]
    fn get_changed_files_handles_unreadable_file() {
        // File that cannot be read should remain None
        let environment = MockChangesEnvironment::new()
            .with_path("/test/repo", true, true)
            .with_git_status_output("/test/repo", b"?? inaccessible.txt\0".to_vec())
            .with_git_numstat_output("/test/repo", b"".to_vec())
            .with_file_error("/test/repo", "inaccessible.txt", "permission denied".to_string());

        let result = get_changed_files_for_path_with_environment("/test/repo", &environment);

        assert!(result.is_ok());
        let files = result.unwrap();

        let file = &files[0];
        assert_eq!(file.additions, None);
        assert_eq!(file.deletions, None);
    }

    #[test]
    fn get_changed_files_does_not_compute_for_modified_files() {
        // Modified files should not get line count fallback
        let environment = MockChangesEnvironment::new()
            .with_path("/test/repo", true, true)
            .with_git_status_output("/test/repo", b" M modified.txt\0".to_vec())
            .with_git_numstat_output("/test/repo", b"".to_vec()) // Empty numstat
            .with_file_content("/test/repo", "modified.txt", b"some content\n".to_vec());

        let result = get_changed_files_for_path_with_environment("/test/repo", &environment);

        assert!(result.is_ok());
        let files = result.unwrap();

        let file = &files[0];
        // Modified files should NOT get line count fallback
        assert_eq!(file.additions, None);
        assert_eq!(file.deletions, None);
    }

    #[test]
    fn get_changed_files_handles_empty_file() {
        // Empty file should have 0 lines
        let environment = MockChangesEnvironment::new()
            .with_path("/test/repo", true, true)
            .with_git_status_output("/test/repo", b"?? empty.txt\0".to_vec())
            .with_git_numstat_output("/test/repo", b"".to_vec())
            .with_file_content("/test/repo", "empty.txt", b"".to_vec());

        let result = get_changed_files_for_path_with_environment("/test/repo", &environment);

        assert!(result.is_ok());
        let files = result.unwrap();

        let file = &files[0];
        assert_eq!(file.additions, Some(0));
        assert_eq!(file.deletions, Some(0));
    }

    #[test]
    fn get_changed_files_handles_file_without_trailing_newline() {
        // File without trailing newline should still count lines correctly
        let environment = MockChangesEnvironment::new()
            .with_path("/test/repo", true, true)
            .with_git_status_output("/test/repo", b"?? no-newline.txt\0".to_vec())
            .with_git_numstat_output("/test/repo", b"".to_vec())
            .with_file_content("/test/repo", "no-newline.txt", b"line 1\nline 2".to_vec());

        let result = get_changed_files_for_path_with_environment("/test/repo", &environment);

        assert!(result.is_ok());
        let files = result.unwrap();

        let file = &files[0];
        // lines() handles files without trailing newline correctly
        assert_eq!(file.additions, Some(2));
        assert_eq!(file.deletions, Some(0));
    }
}
