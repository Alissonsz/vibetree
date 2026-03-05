use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
    sync::{Arc, Mutex},
    thread,
};

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Clone, Serialize)]
pub struct TerminalOutputEvent {
    pub session_id: String,
    pub data: String,
}

#[derive(Clone, Serialize)]
pub struct TerminalExitEvent {
    pub session_id: String,
    pub exit_code: i32,
}

#[derive(Clone, Serialize)]
pub struct TerminalSessionInfo {
    pub session_id: String,
    pub worktree_path: String,
}

pub struct TerminalSession {
    pub session_id: String,
    pub worktree_path: String,
    pub killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
    pub reader: Arc<Mutex<Box<dyn Read + Send>>>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
}

#[derive(Default)]
pub struct TerminalManager {
    sessions: HashMap<String, TerminalSession>,
}

fn write_startup_command(
    writer: &mut dyn Write,
    startup_command: Option<String>,
) -> Result<(), String> {
    let Some(command) = startup_command.and_then(|value| {
        let single_line = value.replace(['\r', '\n'], " ");
        let trimmed = single_line.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }) else {
        return Ok(());
    };

    writer
        .write_all(format!("{command}\n").as_bytes())
        .map_err(|error| format!("failed to run startup command: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("failed to flush startup command: {error}"))
}

impl TerminalManager {
    pub fn create_session(
        &mut self,
        worktree_path: String,
        app: Option<AppHandle>,
        startup_command: Option<String>,
    ) -> Result<String, String> {
        let path = Path::new(&worktree_path);
        if !path.exists() {
            return Err(format!("worktree path does not exist: {worktree_path}"));
        }

        if !path.is_dir() {
            return Err(format!("worktree path is not a directory: {worktree_path}"));
        }

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("failed to allocate pty: {error}"))?;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut command = CommandBuilder::new(&shell);

        // Start as a login shell to ensure environment variables are loaded
        if shell.ends_with("/zsh") || shell.ends_with("/bash") || shell.ends_with("/sh") {
            command.arg("-l");
        } else if shell.ends_with("/fish") {
            command.arg("-l");
        }

        command.cwd(worktree_path.clone());
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");

        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("failed to spawn shell in pty: {error}"))?;

        let killer = child.clone_killer();

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("failed to get pty reader: {error}"))?;
        let mut writer = pair
            .master
            .take_writer()
            .map_err(|error| format!("failed to get pty writer: {error}"))?;

        write_startup_command(&mut writer, startup_command)?;

        let session_id = format!("term-{}", uuid::Uuid::new_v4());
        let reader = Arc::new(Mutex::new(reader));
        let writer = Arc::new(Mutex::new(writer));
        let killer = Arc::new(Mutex::new(killer));
        let master = Arc::new(Mutex::new(pair.master));

        self.spawn_output_thread(session_id.clone(), Arc::clone(&reader), app.clone());
        self.spawn_exit_thread(session_id.clone(), child, app);

        let session = TerminalSession {
            session_id: session_id.clone(),
            worktree_path,
            killer,
            reader,
            writer,
            master,
        };

        self.sessions.insert(session_id.clone(), session);

        Ok(session_id)
    }

    pub fn close_session(&mut self, session_id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .remove(session_id)
            .ok_or_else(|| format!("terminal session not found: {session_id}"))?;

        let TerminalSession { killer, reader, .. } = session;
        drop(reader);

        let mut killer = killer
            .lock()
            .map_err(|_| format!("failed to lock child killer for session: {session_id}"))?;

        killer
            .kill()
            .map_err(|error| format!("failed to kill terminal session {session_id}: {error}"))
    }

    pub fn write_input(&self, session_id: &str, data: String) -> Result<(), String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("terminal session not found: {session_id}"))?;

        let mut writer = session
            .writer
            .lock()
            .map_err(|_| format!("failed to lock writer for session: {session_id}"))?;

        writer.write_all(data.as_bytes()).map_err(|error| {
            format!("failed to write terminal input for session {session_id}: {error}")
        })?;
        writer.flush().map_err(|error| {
            format!("failed to flush terminal input for session {session_id}: {error}")
        })
    }

    pub fn resize_session(&self, session_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("terminal session not found: {session_id}"))?;

        let master = session
            .master
            .lock()
            .map_err(|_| format!("failed to lock master pty for session: {session_id}"))?;

        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("failed to resize terminal session {session_id}: {error}"))
    }

    pub fn list_sessions(&self) -> Vec<TerminalSessionInfo> {
        self.sessions
            .values()
            .map(|session| TerminalSessionInfo {
                session_id: session.session_id.clone(),
                worktree_path: session.worktree_path.clone(),
            })
            .collect()
    }

    fn spawn_output_thread(
        &self,
        session_id: String,
        reader: Arc<Mutex<Box<dyn Read + Send>>>,
        app: Option<AppHandle>,
    ) {
        if app.is_none() {
            return;
        }

        thread::spawn(move || {
            let mut buffer = [0_u8; 4096];

            loop {
                let bytes_read = {
                    let mut guard = match reader.lock() {
                        Ok(guard) => guard,
                        Err(_) => break,
                    };

                    match guard.read(&mut buffer) {
                        Ok(bytes_read) => bytes_read,
                        Err(_) => break,
                    }
                };

                if bytes_read == 0 {
                    break;
                }

                if let Some(app_handle) = &app {
                    let payload = TerminalOutputEvent {
                        session_id: session_id.clone(),
                        data: String::from_utf8_lossy(&buffer[..bytes_read]).to_string(),
                    };
                    let _ = app_handle.emit("terminal-output", payload);
                }
            }
        });
    }

    fn spawn_exit_thread(
        &self,
        session_id: String,
        mut child: Box<dyn Child + Send + Sync>,
        app: Option<AppHandle>,
    ) {
        if app.is_none() {
            return;
        }

        thread::spawn(move || {
            let exit_code = match child.wait() {
                Ok(status) => status.exit_code() as i32,
                Err(_) => -1,
            };

            if let Some(app_handle) = app {
                let payload = TerminalExitEvent {
                    session_id,
                    exit_code,
                };
                let _ = app_handle.emit("terminal-exit", payload);
            }
        });
    }
}

#[tauri::command]
pub fn create_terminal_session(
    app: AppHandle,
    manager: State<'_, Mutex<TerminalManager>>,
    worktree_path: String,
    startup_command: Option<String>,
) -> Result<String, String> {
    let mut manager = manager
        .lock()
        .map_err(|_| "terminal manager lock poisoned".to_string())?;
    manager.create_session(worktree_path, Some(app), startup_command)
}

#[tauri::command]
pub fn close_terminal_session(
    manager: State<'_, Mutex<TerminalManager>>,
    session_id: String,
) -> Result<(), String> {
    let mut manager = manager
        .lock()
        .map_err(|_| "terminal manager lock poisoned".to_string())?;
    manager.close_session(&session_id)
}

#[tauri::command]
pub fn write_terminal_input(
    manager: State<'_, Mutex<TerminalManager>>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let manager = manager
        .lock()
        .map_err(|_| "terminal manager lock poisoned".to_string())?;
    manager.write_input(&session_id, data)
}

#[tauri::command]
pub fn resize_terminal_session(
    manager: State<'_, Mutex<TerminalManager>>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let manager = manager
        .lock()
        .map_err(|_| "terminal manager lock poisoned".to_string())?;
    manager.resize_session(&session_id, rows, cols)
}

#[tauri::command]
pub fn list_terminal_sessions(
    manager: State<'_, Mutex<TerminalManager>>,
) -> Result<Vec<TerminalSessionInfo>, String> {
    let manager = manager
        .lock()
        .map_err(|_| "terminal manager lock poisoned".to_string())?;
    Ok(manager.list_sessions())
}

#[cfg(test)]
mod tests {
    use super::{write_startup_command, TerminalManager};

    #[test]
    fn create_session_with_valid_path_succeeds() {
        let mut manager = TerminalManager::default();
        let result = manager.create_session("/tmp".to_string(), None, None);

        assert!(result.is_ok());

        let session_id = result.expect("session id should exist after successful create");
        let sessions_after_create = manager.list_sessions();
        assert!(sessions_after_create
            .iter()
            .any(|session| session.session_id == session_id));

        let close_result = manager.close_session(&session_id);
        assert!(close_result.is_ok());

        let sessions_after_close = manager.list_sessions();
        assert!(sessions_after_close
            .iter()
            .all(|session| session.session_id != session_id));
    }

    #[test]
    fn create_session_with_invalid_path_fails() {
        let mut manager = TerminalManager::default();
        let result = manager.create_session("/path/does/not/exist".to_string(), None, None);

        assert!(result.is_err());
    }

    #[test]
    fn close_missing_session_returns_error() {
        let mut manager = TerminalManager::default();
        let result = manager.close_session("term-missing");

        assert!(result.is_err());
    }

    #[test]
    fn startup_command_is_written_when_command_is_configured() {
        let mut writer = Vec::new();

        let result = write_startup_command(&mut writer, Some("opencode".to_string()));

        assert!(result.is_ok());
        assert_eq!(writer, b"opencode\n");
    }

    #[test]
    fn startup_command_is_not_written_when_command_is_not_configured() {
        let mut writer = Vec::new();

        let result = write_startup_command(&mut writer, None);

        assert!(result.is_ok());
        assert!(writer.is_empty());
    }

    #[test]
    fn startup_command_is_not_written_when_command_is_blank() {
        let mut writer = Vec::new();

        let result = write_startup_command(&mut writer, Some("   ".to_string()));

        assert!(result.is_ok());
        assert!(writer.is_empty());
    }
}
