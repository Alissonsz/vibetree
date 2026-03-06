use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

const WORKTREE_EVENT_NAME: &str = "worktrees-changed";
const DEBOUNCE_WINDOW: Duration = Duration::from_millis(300);
const POLL_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorktreeInfo {
    pub path: String,
    pub head: String,
    pub branch: Option<String>,
    pub is_bare: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct WorktreesChangedEvent {
    pub repo_id: String,
    pub worktrees: Vec<WorktreeInfo>,
}

struct WorktreeWatcher {
    stop_tx: Sender<()>,
    thread_handle: Option<JoinHandle<()>>,
    _watcher: Option<RecommendedWatcher>,
}

impl WorktreeWatcher {
    fn start(repo_id: String, repo_path: String, app: Option<AppHandle>) -> Result<Self, String> {
        let initial_worktrees = list_worktrees_for_path(&repo_path)?;

        if app.is_none() {
            let (stop_tx, _stop_rx) = mpsc::channel();
            return Ok(Self {
                stop_tx,
                thread_handle: None,
                _watcher: None,
            });
        }

        let app_handle = match app {
            Some(handle) => handle,
            None => {
                return Err("app handle was not available".to_string());
            }
        };
        let payload = WorktreesChangedEvent {
            repo_id: repo_id.clone(),
            worktrees: initial_worktrees.clone(),
        };
        let _ = app_handle.emit(WORKTREE_EVENT_NAME, payload);

        let (event_tx, event_rx) = mpsc::channel();
        let (stop_tx, stop_rx) = mpsc::channel();

        let watcher = initialize_watcher(&repo_path, event_tx).ok();
        let watcher_active = watcher.is_some();
        let app_for_thread = app_handle.clone();
        let repo_path_for_thread = repo_path.clone();

        let thread_handle = thread::spawn(move || {
            run_watch_loop(
                repo_id,
                repo_path_for_thread,
                app_for_thread,
                event_rx,
                stop_rx,
                initial_worktrees,
                watcher_active,
            );
        });

        Ok(Self {
            stop_tx,
            thread_handle: Some(thread_handle),
            _watcher: watcher,
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
pub struct WorktreeService {
    watchers: HashMap<String, WorktreeWatcher>,
}

impl WorktreeService {
    pub fn start_watching(
        &mut self,
        repo_id: String,
        repo_path: String,
        app: Option<AppHandle>,
    ) -> Result<(), String> {
        if let Some(existing) = self.watchers.remove(&repo_id) {
            existing.stop();
        }

        let watcher = WorktreeWatcher::start(repo_id.clone(), repo_path, app)?;
        self.watchers.insert(repo_id, watcher);
        Ok(())
    }

    pub fn stop_watching(&mut self, repo_id: &str) {
        if let Some(watcher) = self.watchers.remove(repo_id) {
            watcher.stop();
        }
    }

    pub fn list_worktrees(&self, repo_path: &str) -> Result<Vec<WorktreeInfo>, String> {
        list_worktrees_for_path(repo_path)
    }
}

fn run_watch_loop(
    repo_id: String,
    repo_path: String,
    app: AppHandle,
    event_rx: Receiver<()>,
    stop_rx: Receiver<()>,
    mut previous_worktrees: Vec<WorktreeInfo>,
    watcher_active: bool,
) {
    loop {
        if stop_rx.try_recv().is_ok() {
            break;
        }

        let should_refresh = if watcher_active {
            match event_rx.recv_timeout(POLL_INTERVAL) {
                Ok(_) => {
                    drain_debounced_events(&event_rx, DEBOUNCE_WINDOW);
                    true
                }
                Err(mpsc::RecvTimeoutError::Timeout) => false,
                Err(mpsc::RecvTimeoutError::Disconnected) => true,
            }
        } else {
            match stop_rx.recv_timeout(POLL_INTERVAL) {
                Ok(_) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => true,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        };

        if !should_refresh {
            continue;
        }

        let next_worktrees = match list_worktrees_for_path(&repo_path) {
            Ok(worktrees) => worktrees,
            Err(_) => continue,
        };

        if next_worktrees == previous_worktrees {
            continue;
        }

        previous_worktrees = next_worktrees.clone();
        let payload = WorktreesChangedEvent {
            repo_id: repo_id.clone(),
            worktrees: next_worktrees,
        };
        let _ = app.emit(WORKTREE_EVENT_NAME, payload);
    }
}

fn initialize_watcher(repo_path: &str, event_tx: Sender<()>) -> Result<RecommendedWatcher, String> {
    let common_dir = resolve_git_common_dir(repo_path)?;
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| {
            if result.is_ok() {
                let _ = event_tx.send(());
            }
        },
        Config::default(),
    )
    .map_err(|error| format!("failed to initialize watcher: {error}"))?;

    watcher
        .watch(common_dir.as_path(), RecursiveMode::Recursive)
        .map_err(|error| {
            format!(
                "failed to watch git common dir '{}': {error}",
                common_dir.display()
            )
        })?;

    Ok(watcher)
}

fn resolve_git_common_dir(repo_path: &str) -> Result<PathBuf, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("rev-parse")
        .arg("--git-common-dir")
        .output()
        .map_err(|error| format!("failed to run git command: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("failed to resolve git common dir: {stderr}"));
    }

    let raw = String::from_utf8(output.stdout)
        .map_err(|error| format!("invalid git command output: {error}"))?;
    let value = raw.trim();
    if value.is_empty() {
        return Err("git common dir output was empty".to_string());
    }

    let candidate = PathBuf::from(value);
    let common_dir = if candidate.is_absolute() {
        candidate
    } else {
        Path::new(repo_path).join(candidate)
    };

    std::fs::canonicalize(&common_dir).map_err(|error| {
        format!(
            "failed to canonicalize git common dir '{}': {error}",
            common_dir.display()
        )
    })
}

pub fn list_worktrees_for_path(repo_path: &str) -> Result<Vec<WorktreeInfo>, String> {
    let repo = Path::new(repo_path);
    if !repo.exists() {
        return Err(format!("repository path does not exist: {repo_path}"));
    }
    if !repo.is_dir() {
        return Err(format!("repository path is not a directory: {repo_path}"));
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("list")
        .arg("--porcelain")
        .output()
        .map_err(|error| format!("failed to run git command: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("failed to list worktrees: {stderr}"));
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|error| format!("invalid git command output: {error}"))?;
    parse_worktree_list(&stdout)
}

pub fn parse_worktree_list(output: &str) -> Result<Vec<WorktreeInfo>, String> {
    let mut worktrees = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_head = String::new();
    let mut current_branch: Option<String> = None;
    let mut current_is_bare = false;

    let finalize = |path: &mut Option<String>,
                    head: &mut String,
                    branch: &mut Option<String>,
                    is_bare: &mut bool,
                    list: &mut Vec<WorktreeInfo>| {
        if let Some(path_value) = path.take() {
            list.push(WorktreeInfo {
                path: path_value,
                head: std::mem::take(head),
                branch: branch.take(),
                is_bare: *is_bare,
            });
            *is_bare = false;
        }
    };

    for line in output.lines() {
        if line.trim().is_empty() {
            finalize(
                &mut current_path,
                &mut current_head,
                &mut current_branch,
                &mut current_is_bare,
                &mut worktrees,
            );
            continue;
        }

        if let Some(value) = line.strip_prefix("worktree ") {
            finalize(
                &mut current_path,
                &mut current_head,
                &mut current_branch,
                &mut current_is_bare,
                &mut worktrees,
            );
            current_path = Some(value.to_string());
            continue;
        }

        if let Some(value) = line.strip_prefix("HEAD ") {
            current_head = value.to_string();
            continue;
        }

        if let Some(value) = line.strip_prefix("branch ") {
            current_branch = Some(value.to_string());
            continue;
        }

        if line == "bare" {
            current_is_bare = true;
            continue;
        }

        if line == "detached" {
            current_branch = None;
            continue;
        }
    }

    finalize(
        &mut current_path,
        &mut current_head,
        &mut current_branch,
        &mut current_is_bare,
        &mut worktrees,
    );

    if worktrees.is_empty() && !output.trim().is_empty() {
        return Err("failed to parse git worktree list output".to_string());
    }

    Ok(worktrees)
}

fn drain_debounced_events(event_rx: &Receiver<()>, debounce_window: Duration) -> usize {
    let mut drained = 0;
    while event_rx.recv_timeout(debounce_window).is_ok() {
        drained += 1;
    }
    drained
}

fn lock_service<'a>(
    state: &'a State<'_, Mutex<WorktreeService>>,
) -> Result<std::sync::MutexGuard<'a, WorktreeService>, String> {
    state
        .lock()
        .map_err(|error| format!("failed to lock worktree state: {error}"))
}

#[tauri::command]
pub fn start_watching_repo(
    repo_id: String,
    repo_path: String,
    app: AppHandle,
    state: State<'_, Mutex<WorktreeService>>,
) -> Result<(), String> {
    let mut service = lock_service(&state)?;
    service.start_watching(repo_id, repo_path, Some(app))
}

#[tauri::command]
pub fn stop_watching_repo(
    repo_id: String,
    state: State<'_, Mutex<WorktreeService>>,
) -> Result<(), String> {
    let mut service = lock_service(&state)?;
    service.stop_watching(&repo_id);
    Ok(())
}

#[tauri::command]
pub fn list_worktrees(
    repo_path: String,
    state: State<'_, Mutex<WorktreeService>>,
) -> Result<Vec<WorktreeInfo>, String> {
    let service = lock_service(&state)?;
    service.list_worktrees(&repo_path)
}

#[tauri::command]
pub async fn add_worktree(
    repo_path: String,
    path: String,
    branch: Option<String>,
    base_ref: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new("git");
        cmd.arg("-C").arg(&repo_path).arg("worktree").arg("add");

        if let Some(b) = branch {
            cmd.arg("-b").arg(&b);
        }
        
        cmd.arg(&path);
        
        if let Some(r) = base_ref {
            cmd.arg(&r);
        }
        
        let output = cmd.output().map_err(|e| format!("failed to execute git command: {e}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("Task panicked: {}", e))?
}

#[tauri::command]
pub async fn remove_worktree(
    repo_path: String,
    worktree_path: String,
    force: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new("git");
        cmd.arg("-C").arg(&repo_path).arg("worktree").arg("remove");
        if force {
            cmd.arg("--force");
        }
        cmd.arg(&worktree_path);
        
        let output = cmd.output().map_err(|e| format!("failed to execute git command: {e}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("Task panicked: {}", e))?
}

#[tauri::command]
pub fn list_branches(repo_path: String) -> Result<Vec<String>, String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .arg("for-each-ref")
        .arg("--format=%(refname:short)")
        .arg("refs/heads/")
        .output()
        .map_err(|e| format!("failed to execute git command: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|e| format!("invalid git command output: {e}"))?;
    
    Ok(stdout.lines().map(|s| s.to_string()).collect())
}

#[tauri::command]
pub fn get_current_branch(repo_path: String) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .output()
        .map_err(|e| format!("failed to execute git command: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|e| format!("invalid git command output: {e}"))?;
        
    Ok(stdout.trim().to_string())
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;
    use std::time::Duration;

    use super::{drain_debounced_events, list_worktrees_for_path, parse_worktree_list};

    #[test]
    fn parse_porcelain_output_with_linked_worktrees() {
        let output = "worktree /tmp/main\nHEAD abc123def\nbranch refs/heads/main\n\nworktree /tmp/feature\nHEAD def456abc\nbranch refs/heads/feature\n";

        let worktrees = parse_worktree_list(output).expect("parse should succeed");
        assert_eq!(worktrees.len(), 2);
        assert_eq!(worktrees[0].path, "/tmp/main");
        assert_eq!(worktrees[0].head, "abc123def");
        assert_eq!(worktrees[0].branch.as_deref(), Some("refs/heads/main"));
        assert!(!worktrees[0].is_bare);
        assert_eq!(worktrees[1].path, "/tmp/feature");
        assert_eq!(worktrees[1].branch.as_deref(), Some("refs/heads/feature"));
    }

    #[test]
    fn parse_handles_bare_and_detached_worktrees() {
        let output = "worktree /tmp/bare\nHEAD abc123\nbare\n\nworktree /tmp/detached\nHEAD def456\ndetached\n\nworktree /tmp/branch\nHEAD fed789\nbranch refs/heads/topic\n";

        let worktrees = parse_worktree_list(output).expect("parse should succeed");
        assert_eq!(worktrees.len(), 3);
        assert!(worktrees[0].is_bare);
        assert_eq!(worktrees[0].branch, None);
        assert_eq!(worktrees[1].branch, None);
        assert!(!worktrees[1].is_bare);
        assert_eq!(worktrees[2].branch.as_deref(), Some("refs/heads/topic"));
    }

    #[test]
    fn parse_invalid_output_returns_error() {
        let output = "HEAD abc123\nbranch refs/heads/main\n";
        let result = parse_worktree_list(output);
        assert!(result.is_err());
    }

    #[test]
    fn debounce_drain_coalesces_quick_events() {
        let (tx, rx) = mpsc::channel();
        tx.send(()).expect("first event");
        tx.send(()).expect("second event");
        tx.send(()).expect("third event");

        rx.recv_timeout(Duration::from_millis(10))
            .expect("first event should be present");

        let drained = drain_debounced_events(&rx, Duration::from_millis(30));
        assert_eq!(drained, 2);
    }

    #[test]
    fn list_worktrees_invalid_path_returns_error() {
        let result = list_worktrees_for_path("/path/does/not/exist");
        assert!(result.is_err());
    }
}
