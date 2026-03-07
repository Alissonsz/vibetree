use std::collections::{hash_map::DefaultHasher, HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

const STORE_FILE: &str = "repo_registry.json";
const STORE_REPOS_KEY: &str = "repos";
const STORE_LAST_SELECTION_KEY: &str = "last_selection";
const STORE_GLOBAL_TERMINAL_STARTUP_COMMAND_KEY: &str = "global_terminal_startup_command";
const STORE_REPO_TERMINAL_STARTUP_COMMANDS_KEY: &str = "repo_terminal_startup_commands";
const STORE_GLOBAL_WORKTREE_BASE_DIR_KEY: &str = "global_worktree_base_dir";
const STORE_REPO_WORKTREE_BASE_DIRS_KEY: &str = "repo_worktree_base_dirs";
const STORE_ATTENTION_PROFILES_KEY: &str = "attention_profiles";
const STORE_WORKTREE_DEFAULT_ATTENTION_PROFILE_BY_PATH_KEY: &str =
    "worktree_default_attention_profile_by_path";

const ATTENTION_PROFILE_OPENCODE_ID: &str = "opencode";
const ATTENTION_PROFILE_CLAUDE_ID: &str = "claude";
const ATTENTION_PROFILE_CODEX_ID: &str = "codex";
const ATTENTION_PROFILE_GEMINI_ID: &str = "gemini";
const ATTENTION_PROFILE_CUSTOM_ID: &str = "custom";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RepoInfo {
    pub id: String,
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AttentionProfile {
    pub id: String,
    pub name: String,
    pub prompt_regex: Option<String>,
    pub attention_mode: String,
    pub debounce_ms: u64,
}

#[derive(Debug, Default)]
pub struct RepoRegistry {
    repos: Vec<RepoInfo>,
    last_selection: Option<String>,
    global_terminal_startup_command: Option<String>,
    repo_terminal_startup_commands: HashMap<String, String>,
    global_worktree_base_dir: Option<String>,
    repo_worktree_base_dirs: HashMap<String, String>,
    attention_profiles: Vec<AttentionProfile>,
    worktree_default_attention_profile_by_path: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RepoRegistryStore {
    repos: Vec<RepoInfo>,
    last_selection: Option<String>,
    global_terminal_startup_command: Option<String>,
    repo_terminal_startup_commands: HashMap<String, String>,
    global_worktree_base_dir: Option<String>,
    repo_worktree_base_dirs: HashMap<String, String>,
    attention_profiles: Vec<AttentionProfile>,
    worktree_default_attention_profile_by_path: HashMap<String, String>,
}

trait RepoEnvironment {
    fn canonicalize(&self, path: &str) -> Result<PathBuf, String>;
    fn is_git_repo(&self, path: &Path) -> Result<bool, String>;
}

struct SystemRepoEnvironment;

impl RepoEnvironment for SystemRepoEnvironment {
    fn canonicalize(&self, path: &str) -> Result<PathBuf, String> {
        std::fs::canonicalize(path)
            .map_err(|error| format!("failed to canonicalize path '{path}': {error}"))
    }

    fn is_git_repo(&self, path: &Path) -> Result<bool, String> {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .arg("rev-parse")
            .arg("--is-inside-work-tree")
            .output()
            .map_err(|error| format!("failed to run git command: {error}"))?;

        if !output.status.success() {
            return Ok(false);
        }

        let stdout = String::from_utf8(output.stdout)
            .map_err(|error| format!("invalid git command output: {error}"))?;
        Ok(stdout.trim() == "true")
    }
}

fn default_attention_profiles() -> Vec<AttentionProfile> {
    vec![
        AttentionProfile {
            id: ATTENTION_PROFILE_OPENCODE_ID.to_string(),
            name: "OpenCode".to_string(),
            prompt_regex: Some("(^|\\r?\\n)>\\s*$".to_string()),
            attention_mode: "attention".to_string(),
            debounce_ms: 300,
        },
        AttentionProfile {
            id: ATTENTION_PROFILE_CLAUDE_ID.to_string(),
            name: "Claude Code".to_string(),
            prompt_regex: Some("(^|\\r?\\n)(>|›|❯)\\s*$".to_string()),
            attention_mode: "attention".to_string(),
            debounce_ms: 300,
        },
        AttentionProfile {
            id: ATTENTION_PROFILE_CODEX_ID.to_string(),
            name: "Codex".to_string(),
            prompt_regex: Some("(^|\\r?\\n)(>|›|❯)\\s*$".to_string()),
            attention_mode: "attention".to_string(),
            debounce_ms: 300,
        },
        AttentionProfile {
            id: ATTENTION_PROFILE_GEMINI_ID.to_string(),
            name: "Gemini CLI".to_string(),
            prompt_regex: Some("(^|\\r?\\n)(>|›|❯)\\s*$".to_string()),
            attention_mode: "attention".to_string(),
            debounce_ms: 300,
        },
        AttentionProfile {
            id: ATTENTION_PROFILE_CUSTOM_ID.to_string(),
            name: "Custom".to_string(),
            prompt_regex: None,
            attention_mode: "attention".to_string(),
            debounce_ms: 300,
        },
    ]
}

fn known_attention_profile_ids() -> HashSet<String> {
    default_attention_profiles()
        .into_iter()
        .map(|profile| profile.id)
        .collect()
}

fn sanitize_attention_mode(mode: String) -> String {
    match mode.as_str() {
        "off" | "attention" | "attention+notification" => mode,
        _ => "attention".to_string(),
    }
}

fn sanitize_debounce_ms(value: u64) -> u64 {
    if (50..=2000).contains(&value) {
        value
    } else {
        300
    }
}

fn normalize_attention_profiles(loaded: Vec<AttentionProfile>) -> Vec<AttentionProfile> {
    let defaults = default_attention_profiles();
    let loaded_by_id: HashMap<String, AttentionProfile> = loaded
        .into_iter()
        .map(|profile| (profile.id.clone(), profile))
        .collect();

    defaults
        .into_iter()
        .map(|default_profile| {
            if let Some(candidate) = loaded_by_id.get(&default_profile.id) {
                let name = candidate.name.trim();
                AttentionProfile {
                    id: default_profile.id,
                    name: if name.is_empty() {
                        default_profile.name
                    } else {
                        name.to_string()
                    },
                    prompt_regex: candidate
                        .prompt_regex
                        .clone()
                        .or(default_profile.prompt_regex.clone()),
                    attention_mode: sanitize_attention_mode(candidate.attention_mode.clone()),
                    debounce_ms: sanitize_debounce_ms(candidate.debounce_ms),
                }
            } else {
                default_profile
            }
        })
        .collect()
}

fn normalize_worktree_default_attention_profile_by_path(
    loaded: HashMap<String, String>,
    valid_profile_ids: &HashSet<String>,
) -> HashMap<String, String> {
    loaded
        .into_iter()
        .filter(|(path, profile_id)| {
            Path::new(path).exists() && valid_profile_ids.contains(profile_id)
        })
        .collect()
}

fn canonical_worktree_path_key(path: &str) -> String {
    std::fs::canonicalize(path)
        .map(|canonical| canonical.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string())
}

impl RepoRegistry {
    pub fn load<R: Runtime>(app: &AppHandle<R>) -> Result<Self, String> {
        let store = app
            .store_builder(STORE_FILE)
            .build()
            .map_err(|error| format!("failed to open store: {error}"))?;

        let repos = store
            .get(STORE_REPOS_KEY)
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| format!("failed to parse stored repositories: {error}"))?
            .unwrap_or_default();

        let last_selection = store
            .get(STORE_LAST_SELECTION_KEY)
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| format!("failed to parse stored selection: {error}"))?
            .unwrap_or(None);

        let global_terminal_startup_command = store
            .get(STORE_GLOBAL_TERMINAL_STARTUP_COMMAND_KEY)
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| format!("failed to parse global terminal startup command: {error}"))?
            .unwrap_or(None);

        let repo_terminal_startup_commands: HashMap<String, String> = store
            .get(STORE_REPO_TERMINAL_STARTUP_COMMANDS_KEY)
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| format!("failed to parse repo terminal startup commands: {error}"))?
            .unwrap_or_default();

        let global_worktree_base_dir = store
            .get(STORE_GLOBAL_WORKTREE_BASE_DIR_KEY)
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| format!("failed to parse global worktree base dir: {error}"))?
            .unwrap_or(None);

        let repo_worktree_base_dirs: HashMap<String, String> = store
            .get(STORE_REPO_WORKTREE_BASE_DIRS_KEY)
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| format!("failed to parse repo worktree base dirs: {error}"))?
            .unwrap_or_default();

        let attention_profiles: Vec<AttentionProfile> = store
            .get(STORE_ATTENTION_PROFILES_KEY)
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| format!("failed to parse attention profiles: {error}"))?
            .unwrap_or_default();

        let worktree_default_attention_profile_by_path: HashMap<String, String> = store
            .get(STORE_WORKTREE_DEFAULT_ATTENTION_PROFILE_BY_PATH_KEY)
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| {
                format!("failed to parse worktree default attention profiles by path: {error}")
            })?
            .unwrap_or_default();

        let global_terminal_startup_command =
            normalize_string_value(global_terminal_startup_command);
        let repo_terminal_startup_commands: HashMap<String, String> =
            repo_terminal_startup_commands
                .into_iter()
                .filter_map(|(repo_id, command)| {
                    normalize_string_value(Some(command)).map(|normalized| (repo_id, normalized))
                })
                .collect();

        let global_worktree_base_dir = normalize_string_value(global_worktree_base_dir);
        let repo_worktree_base_dirs: HashMap<String, String> = repo_worktree_base_dirs
            .into_iter()
            .filter_map(|(repo_id, dir)| {
                normalize_string_value(Some(dir)).map(|normalized| (repo_id, normalized))
            })
            .collect();
        let attention_profiles = normalize_attention_profiles(attention_profiles);
        let valid_profile_ids: HashSet<String> = attention_profiles
            .iter()
            .map(|profile| profile.id.clone())
            .collect();
        let worktree_default_attention_profile_by_path =
            normalize_worktree_default_attention_profile_by_path(
                worktree_default_attention_profile_by_path,
                &valid_profile_ids,
            );

        Ok(Self {
            repos,
            last_selection,
            global_terminal_startup_command,
            repo_terminal_startup_commands,
            global_worktree_base_dir,
            repo_worktree_base_dirs,
            attention_profiles,
            worktree_default_attention_profile_by_path,
        })
    }

    pub fn list_repos(&self) -> Vec<RepoInfo> {
        self.repos.clone()
    }

    pub fn add_repo(&mut self, raw_path: &str) -> Result<RepoInfo, String> {
        let environment = SystemRepoEnvironment;
        self.add_repo_with_environment(raw_path, &environment)
    }

    pub fn remove_repo(&mut self, repo_id: &str) -> Result<(), String> {
        let before = self.repos.len();
        self.repos.retain(|repo| repo.id != repo_id);

        if self.repos.len() == before {
            return Err(format!("repository '{repo_id}' was not found"));
        }

        if self.last_selection.as_deref() == Some(repo_id) {
            self.last_selection = None;
        }

        self.repo_terminal_startup_commands.remove(repo_id);
        self.repo_worktree_base_dirs.remove(repo_id);

        Ok(())
    }

    pub fn get_last_selection(&self) -> Option<String> {
        self.last_selection.clone()
    }

    pub fn set_last_selection(&mut self, repo_id: Option<String>) -> Result<(), String> {
        if let Some(value) = repo_id.as_deref() {
            let exists = self.repos.iter().any(|repo| repo.id == value);
            if !exists {
                return Err(format!("repository '{value}' was not found"));
            }
        }

        self.last_selection = repo_id;
        Ok(())
    }

    pub fn get_global_terminal_startup_command(&self) -> Option<String> {
        self.global_terminal_startup_command.clone()
    }

    pub fn set_global_terminal_startup_command(&mut self, command: Option<String>) {
        self.global_terminal_startup_command = normalize_string_value(command);
    }

    pub fn list_repo_terminal_startup_commands(&self) -> HashMap<String, String> {
        self.repo_terminal_startup_commands.clone()
    }

    pub fn set_repo_terminal_startup_command(
        &mut self,
        repo_id: &str,
        command: Option<String>,
    ) -> Result<(), String> {
        let repo_exists = self.repos.iter().any(|repo| repo.id == repo_id);
        if !repo_exists {
            return Err(format!("repository '{repo_id}' was not found"));
        }

        match normalize_string_value(command) {
            Some(normalized) => {
                self.repo_terminal_startup_commands
                    .insert(repo_id.to_string(), normalized);
            }
            None => {
                self.repo_terminal_startup_commands.remove(repo_id);
            }
        }

        Ok(())
    }

    pub fn get_global_worktree_base_dir(&self) -> Option<String> {
        self.global_worktree_base_dir.clone()
    }

    pub fn set_global_worktree_base_dir(&mut self, dir: Option<String>) {
        self.global_worktree_base_dir = normalize_string_value(dir);
    }

    pub fn list_repo_worktree_base_dirs(&self) -> HashMap<String, String> {
        self.repo_worktree_base_dirs.clone()
    }

    pub fn set_repo_worktree_base_dir(
        &mut self,
        repo_id: &str,
        dir: Option<String>,
    ) -> Result<(), String> {
        let repo_exists = self.repos.iter().any(|repo| repo.id == repo_id);
        if !repo_exists {
            return Err(format!("repository '{repo_id}' was not found"));
        }

        match normalize_string_value(dir) {
            Some(normalized) => {
                self.repo_worktree_base_dirs
                    .insert(repo_id.to_string(), normalized);
            }
            None => {
                self.repo_worktree_base_dirs.remove(repo_id);
            }
        }

        Ok(())
    }

    pub fn get_attention_profiles(&self) -> Vec<AttentionProfile> {
        self.attention_profiles.clone()
    }

    pub fn set_attention_profiles(&mut self, profiles: Vec<AttentionProfile>) {
        self.attention_profiles = normalize_attention_profiles(profiles);

        let valid_profile_ids: HashSet<String> = self
            .attention_profiles
            .iter()
            .map(|profile| profile.id.clone())
            .collect();

        self.worktree_default_attention_profile_by_path =
            normalize_worktree_default_attention_profile_by_path(
                self.worktree_default_attention_profile_by_path.clone(),
                &valid_profile_ids,
            );
    }

    pub fn list_worktree_default_attention_profiles(&self) -> HashMap<String, String> {
        self.worktree_default_attention_profile_by_path.clone()
    }

    pub fn set_worktree_default_attention_profile(
        &mut self,
        worktree_path: &str,
        profile_id: Option<String>,
    ) -> Result<(), String> {
        let canonical_path = canonical_worktree_path_key(worktree_path);
        let valid_profile_ids = known_attention_profile_ids();

        match profile_id {
            Some(id) => {
                if !valid_profile_ids.contains(&id) {
                    return Err(format!("unknown attention profile id '{id}'"));
                }
                self.worktree_default_attention_profile_by_path
                    .remove(worktree_path);
                self.worktree_default_attention_profile_by_path
                    .insert(canonical_path, id);
            }
            None => {
                self.worktree_default_attention_profile_by_path
                    .remove(worktree_path);
                self.worktree_default_attention_profile_by_path
                    .remove(&canonical_path);
            }
        }

        Ok(())
    }

    pub fn persist<R: Runtime>(&self, app: &AppHandle<R>) -> Result<(), String> {
        let store = app
            .store_builder(STORE_FILE)
            .build()
            .map_err(|error| format!("failed to open store: {error}"))?;

        let payload = RepoRegistryStore {
            repos: self.repos.clone(),
            last_selection: self.last_selection.clone(),
            global_terminal_startup_command: self.global_terminal_startup_command.clone(),
            repo_terminal_startup_commands: self.repo_terminal_startup_commands.clone(),
            global_worktree_base_dir: self.global_worktree_base_dir.clone(),
            repo_worktree_base_dirs: self.repo_worktree_base_dirs.clone(),
            attention_profiles: self.attention_profiles.clone(),
            worktree_default_attention_profile_by_path: self
                .worktree_default_attention_profile_by_path
                .clone(),
        };

        store.set(
            STORE_REPOS_KEY,
            serde_json::to_value(payload.repos)
                .map_err(|error| format!("failed to serialize repositories: {error}"))?,
        );
        store.set(
            STORE_LAST_SELECTION_KEY,
            serde_json::to_value(payload.last_selection)
                .map_err(|error| format!("failed to serialize last selection: {error}"))?,
        );
        store.set(
            STORE_GLOBAL_TERMINAL_STARTUP_COMMAND_KEY,
            serde_json::to_value(payload.global_terminal_startup_command).map_err(|error| {
                format!("failed to serialize global terminal startup command: {error}")
            })?,
        );
        store.set(
            STORE_REPO_TERMINAL_STARTUP_COMMANDS_KEY,
            serde_json::to_value(payload.repo_terminal_startup_commands).map_err(|error| {
                format!("failed to serialize repo terminal startup commands: {error}")
            })?,
        );
        store.set(
            STORE_GLOBAL_WORKTREE_BASE_DIR_KEY,
            serde_json::to_value(payload.global_worktree_base_dir).map_err(|error| {
                format!("failed to serialize global worktree base dir: {error}")
            })?,
        );
        store.set(
            STORE_REPO_WORKTREE_BASE_DIRS_KEY,
            serde_json::to_value(payload.repo_worktree_base_dirs)
                .map_err(|error| format!("failed to serialize repo worktree base dirs: {error}"))?,
        );
        store.set(
            STORE_ATTENTION_PROFILES_KEY,
            serde_json::to_value(payload.attention_profiles)
                .map_err(|error| format!("failed to serialize attention profiles: {error}"))?,
        );
        store.set(
            STORE_WORKTREE_DEFAULT_ATTENTION_PROFILE_BY_PATH_KEY,
            serde_json::to_value(payload.worktree_default_attention_profile_by_path).map_err(
                |error| {
                    format!(
                        "failed to serialize worktree default attention profiles by path: {error}"
                    )
                },
            )?,
        );
        store
            .save()
            .map_err(|error| format!("failed to save store: {error}"))
    }

    fn add_repo_with_environment<E: RepoEnvironment>(
        &mut self,
        raw_path: &str,
        environment: &E,
    ) -> Result<RepoInfo, String> {
        let canonical_path = environment.canonicalize(raw_path)?;
        if !environment.is_git_repo(&canonical_path)? {
            return Err(format!(
                "path '{}' is not a git repository",
                canonical_path.display()
            ));
        }

        let canonical = canonical_path.to_string_lossy().to_string();
        let duplicate = self.repos.iter().any(|repo| repo.path == canonical);
        if duplicate {
            return Err(format!("repository '{}' is already registered", canonical));
        }

        let name = canonical_path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.to_string())
            .unwrap_or_else(|| canonical.clone());

        let info = RepoInfo {
            id: stable_repo_id(&canonical),
            path: canonical,
            name,
        };

        self.repos.push(info.clone());
        Ok(info)
    }
}

pub fn load_registry_or_default<R: Runtime>(app: &AppHandle<R>) -> RepoRegistry {
    RepoRegistry::load(app).unwrap_or_default()
}

fn lock_registry<'a>(
    state: &'a State<'_, Mutex<RepoRegistry>>,
) -> Result<std::sync::MutexGuard<'a, RepoRegistry>, String> {
    state
        .lock()
        .map_err(|error| format!("failed to lock repository state: {error}"))
}

#[tauri::command]
pub fn add_repo(
    path: String,
    app: AppHandle,
    state: State<'_, Mutex<RepoRegistry>>,
) -> Result<RepoInfo, String> {
    let mut registry = lock_registry(&state)?;
    let repo = registry.add_repo(&path)?;
    registry.persist(&app)?;
    Ok(repo)
}

#[tauri::command]
pub fn remove_repo(
    id: String,
    app: AppHandle,
    state: State<'_, Mutex<RepoRegistry>>,
) -> Result<(), String> {
    let mut registry = lock_registry(&state)?;
    registry.remove_repo(&id)?;
    registry.persist(&app)
}

#[tauri::command]
pub fn list_repos(state: State<'_, Mutex<RepoRegistry>>) -> Result<Vec<RepoInfo>, String> {
    let registry = lock_registry(&state)?;
    Ok(registry.list_repos())
}

#[tauri::command]
pub fn get_last_selection(state: State<'_, Mutex<RepoRegistry>>) -> Result<Option<String>, String> {
    let registry = lock_registry(&state)?;
    Ok(registry.get_last_selection())
}

#[tauri::command]
pub fn set_last_selection(
    id: Option<String>,
    app: AppHandle,
    state: State<'_, Mutex<RepoRegistry>>,
) -> Result<(), String> {
    let mut registry = lock_registry(&state)?;
    registry.set_last_selection(id)?;
    registry.persist(&app)
}

#[tauri::command]
pub fn get_global_terminal_startup_command(
    state: State<'_, Mutex<RepoRegistry>>,
) -> Result<Option<String>, String> {
    let registry = lock_registry(&state)?;
    Ok(registry.get_global_terminal_startup_command())
}

#[tauri::command]
pub fn set_global_terminal_startup_command(
    command: Option<String>,
    app: AppHandle,
    state: State<'_, Mutex<RepoRegistry>>,
) -> Result<(), String> {
    let mut registry = lock_registry(&state)?;
    registry.set_global_terminal_startup_command(command);
    registry.persist(&app)
}

#[tauri::command]
pub fn list_repo_terminal_startup_commands(
    state: State<'_, Mutex<RepoRegistry>>,
) -> Result<HashMap<String, String>, String> {
    let registry = lock_registry(&state)?;
    Ok(registry.list_repo_terminal_startup_commands())
}

#[tauri::command]
pub fn set_repo_terminal_startup_command(
    repo_id: String,
    command: Option<String>,
    app: AppHandle,
    state: State<'_, Mutex<RepoRegistry>>,
) -> Result<(), String> {
    let mut registry = lock_registry(&state)?;
    registry.set_repo_terminal_startup_command(&repo_id, command)?;
    registry.persist(&app)
}

#[tauri::command]
pub fn get_global_worktree_base_dir(
    state: State<'_, Mutex<RepoRegistry>>,
) -> Result<Option<String>, String> {
    let registry = lock_registry(&state)?;
    Ok(registry.get_global_worktree_base_dir())
}

#[tauri::command]
pub fn set_global_worktree_base_dir(
    dir: Option<String>,
    app: AppHandle,
    state: State<'_, Mutex<RepoRegistry>>,
) -> Result<(), String> {
    let mut registry = lock_registry(&state)?;
    registry.set_global_worktree_base_dir(dir);
    registry.persist(&app)
}

#[tauri::command]
pub fn list_repo_worktree_base_dirs(
    state: State<'_, Mutex<RepoRegistry>>,
) -> Result<HashMap<String, String>, String> {
    let registry = lock_registry(&state)?;
    Ok(registry.list_repo_worktree_base_dirs())
}

#[tauri::command]
pub fn set_repo_worktree_base_dir(
    repo_id: String,
    dir: Option<String>,
    app: AppHandle,
    state: State<'_, Mutex<RepoRegistry>>,
) -> Result<(), String> {
    let mut registry = lock_registry(&state)?;
    registry.set_repo_worktree_base_dir(&repo_id, dir)?;
    registry.persist(&app)
}

#[tauri::command]
pub fn get_attention_profiles(
    state: State<'_, Mutex<RepoRegistry>>,
) -> Result<Vec<AttentionProfile>, String> {
    let registry = lock_registry(&state)?;
    Ok(registry.get_attention_profiles())
}

#[tauri::command]
pub fn set_attention_profiles(
    profiles: Vec<AttentionProfile>,
    app: AppHandle,
    state: State<'_, Mutex<RepoRegistry>>,
) -> Result<(), String> {
    let mut registry = lock_registry(&state)?;
    registry.set_attention_profiles(profiles);
    registry.persist(&app)
}

#[tauri::command]
pub fn list_worktree_default_attention_profiles(
    state: State<'_, Mutex<RepoRegistry>>,
) -> Result<HashMap<String, String>, String> {
    let registry = lock_registry(&state)?;
    Ok(registry.list_worktree_default_attention_profiles())
}

#[tauri::command]
pub fn set_worktree_default_attention_profile(
    worktree_path: String,
    profile_id: Option<String>,
    app: AppHandle,
    state: State<'_, Mutex<RepoRegistry>>,
) -> Result<(), String> {
    let mut registry = lock_registry(&state)?;
    registry.set_worktree_default_attention_profile(&worktree_path, profile_id)?;
    registry.persist(&app)
}

fn normalize_string_value(command: Option<String>) -> Option<String> {
    command.and_then(|value| {
        let single_line = value.replace(['\r', '\n'], " ");
        let trimmed = single_line.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn stable_repo_id(canonical_path: &str) -> String {
    let mut hasher_a = DefaultHasher::new();
    canonical_path.hash(&mut hasher_a);

    let mut hasher_b = DefaultHasher::new();
    "vibetree".hash(&mut hasher_b);
    canonical_path.hash(&mut hasher_b);

    let value = ((hasher_a.finish() as u128) << 64) | hasher_b.finish() as u128;
    Uuid::from_u128(value).to_string()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};

    use super::{
        canonical_worktree_path_key, normalize_attention_profiles,
        normalize_worktree_default_attention_profile_by_path, AttentionProfile, RepoEnvironment,
        RepoRegistry,
    };

    struct MockRepoEnvironment {
        canonical_paths: HashMap<String, PathBuf>,
        git_paths: HashMap<PathBuf, bool>,
    }

    impl MockRepoEnvironment {
        fn new() -> Self {
            Self {
                canonical_paths: HashMap::new(),
                git_paths: HashMap::new(),
            }
        }

        fn add_path(mut self, input: &str, canonical: &str, is_git_repo: bool) -> Self {
            let canonical_path = PathBuf::from(canonical);
            self.canonical_paths
                .insert(input.to_string(), canonical_path.clone());
            self.git_paths.insert(canonical_path, is_git_repo);
            self
        }
    }

    impl RepoEnvironment for MockRepoEnvironment {
        fn canonicalize(&self, path: &str) -> Result<PathBuf, String> {
            self.canonical_paths
                .get(path)
                .cloned()
                .ok_or_else(|| format!("missing canonical mock for '{path}'"))
        }

        fn is_git_repo(&self, path: &Path) -> Result<bool, String> {
            Ok(*self.git_paths.get(path).unwrap_or(&false))
        }
    }

    #[test]
    fn add_valid_repo_path_succeeds() {
        let mut registry = RepoRegistry::default();
        let environment = MockRepoEnvironment::new().add_path("./repo", "/tmp/repo", true);

        let result = registry.add_repo_with_environment("./repo", &environment);

        assert!(result.is_ok());
        let repos = registry.list_repos();
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].path, "/tmp/repo");
        assert_eq!(repos[0].name, "repo");
    }

    #[test]
    fn add_duplicate_canonical_path_fails() {
        let mut registry = RepoRegistry::default();
        let environment = MockRepoEnvironment::new()
            .add_path("./repo", "/tmp/repo", true)
            .add_path("/tmp/../tmp/repo", "/tmp/repo", true);

        let first = registry.add_repo_with_environment("./repo", &environment);
        assert!(first.is_ok());

        let second = registry.add_repo_with_environment("/tmp/../tmp/repo", &environment);

        assert!(second.is_err());
        assert_eq!(registry.list_repos().len(), 1);
    }

    #[test]
    fn add_non_git_path_fails() {
        let mut registry = RepoRegistry::default();
        let environment =
            MockRepoEnvironment::new().add_path("./not-a-repo", "/tmp/not-a-repo", false);

        let result = registry.add_repo_with_environment("./not-a-repo", &environment);

        assert!(result.is_err());
        assert!(registry.list_repos().is_empty());
    }

    #[test]
    fn remove_repo_by_id_succeeds() {
        let mut registry = RepoRegistry::default();
        let environment = MockRepoEnvironment::new().add_path("./repo", "/tmp/repo", true);
        let added = registry
            .add_repo_with_environment("./repo", &environment)
            .expect("repo should be inserted");

        let remove_result = registry.remove_repo(&added.id);

        assert!(remove_result.is_ok());
        assert!(registry.list_repos().is_empty());
    }

    #[test]
    fn set_repo_terminal_startup_command_requires_existing_repo() {
        let mut registry = RepoRegistry::default();

        let result = registry
            .set_repo_terminal_startup_command("repo-missing", Some("opencode".to_string()));

        assert!(result.is_err());
    }

    #[test]
    fn set_repo_terminal_startup_command_sets_and_clears_override() {
        let mut registry = RepoRegistry::default();
        let environment = MockRepoEnvironment::new().add_path("./repo", "/tmp/repo", true);
        let added = registry
            .add_repo_with_environment("./repo", &environment)
            .expect("repo should be inserted");

        let set_result =
            registry.set_repo_terminal_startup_command(&added.id, Some(" tmux new ".to_string()));
        assert!(set_result.is_ok());

        let commands = registry.list_repo_terminal_startup_commands();
        assert_eq!(commands.get(&added.id), Some(&"tmux new".to_string()));

        let clear_result = registry.set_repo_terminal_startup_command(&added.id, None);
        assert!(clear_result.is_ok());
        assert!(registry.list_repo_terminal_startup_commands().is_empty());
    }

    #[test]
    fn set_global_terminal_startup_command_normalizes_blank_values() {
        let mut registry = RepoRegistry::default();

        registry.set_global_terminal_startup_command(Some("  opencode  ".to_string()));
        assert_eq!(
            registry.get_global_terminal_startup_command(),
            Some("opencode".to_string())
        );

        registry.set_global_terminal_startup_command(Some("   ".to_string()));
        assert_eq!(registry.get_global_terminal_startup_command(), None);
    }

    #[test]
    fn list_repositories_returns_all_entries() {
        let mut registry = RepoRegistry::default();
        let environment = MockRepoEnvironment::new()
            .add_path("./repo-a", "/tmp/repo-a", true)
            .add_path("./repo-b", "/tmp/repo-b", true);

        let first = registry
            .add_repo_with_environment("./repo-a", &environment)
            .expect("first repo should be inserted");
        let second = registry
            .add_repo_with_environment("./repo-b", &environment)
            .expect("second repo should be inserted");

        let repos = registry.list_repos();

        assert_eq!(repos.len(), 2);
        assert_eq!(repos[0].id, first.id);
        assert_eq!(repos[1].id, second.id);
    }

    #[test]
    fn attention_profiles_seed_defaults_when_missing() {
        let profiles = normalize_attention_profiles(vec![]);
        assert_eq!(profiles.len(), 5);
        assert_eq!(profiles[0].id, "opencode");
        assert_eq!(
            profiles[0].prompt_regex,
            Some("(^|\\r?\\n)>\\s*$".to_string())
        );
    }

    #[test]
    fn attention_profiles_sanitize_mode_and_debounce() {
        let profiles = normalize_attention_profiles(vec![AttentionProfile {
            id: "opencode".to_string(),
            name: "  ".to_string(),
            prompt_regex: Some("(^|\\r?\\n)>\\s*$".to_string()),
            attention_mode: "invalid".to_string(),
            debounce_ms: 5,
        }]);

        let opencode = profiles
            .into_iter()
            .find(|profile| profile.id == "opencode")
            .expect("opencode should exist");

        assert_eq!(opencode.name, "OpenCode");
        assert_eq!(opencode.attention_mode, "attention");
        assert_eq!(opencode.debounce_ms, 300);
    }

    #[test]
    fn attention_profiles_restore_builtin_regex_when_saved_as_null() {
        let profiles = normalize_attention_profiles(vec![AttentionProfile {
            id: "codex".to_string(),
            name: "Codex".to_string(),
            prompt_regex: None,
            attention_mode: "attention+notification".to_string(),
            debounce_ms: 300,
        }]);

        let codex = profiles
            .into_iter()
            .find(|profile| profile.id == "codex")
            .expect("codex should exist");

        assert_eq!(
            codex.prompt_regex,
            Some("(^|\\r?\\n)(>|›|❯)\\s*$".to_string())
        );
    }

    #[test]
    fn set_worktree_default_attention_profile_uses_canonical_fallback() {
        let mut registry = RepoRegistry::default();
        let path = "/this/path/does/not/exist";

        let result =
            registry.set_worktree_default_attention_profile(path, Some("opencode".to_string()));
        assert!(result.is_ok());

        let mapping = registry.list_worktree_default_attention_profiles();
        assert_eq!(mapping.get(path), Some(&"opencode".to_string()));

        let canonical = canonical_worktree_path_key(path);
        assert_eq!(canonical, path);
    }

    #[test]
    fn normalize_worktree_defaults_drops_stale_or_unknown_entries() {
        let temp_dir = std::env::temp_dir().join("vibetree-attention-profile-test");
        std::fs::create_dir_all(&temp_dir).expect("failed to create temp dir");

        let existing_path = temp_dir.to_string_lossy().to_string();
        let missing_path = "/tmp/vibetree-missing-attention-path".to_string();
        let valid_ids = ["opencode".to_string(), "claude".to_string()]
            .into_iter()
            .collect();

        let normalized = normalize_worktree_default_attention_profile_by_path(
            HashMap::from([
                (existing_path.clone(), "opencode".to_string()),
                (existing_path.clone() + "-unknown", "invalid".to_string()),
                (missing_path, "opencode".to_string()),
            ]),
            &valid_ids,
        );

        assert_eq!(
            normalized.get(&existing_path),
            Some(&"opencode".to_string())
        );
        assert_eq!(normalized.len(), 1);
    }
}
