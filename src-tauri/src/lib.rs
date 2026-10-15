use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    time::UNIX_EPOCH,
};

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Customization {
    name: String,
    kind: String,
    path: String,
    enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CustomizationInventory {
    themes: Vec<Customization>,
    extensions: Vec<Customization>,
    custom_apps: Vec<Customization>,
    color_schemes: Vec<String>,
    current_theme: String,
    current_color_scheme: String,
    directories: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupEntry {
    name: String,
    path: String,
    size: u64,
    modified: Option<u64>,
    is_directory: bool,
}

fn spicetify_executable() -> &'static str {
    if cfg!(windows) { "spicetify.exe" } else { "spicetify" }
}

fn execute(args: &[&str]) -> Result<Output, String> {
    Command::new(spicetify_executable())
        .args(args)
        .output()
        .map_err(|error| format!("Could not start Spicetify: {error}. Confirm the CLI is installed and available in PATH."))
}

fn execute_owned(args: &[String]) -> Result<Output, String> {
    Command::new(spicetify_executable())
        .args(args)
        .output()
        .map_err(|error| format!("Could not start Spicetify: {error}. Confirm the CLI is installed and available in PATH."))
}

fn output_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim().to_string()
}

fn cli_path(kind: &str) -> Option<PathBuf> {
    let output = execute(&["path", kind]).ok()?;
    if !output.status.success() {
        return None;
    }
    let value = output_text(&output.stdout);
    if value.is_empty() { None } else { Some(PathBuf::from(value)) }
}

fn config_value(key: &str) -> String {
    let output = match execute(&["config", key]) {
        Ok(value) if value.status.success() => value,
        _ => return String::new(),
    };
    output_text(&output.stdout)
}

fn split_config_list(value: &str) -> Vec<String> {
    value.split(|c: char| c == ',' || c == ';' || c == '\n')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| item.trim_matches('"').to_string())
        .collect()
}

fn list_entries(path: &Path, kind: &str, enabled_values: &[String]) -> Vec<Customization> {
    let mut entries = Vec::new();
    let Ok(read_dir) = fs::read_dir(path) else { return entries };
    for entry in read_dir.flatten() {
        let item_path = entry.path();
        let Ok(metadata) = entry.metadata() else { continue };
        if !metadata.is_dir() && kind != "extension" { continue; }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') { continue; }
        let enabled = enabled_values.iter().any(|value| value.eq_ignore_ascii_case(&name));
        entries.push(Customization {
            name,
            kind: kind.to_string(),
            path: item_path.to_string_lossy().to_string(),
            enabled,
        });
    }
    entries.sort_by_key(|item| item.name.to_lowercase());
    entries
}

fn discover_color_schemes(theme_dir: &Path, theme_name: &str) -> Vec<String> {
    let mut names = vec!["".to_string()];
    if theme_name.is_empty() { return names; }
    let candidates = [
        theme_dir.join(theme_name).join("color.ini"),
        theme_dir.join(theme_name).join("Color.ini"),
        theme_dir.join(theme_name).join("colors.ini"),
    ];
    for path in candidates {
        let Ok(contents) = fs::read_to_string(path) else { continue };
        for line in contents.lines() {
            let line = line.trim();
            if line.starts_with('[') && line.ends_with(']') && line.len() > 2 {
                let name = line[1..line.len() - 1].trim().to_string();
                if !name.is_empty() && !names.iter().any(|existing| existing == &name) {
                    names.push(name);
                }
            }
        }
        break;
    }
    names
}

#[tauri::command]
fn get_status() -> Status {
    let version_result = execute(&["--version"]);
    let spicetify_found = version_result.as_ref().map(|result| result.status.success()).unwrap_or(false);
    let version = version_result.as_ref().ok()
        .filter(|result| result.status.success())
        .map(|result| output_text(&result.stdout))
        .filter(|value| !value.is_empty());
    let config_path = cli_path("userdata").or_else(|| cli_path("config"))
        .map(|path| path.to_string_lossy().to_string());
    Status {
        platform: if cfg!(target_os = "windows") { "Windows".into() }
            else if cfg!(target_os = "macos") { "macOS".into() }
            else if cfg!(target_os = "linux") { "Linux".into() }
            else { std::env::consts::OS.into() },
        spicetify_found,
        version,
        spotify_found: detect_spotify(),
        config_path,
    }
}

fn detect_spotify() -> bool {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
        return [
            Path::new(&appdata).join("Spotify/Spotify.exe"),
            Path::new(&local).join("Spotify/Spotify.exe"),
            Path::new(&local).join("Microsoft/WindowsApps/Spotify.exe"),
        ].iter().any(|path| path.exists());
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        return Path::new("/Applications/Spotify.app").exists()
            || Path::new(&home).join("Applications/Spotify.app").exists();
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        return [
            Path::new("/usr/share/spotify"),
            Path::new("/usr/lib/spotify"),
            Path::new("/var/lib/flatpak/app/com.spotify.Client"),
            Path::new("/var/lib/snapd/snap/bin/spotify"),
            Path::new("/snap/bin/spotify"),
            Path::new(&home).join(".local/share/flatpak/app/com.spotify.Client").as_path(),
            Path::new(&home).join(".var/app/com.spotify.Client").as_path(),
        ].iter().any(|path| path.exists());
    }
    #[allow(unreachable_code)]
    false
}

#[tauri::command]
fn get_customizations() -> Result<CustomizationInventory, String> {
    let theme_dir = cli_path("themes").ok_or_else(|| "Could not locate the Spicetify themes directory. Check that Spicetify is installed.".to_string())?;
    let extension_dir = cli_path("extensions").unwrap_or_else(|| {
        cli_path("userdata").unwrap_or_default().join("Extensions")
    });
    let apps_dir = cli_path("custom_apps").unwrap_or_else(|| {
        cli_path("userdata").unwrap_or_default().join("CustomApps")
    });
    let current_theme = config_value("current_theme").trim_matches('"').to_string();
    let current_color_scheme = config_value("color_scheme").trim_matches('"').to_string();
    let enabled_extensions = split_config_list(&config_value("extensions"));
    let enabled_apps = split_config_list(&config_value("custom_apps"));
    let themes = list_entries(&theme_dir, "theme", &[current_theme.clone()]);
    let extensions = list_entries(&extension_dir, "extension", &enabled_extensions);
    let custom_apps = list_entries(&apps_dir, "custom-app", &enabled_apps);
    let color_schemes = discover_color_schemes(&theme_dir, &current_theme);
    Ok(CustomizationInventory {
        themes,
        extensions,
        custom_apps,
        color_schemes,
        current_theme,
        current_color_scheme,
        directories: vec![
            format!("Themes: {}", theme_dir.display()),
            format!("Extensions: {}", extension_dir.display()),
            format!("Custom apps: {}", apps_dir.display()),
        ],
    })
}

#[tauri::command]
fn set_config_value(key: String, value: String) -> Result<CommandResult, String> {
    let allowed = [
        "current_theme", "color_scheme", "extensions", "custom_apps",
        "inject_css", "replace_colors", "overwrite_assets", "spotify_path",
        "prefs_path", "sidebar_config", "experimental_features",
    ];
    if !allowed.contains(&key.as_str()) {
        return Err(format!("Configuration key '{key}' is not editable in SpiceDeck."));
    }
    if value.contains('\0') || value.contains('\n') || value.contains('\r') {
        return Err("Values must be a single line and cannot contain null characters.".into());
    }
    if value.len() > 4096 {
        return Err("Configuration value is too long (maximum 4096 bytes).".into());
    }
    let args = vec!["config".to_string(), key.clone(), value.clone()];
    let output = execute_owned(&args)?;
    let command = format!("spicetify config {key} {}", if value.is_empty() { "(empty)" } else { &value });
    Ok(CommandResult {
        success: output.status.success(),
        command,
        code: output.status.code(),
        stdout: output_text(&output.stdout),
        stderr: output_text(&output.stderr),
    })
}

#[tauri::command]
fn get_backups() -> Result<Vec<BackupEntry>, String> {
    let backup_dir = cli_path("backup")
        .or_else(|| cli_path("userdata").map(|path| path.join("Backup")))
        .ok_or_else(|| "Could not locate the Spicetify backup directory.".to_string())?;
    if !backup_dir.exists() {
        return Ok(Vec::new());
    }
    let mut backups = Vec::new();
    for entry in fs::read_dir(&backup_dir).map_err(|error| format!("Could not read backup directory: {error}"))?.flatten() {
        let path = entry.path();
        let metadata = match entry.metadata() { Ok(value) => value, Err(_) => continue };
        let modified = metadata.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map(|duration| duration.as_secs());
        backups.push(BackupEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
            size: metadata.len(),
            modified,
            is_directory: metadata.is_dir(),
        });
    }
    backups.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(backups)
}

#[tauri::command]
fn run_action(action: String) -> Result<CommandResult, String> {
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
        .invoke_handler(tauri::generate_handler![
            get_status, run_action, get_customizations, get_backups, set_config_value
        ])
        .run(tauri::generate_context!())
        .expect("error while running SpiceDeck");
}
