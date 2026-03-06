mod changes;
mod repo;
mod terminal;
mod worktree;

use std::sync::Mutex;

use tauri::Manager;

use changes::{
    get_changed_files, get_file_content, get_file_diff, start_watching_changes,
    stop_watching_changes, ChangesService,
};
use repo::{
    add_repo, get_global_terminal_startup_command, get_global_worktree_base_dir,
    get_last_selection, list_repo_terminal_startup_commands, list_repo_worktree_base_dirs,
    list_repos, load_registry_or_default, remove_repo, set_global_terminal_startup_command,
    set_global_worktree_base_dir, set_last_selection, set_repo_terminal_startup_command,
    set_repo_worktree_base_dir,
};
use terminal::{
    close_terminal_session, create_terminal_session, list_terminal_sessions,
    resize_terminal_session, write_terminal_input, TerminalManager,
};
use worktree::{
    add_worktree, get_current_branch, list_branches, list_worktrees, remove_worktree,
    start_watching_repo, stop_watching_repo, WorktreeService,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let registry = load_registry_or_default(app.handle());
            app.manage(Mutex::new(registry));
            app.manage(Mutex::new(TerminalManager::default()));
            app.manage(Mutex::new(WorktreeService::default()));
            app.manage(Mutex::new(ChangesService::default()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            add_repo,
            remove_repo,
            list_repos,
            get_last_selection,
            set_last_selection,
            get_global_terminal_startup_command,
            set_global_terminal_startup_command,
            list_repo_terminal_startup_commands,
            set_repo_terminal_startup_command,
            get_global_worktree_base_dir,
            set_global_worktree_base_dir,
            list_repo_worktree_base_dirs,
            set_repo_worktree_base_dir,
            get_changed_files,
            get_file_content,
            get_file_diff,
            start_watching_changes,
            stop_watching_changes,
            create_terminal_session,
            close_terminal_session,
            resize_terminal_session,
            write_terminal_input,
            list_terminal_sessions,
            start_watching_repo,
            stop_watching_repo,
            list_worktrees,
            add_worktree,
            remove_worktree,
            list_branches,
            get_current_branch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use crate::repo::RepoRegistry;

    #[test]
    fn placeholder_rust_test_passes() {
        let registry = RepoRegistry::default();
        assert!(registry.list_repos().is_empty());
    }
}
