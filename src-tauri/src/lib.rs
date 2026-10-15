use serde::Serialize;
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    platform: String,
    spicetify_found: bool,
    version: Option<String>,
    spotify_found: bool,
    config_path: Option<String>,
}

#[derive(Serialize)]
struct CommandResult {
    success: bool,
    command: String,
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

fn spicetify_executable() -> &'static str {
    if cfg!(windows) { "spicetify.exe" } else { "spicetify" }
}

fn execute(args: &[&str]) -> Result<std::process::Output, String> {
    Command::new(spicetify_executable())
        .args(args)
        .output()
        .map_err(|error| format!("Could not start Spicetify: {error}. Confirm the CLI is installed and available in PATH."))
}

fn output_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim().to_string()
}

#[tauri::command]
fn get_status() -> Status {
    let version_result = execute(&["--version"]);
    let spicetify_found = version_result.is_ok();
    let version = version_result
        .as_ref()
        .ok()
        .filter(|result| result.status.success())
        .map(|result| output_text(&result.stdout))
        .filter(|value| !value.is_empty());

    let config_path = if spicetify_found {
        execute(&["path", "prefs"])
            .ok()
            .filter(|result| result.status.success())
            .map(|result| output_text(&result.stdout))
            .filter(|value| !value.is_empty())
    } else {
        None
    };

    let spotify_found = detect_spotify();
    Status {
        platform: if cfg!(target_os = "windows") { "Windows".into() }
            else if cfg!(target_os = "macos") { "macOS".into() }
            else if cfg!(target_os = "linux") { "Linux".into() }
            else { std::env::consts::OS.into() },
        spicetify_found,
        version,
        spotify_found,
        config_path,
    }
}

fn detect_spotify() -> bool {
    #[cfg(target_os = "windows")]
    {
        let local = std::env::var("APPDATA").unwrap_or_default();
        let local_low = std::env::var("LOCALAPPDATA").unwrap_or_default();
        return std::path::Path::new(&local).join("Spotify").join("Spotify.exe").exists()
            || std::path::Path::new(&local_low).join("Spotify").join("Spotify.exe").exists();
    }
    #[cfg(target_os = "macos")]
    {
        return std::path::Path::new("/Applications/Spotify.app").exists()
            || std::env::var("HOME").map(|home| std::path::Path::new(&home).join("Applications/Spotify.app").exists()).unwrap_or(false);
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        return std::path::Path::new("/usr/share/spotify").exists()
            || std::path::Path::new("/usr/lib/spotify").exists()
            || std::path::Path::new(&home).join(".local/share/flatpak/app/com.spotify.Client").exists()
            || std::path::Path::new("/var/lib/flatpak/app/com.spotify.Client").exists()
            || std::path::Path::new("/snap/bin/spotify").exists();
    }
    #[allow(unreachable_code)]
    false
}

#[tauri::command]
fn run_action(action: String) -> Result<CommandResult, String> {
    // Only fixed, reviewed argument lists are accepted from the frontend. Never pass arbitrary shell text.
    let args: Vec<&str> = match action.as_str() {
        "apply" => vec!["apply"],
        "backup" => vec!["backup"],
        "restore" => vec!["restore"],
        "config" => vec!["config"],
        _ => return Err("Unsupported action. Only apply, backup, restore, and config are allowed.".into()),
    };

    let command_display = format!("spicetify {}", args.join(" "));
    let output = execute(&args)?;
    Ok(CommandResult {
        success: output.status.success(),
        command: command_display,
        code: output.status.code(),
        stdout: output_text(&output.stdout),
        stderr: output_text(&output.stderr),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_status, run_action])
        .run(tauri::generate_context!())
        .expect("error while running SpiceDeck");
}