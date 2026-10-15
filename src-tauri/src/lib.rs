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
    enabled_extensions: Vec<String>,
    enabled_custom_apps: Vec<String>,
    directories: Vec<String>,
    scan_diagnostics: Vec<String>,
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

fn config_directory() -> Option<PathBuf> {
    // The CLI's "userdata" path is not necessarily the directory holding
    // config-xpui.ini. Prefer the real config file's parent when discoverable.
    if let Ok(config) = std::env::var("SPICETIFY_CONFIG") {
        let path = PathBuf::from(config);
        if path.is_file() {
            return path.parent().map(Path::to_path_buf);
        }
        if path.is_dir() && (path.join("config-xpui.ini").exists() || path.join("config.ini").exists()) {
            return Some(path);
        }
    }

    if let Ok(output) = execute(&["path", "all"]) {
        if output.status.success() {
            for line in output_text(&output.stdout).lines() {
                let path = PathBuf::from(line.trim());
                if path.file_name().is_some_and(|name| name == "config-xpui.ini" || name == "config.ini") {
                    if let Some(parent) = path.parent() {
                        return Some(parent.to_path_buf());
                    }
                }
            }
        }
    }

    let mut candidates = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        candidates.push(PathBuf::from(appdata).join("spicetify"));
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let profile = PathBuf::from(profile);
        candidates.push(profile.join(".config").join("spicetify"));
        candidates.push(profile.join(".spicetify"));
    }
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
            candidates.push(PathBuf::from(xdg).join("spicetify"));
        }
        candidates.push(home.join(".config").join("spicetify"));
        candidates.push(home.join(".spicetify"));
    }
    if let Some(path) = candidates.into_iter().find(|path| {
        path.join("config-xpui.ini").is_file() || path.join("config.ini").is_file()
    }) {
        return Some(path);
    }

    cli_path("userdata").filter(|path| path.is_dir())
}

#[tauri::command]
fn get_status() -> Status {
    let version_result = execute(&["--version"]);
    let spicetify_found = version_result.as_ref().map(|result| result.status.success()).unwrap_or(false);
    let version = version_result.as_ref().ok()
        .filter(|result| result.status.success())
        .map(|result| output_text(&result.stdout))
        .filter(|value| !value.is_empty());
    let config_path = config_directory()
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
        let paths = vec![
            PathBuf::from("/usr/share/spotify"),
            PathBuf::from("/usr/lib/spotify"),
            PathBuf::from("/var/lib/flatpak/app/com.spotify.Client"),
            PathBuf::from("/var/lib/snapd/snap/bin/spotify"),
            PathBuf::from("/snap/bin/spotify"),
            Path::new(&home).join(".local/share/flatpak/app/com.spotify.Client"),
            Path::new(&home).join(".var/app/com.spotify.Client"),
            Path::new(&home).join(".local/share/spotify"),
        ];
        return paths.iter().any(|path| path.exists());
    }
    #[allow(unreachable_code)]
    false
}

fn customization_dir(kind: &str) -> PathBuf {
    let folder = match kind {
        "themes" => "Themes",
        "extensions" => "Extensions",
        "custom_apps" => "CustomApps",
        _ => kind,
    };

    // Prefer paths reported by the installed CLI, but only when they point to
    // directories that actually exist. Some CLI versions do not support
    // "spicetify path <name>" and return an error instead.
    if let Some(path) = cli_path(kind).filter(|path| path.is_dir()) {
        return path;
    }

    let mut candidates: Vec<PathBuf> = Vec::new();

    // "spicetify path all" is supported by older CLI releases where
    // "spicetify path themes/extensions/custom_apps" is not. Its output
    // includes files beneath these folders, so recover the directory from
    // those reported paths rather than guessing the CLI's path subcommands.
    if let Ok(output) = execute(&["path", "all"]) {
        if output.status.success() {
            for line in output_text(&output.stdout).lines() {
                let reported = PathBuf::from(line.trim());
                for ancestor in reported.ancestors() {
                    if ancestor.file_name().is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(folder))
                        && ancestor.is_dir()
                    {
                        candidates.push(ancestor.to_path_buf());
                        break;
                    }
                }
            }
        }
    }

    if let Ok(config) = std::env::var("SPICETIFY_CONFIG") {
        let path = PathBuf::from(config);
        candidates.push(if path.file_name().is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(folder)) {
            path
        } else {
            path.join(folder)
        });
    }

    if let Some(userdata) = cli_path("userdata").filter(|path| path.is_dir()) {
        candidates.push(userdata.join(folder));
    }

    if cfg!(windows) {
        if let Ok(appdata) = std::env::var("APPDATA") {
            candidates.push(PathBuf::from(appdata).join("spicetify").join(folder));
        }
        if let Ok(profile) = std::env::var("USERPROFILE") {
            candidates.push(PathBuf::from(profile).join(".config").join("spicetify").join(folder));
        }
    } else if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
            candidates.push(PathBuf::from(xdg).join("spicetify").join(folder));
        }
        candidates.push(home.join(".config").join("spicetify").join(folder));
        candidates.push(home.join(".spicetify").join(folder));
    }

    candidates.iter().find(|path| path.is_dir()).cloned()
        .or_else(|| candidates.into_iter().next())
        .unwrap_or_else(|| PathBuf::from(folder))
}

#[tauri::command]
fn get_customizations() -> Result<CustomizationInventory, String> {
    let theme_dir = customization_dir("themes");
    let extension_dir = customization_dir("extensions");
    let apps_dir = customization_dir("custom_apps");
    let current_theme = config_value("current_theme").trim_matches('"').to_string();
    let current_color_scheme = config_value("color_scheme").trim_matches('"').to_string();
    let enabled_extensions = split_config_list(&config_value("extensions"));
    let enabled_apps = split_config_list(&config_value("custom_apps"));
    let themes = list_entries(&theme_dir, "theme", &[current_theme.clone()]);
    let extensions = list_entries(&extension_dir, "extension", &enabled_extensions);
    let custom_apps = list_entries(&apps_dir, "custom-app", &enabled_apps);
    let color_schemes = discover_color_schemes(&theme_dir, &current_theme);

    let describe_dir = |label: &str, path: &Path, count: usize| -> String {
        let state = if !path.exists() {
            "missing"
        } else if !path.is_dir() {
            "not a directory"
        } else {
            "readable directory"
        };
        format!("{label}: {} [{state}; {count} items]", path.display())
    };
    let scan_diagnostics = vec![
        describe_dir("Themes", &theme_dir, themes.len()),
        describe_dir("Extensions", &extension_dir, extensions.len()),
        describe_dir("Custom apps", &apps_dir, custom_apps.len()),
        format!("Configured current_theme: {}", if current_theme.is_empty() { "(empty)" } else { &current_theme }),
        format!("Configured extensions: {}", if enabled_extensions.is_empty() { "(none)" } else { &enabled_extensions.join(", ") }),
        format!("Configured custom_apps: {}", if enabled_apps.is_empty() { "(none)" } else { &enabled_apps.join(", ") }),
    ];
    Ok(CustomizationInventory {
        themes,
        extensions,
        custom_apps,
        color_schemes,
        current_theme,
        current_color_scheme,
        enabled_extensions,
        enabled_custom_apps: enabled_apps,
        directories: vec![
            format!("Themes: {}", theme_dir.display()),
            format!("Extensions: {}", extension_dir.display()),
            format!("Custom apps: {}", apps_dir.display()),
        ],
        scan_diagnostics,
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
        .filter(|path| path.is_dir())
        .or_else(|| config_directory().map(|path| path.join("Backup")).filter(|path| path.is_dir()))
        .or_else(|| cli_path("userdata").map(|path| path.join("Backup")).filter(|path| path.is_dir()))
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
