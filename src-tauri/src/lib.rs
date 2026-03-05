mod changes;
mod repo;
mod terminal;
mod worktree;

use std::sync::Mutex;

use tauri::Manager;

use changes::get_changed_files;
use repo::{
    add_repo, get_global_terminal_startup_command, get_last_selection,
    list_repo_terminal_startup_commands, list_repos, load_registry_or_default, remove_repo,
    set_global_terminal_startup_command, set_last_selection, set_repo_terminal_startup_command,
};
use terminal::{
    close_terminal_session, create_terminal_session, list_terminal_sessions,
    resize_terminal_session, write_terminal_input, TerminalManager,
};
use worktree::{list_worktrees, start_watching_repo, stop_watching_repo, WorktreeService};

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
            get_changed_files,
            create_terminal_session,
            close_terminal_session,
            resize_terminal_session,
            write_terminal_input,
            list_terminal_sessions,
            start_watching_repo,
            stop_watching_repo,
            list_worktrees
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
