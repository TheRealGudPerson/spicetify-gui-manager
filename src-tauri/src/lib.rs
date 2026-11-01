use serde::Serialize;

// Session-scoped safety latch: require a fresh sign-in confirmation after every app launch.
static SPOTIFY_SIGN_IN_CONFIRMED: AtomicBool = AtomicBool::new(false);

fn require_spotify_sign_in() -> Result<(), String> {
    if SPOTIFY_SIGN_IN_CONFIRMED.load(Ordering::SeqCst) {
        Ok(())
    } else {
        Err("Safety lock: open Spotify, sign in to your account, leave Spotify running for at least 60 seconds, then confirm sign-in in SpiceDeck before any Spicetify command can run.".into())
    }
}

fn spicetify_binary_exists() -> bool {
    let candidate = spicetify_executable();
    candidate.is_file() || command_available("spicetify")
}
use std::{
    fs,
    sync::atomic::{AtomicBool, Ordering},
    path::{Path, PathBuf},
    process::{Command, Output},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    platform: String,
    spicetify_found: bool,
    version: Option<String>,
    spotify_found: bool,
    spotify_compatibility: String,
    spotify_details: String,
    spotify_path: Option<String>,
    prefs_path: Option<String>,
    config_path: Option<String>,
}

#[derive(Default)]
struct SpotifyDetection {
    installed: bool,
    compatibility: String,
    details: String,
    spotify_path: Option<String>,
    prefs_path: Option<String>,
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

fn spicetify_executable() -> PathBuf {
    let executable = if cfg!(windows) { "spicetify.exe" } else { "spicetify" };
    let mut candidates = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(&home).join(".spicetify").join(executable));
        candidates.push(PathBuf::from(&home).join(".local").join("bin").join(executable));
    }
    if cfg!(windows) {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local).join("spicetify").join(executable));
        }
    }
    candidates.into_iter().find(|path| path.is_file()).unwrap_or_else(|| PathBuf::from(executable))
}

fn execute(args: &[&str]) -> Result<Output, String> {
    require_spotify_sign_in()?;
    Command::new(spicetify_executable())
        .args(args)
        .output()
        .map_err(|error| format!("Could not start Spicetify: {error}. Confirm the CLI is installed and available in PATH."))
}

fn execute_owned(args: &[String]) -> Result<Output, String> {
    require_spotify_sign_in()?;
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


fn install_temp_dir() -> Result<PathBuf, String> {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    let path = std::env::temp_dir().join(format!("spicedeck-install-{stamp}"));
    fs::create_dir_all(&path).map_err(|error| format!("Could not create temporary install directory: {error}"))?;
    Ok(path)
}

fn run_checked(command: &mut Command, label: &str) -> Result<Output, String> {
    let output = command.output().map_err(|error| format!("Could not start {label}: {error}"))?;
    if !output.status.success() {
        let stderr = output_text(&output.stderr);
        return Err(format!("{label} failed (exit {}). {}",
            output.status.code().map(|code| code.to_string()).unwrap_or_else(|| "unknown".into()), stderr));
    }
    Ok(output)
}

fn download_file(url: &str, destination: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("curl.exe");
        cmd.args(["--fail", "--location", "--silent", "--show-error", url, "--output"]).arg(destination);
        cmd
    };
    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut cmd = Command::new("curl");
        cmd.args(["--fail", "--location", "--silent", "--show-error", url, "--output"]).arg(destination);
        cmd
    };
    run_checked(&mut command, "Official download")?;
    if !destination.is_file() || fs::metadata(destination).map(|metadata| metadata.len()).unwrap_or(0) == 0 {
        return Err("The official download completed without producing a usable file.".into());
    }
    Ok(())
}

fn command_available(program: &str) -> bool {
    #[cfg(target_os = "windows")]
    let checker = "where.exe";
    #[cfg(not(target_os = "windows"))]
    let checker = "which";
    Command::new(checker).arg(program).output().map(|output| output.status.success()).unwrap_or(false)
}

fn linux_distribution() -> (String, String) {
    let contents = fs::read_to_string("/etc/os-release").unwrap_or_default();
    let mut id = String::new();
    let mut like = String::new();
    for line in contents.lines() {
        if let Some(value) = line.strip_prefix("ID=") { id = value.trim_matches('"').to_lowercase(); }
        if let Some(value) = line.strip_prefix("ID_LIKE=") { like = value.trim_matches('"').to_lowercase(); }
    }
    (id, like)
}

#[tauri::command]
fn install_software(target: String) -> Result<CommandResult, String> {
    match target.as_str() {
        "spotify" => install_spotify(),
        "spicetify" => install_spicetify(),
        _ => Err("Unsupported installer target. Choose Spotify or Spicetify.".into()),
    }
}

fn install_spotify() -> Result<CommandResult, String> {
    let current = detect_spotify_installation();
    if current.installed && current.compatibility != "unsupported" {
        return Err("A Spotify installation is already present. Refresh status and review its compatibility details before installing another copy.".into());
    }

    #[cfg(target_os = "windows")]
    {
        let temp = install_temp_dir()?;
        let installer = temp.join("SpotifySetup.exe");
        download_file("https://download.scdn.co/SpotifySetup.exe", &installer)?;
        let output = run_checked(Command::new(&installer).arg("/silent"), "Spotify installer")?;
        let _ = fs::remove_dir_all(&temp);
        if !detect_spotify() {
            return Err("Spotify's installer exited, but SpiceDeck could not detect Spotify afterward. Refresh status and check the installer.".into());
        }
        return Ok(CommandResult { success: true, command: "Download and install Spotify for Windows".into(), code: output.status.code(), stdout: output_text(&output.stdout), stderr: output_text(&output.stderr) });
    }

    #[cfg(target_os = "macos")]
    {
        let temp = install_temp_dir()?;
        let image = temp.join("Spotify.dmg");
        let mount = temp.join("mounted");
        fs::create_dir_all(&mount).map_err(|error| error.to_string())?;
        download_file("https://download.scdn.co/Spotify.dmg", &image)?;
        run_checked(Command::new("hdiutil").args(["attach", "-nobrowse", "-readonly", "-mountpoint"]).arg(&mount).arg(&image), "Mount Spotify disk image")?;
        let home = std::env::var("HOME").map_err(|_| "Could not locate the user's home directory.".to_string())?;
        let applications = PathBuf::from(home).join("Applications");
        fs::create_dir_all(&applications).map_err(|error| error.to_string())?;
        let source = mount.join("Spotify.app");
        let destination = applications.join("Spotify.app");
        let copy_result = if source.is_dir() {
            run_checked(Command::new("ditto").arg("-rsrc").arg("-extattr").arg(&source).arg(&destination), "Copy Spotify into the user Applications folder")
        } else { Err("The downloaded disk image did not contain Spotify.app in the expected location.".into()) };
        let detach_result = run_checked(Command::new("hdiutil").args(["detach", "-force"]).arg(&mount), "Unmount Spotify disk image");
        let _ = fs::remove_dir_all(&temp);
        copy_result?;
        detach_result?;
        if !destination.exists() { return Err("Spotify was copied but its application bundle could not be verified.".into()); }
        return Ok(CommandResult { success: true, command: "Download and install Spotify for macOS".into(), code: Some(0), stdout: format!("Installed to {}", destination.display()), stderr: String::new() });
    }

    #[cfg(target_os = "linux")]
    {
        let (id, like) = linux_distribution();
        let debian_based = ["debian", "ubuntu", "linuxmint", "pop", "elementary", "kali", "zorin"].contains(&id.as_str())
            || like.split_whitespace().any(|value| value == "debian" || value == "ubuntu");
        if debian_based && command_available("apt-get") && command_available("pkexec") && command_available("gpg") {
            let temp = install_temp_dir()?;
            let key_download = temp.join("spotify-key.gpg");
            let keyring = temp.join("spotify-keyring.gpg");
            download_file("https://download.spotify.com/debian/pubkey_C85668DF69375001.gpg", &key_download)?;
            run_checked(Command::new("gpg").args(["--dearmor", "--yes", "--output"]).arg(&keyring).arg(&key_download), "Prepare Spotify repository signing key")?;
            let script = "install -D -m 0644 \"$1\" /usr/share/keyrings/spotify.gpg && printf '%s\\n' 'deb [signed-by=/usr/share/keyrings/spotify.gpg] http://repository.spotify.com stable non-free' > /etc/apt/sources.list.d/spotify.list && apt-get update && apt-get install -y spotify-client";
            let output = run_checked(Command::new("pkexec").arg("/bin/sh").arg("-c").arg(script).arg("spicedeck-install").arg(&keyring), "Install Spotify from its official APT repository; the operating system may request authorization")?;
            let _ = fs::remove_dir_all(&temp);
            if !detect_spotify() { return Err("The package manager reported success, but Spotify was not detected afterward. Refresh status.".into()); }
            return Ok(CommandResult { success: true, command: "Install Spotify from the official Spotify APT repository".into(), code: output.status.code(), stdout: output_text(&output.stdout), stderr: output_text(&output.stderr) });
        }
        if command_available("flatpak") {
            let remotes = Command::new("flatpak").args(["remotes", "--user", "--columns=name"]).output().ok().map(|output| output_text(&output.stdout)).unwrap_or_default();
            if !remotes.lines().any(|line| line.trim() == "flathub") {
                run_checked(Command::new("flatpak").args(["remote-add", "--user", "--if-not-exists", "flathub", "https://flathub.org/repo/flathub.flatpakrepo"]), "Add the Flathub user repository")?;
            }
            let output = run_checked(Command::new("flatpak").args(["install", "--user", "--noninteractive", "-y", "flathub", "com.spotify.Client"]), "Install Spotify from Flathub")?;
            if !detect_spotify() { return Err("Flatpak reported success, but Spotify was not detected afterward. Refresh status.".into()); }
            return Ok(CommandResult { success: true, command: "Install Spotify using the Flathub Flatpak package".into(), code: output.status.code(), stdout: output_text(&output.stdout), stderr: output_text(&output.stderr) });
        }
        Err(format!("Automatic Spotify installation is not yet supported for Linux distribution '{id}' (ID_LIKE='{like}'). SpiceDeck supports the official Spotify APT repository on Debian/Ubuntu-based systems and a user-scoped Flathub install where Flatpak is available."))
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    { Err("Automatic Spotify installation is not supported on this operating system.".into()) }
}

fn install_spicetify() -> Result<CommandResult, String> {
    if spicetify_binary_exists() {
        return Err("Spicetify is already detected. Refresh status before attempting another installation.".into());
    }
    let temp = install_temp_dir()?;
    let release_json = temp.join("latest-release.json");
    download_file("https://api.github.com/repos/spicetify/cli/releases/latest", &release_json)?;
    let release: serde_json::Value = serde_json::from_slice(&fs::read(&release_json).map_err(|error| error.to_string())?)
        .map_err(|error| format!("Could not read Spicetify's official release metadata: {error}"))?;
    let tag = release.get("tag_name").and_then(|value| value.as_str()).ok_or_else(|| "Spicetify release metadata did not include a version tag.".to_string())?;
    let version = tag.strip_prefix('v').unwrap_or(tag);
    if version.is_empty() || !version.chars().all(|character| character.is_ascii_alphanumeric() || character == '.' || character == '-') {
        return Err("Spicetify's release metadata contained an invalid version tag.".into());
    }

    #[cfg(target_os = "windows")]
    let (asset, archive_name) = {
        let arch = if cfg!(target_arch = "aarch64") { "arm64" } else if cfg!(target_arch = "x86") { "x32" } else { "x64" };
        (format!("spicetify-{version}-windows-{arch}.zip"), "spicetify.zip")
    };
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    let (asset, archive_name) = {
        let os = if cfg!(target_os = "macos") { "darwin" } else { "linux" };
        let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "amd64" };
        (format!("spicetify-{version}-{os}-{arch}.tar.gz"), "spicetify.tar.gz")
    };

    let archive = temp.join(archive_name);
    download_file(&format!("https://github.com/spicetify/cli/releases/download/v{version}/{asset}"), &archive)?;
    let home = std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map_err(|_| "Could not locate the user's home directory.".to_string())?;
    let install_dir = if cfg!(windows) {
        PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_else(|_| home.clone())).join("spicetify")
    } else { PathBuf::from(&home).join(".spicetify") };
    fs::create_dir_all(&install_dir).map_err(|error| error.to_string())?;

    #[cfg(target_os = "windows")]
    {
        let script = r#"Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip=[IO.Compression.ZipFile]::OpenRead($args[0]); try { $entry=$zip.Entries | Where-Object { $_.FullName -eq 'spicetify.exe' } | Select-Object -First 1; if (-not $entry) { throw 'Archive did not contain spicetify.exe' }; $out=[IO.File]::Open($args[1],[IO.FileMode]::Create,[IO.FileAccess]::Write); try { $stream=$entry.Open(); try { $stream.CopyTo($out) } finally { $stream.Dispose() } } finally { $out.Dispose() } } finally { $zip.Dispose() }"#;
        run_checked(Command::new("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", script]).arg(&archive).arg(install_dir.join("spicetify.exe")), "Extract official Spicetify executable")?;
    }
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        run_checked(Command::new("tar").arg("-xzf").arg(&archive).arg("-C").arg(&install_dir).arg("spicetify"), "Extract official Spicetify executable")?;
        use std::os::unix::fs::PermissionsExt;
        let executable = install_dir.join("spicetify");
        let mut permissions = fs::metadata(&executable).map_err(|error| error.to_string())?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable, permissions).map_err(|error| error.to_string())?;
    }

    let _ = fs::remove_dir_all(&temp);
    let executable = if cfg!(windows) { install_dir.join("spicetify.exe") } else { install_dir.join("spicetify") };
    if !executable.is_file() { return Err(format!("The installer finished but {} was not found.", executable.display())); }
    Ok(CommandResult { success: true, command: format!("Download and install official Spicetify CLI {version}"), code: Some(0), stdout: format!("Installed official Spicetify CLI {version} to {}. CLI execution and version verification are deferred until you confirm Spotify sign-in in SpiceDeck.", executable.display()), stderr: String::new() })
}

#[tauri::command]
fn get_status() -> Status {
    // Detect the binary without launching it. Running any Spicetify command is locked until sign-in confirmation.
    let spicetify_found = spicetify_binary_exists();
    let version_result = if SPOTIFY_SIGN_IN_CONFIRMED.load(Ordering::SeqCst) { execute(&["--version"]).ok() } else { None };
    let version = version_result.as_ref()
        .filter(|result| result.status.success())
        .map(|result| output_text(&result.stdout))
        .filter(|value| !value.is_empty());
    let config_path = config_directory()
        .map(|path| path.to_string_lossy().to_string());
    let spotify = detect_spotify_installation();
    Status {
        platform: if cfg!(target_os = "windows") { "Windows".into() }
            else if cfg!(target_os = "macos") { "macOS".into() }
            else if cfg!(target_os = "linux") { "Linux".into() }
            else { std::env::consts::OS.into() },
        spicetify_found,
        version,
        spotify_found: spotify.installed,
        spotify_compatibility: spotify.compatibility,
        spotify_details: spotify.details,
        spotify_path: spotify.spotify_path,
        prefs_path: spotify.prefs_path,
        config_path,
    }
}

fn detect_spotify() -> bool {
    detect_spotify_installation().installed
}

fn detect_spotify_installation() -> SpotifyDetection {
    #[cfg(target_os = "windows")]
    let home = std::env::var("USERPROFILE").unwrap_or_default();
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var("HOME").unwrap_or_default();
    #[cfg(target_os = "windows")]
    {
        let roaming = std::env::var("APPDATA").unwrap_or_default();
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let scoop = std::env::var("SCOOP").unwrap_or_else(|_| Path::new(&home).join("scoop").to_string_lossy().to_string());
        let candidates = [
            Path::new(&roaming).join("Spotify"),
            Path::new(&local).join("Spotify"),
            Path::new(&local).join("Programs/Spotify"),
        ];
        let scoop_path = Path::new(&scoop).join("apps/spotify/current");
        if scoop_path.join("Spotify.exe").is_file() {
            let prefs = Path::new(&roaming).join("Spotify/prefs");
            return SpotifyDetection {
                installed: true,
                compatibility: "needs_configuration".into(),
                details: format!("Scoop Spotify detected at {}. Spicetify requires spotify_path to be set to this directory.{}",
                    scoop_path.display(),
                    prefs.is_file().then(|| format!(" Preferences file: {}.", prefs.display()))
                        .unwrap_or_else(|| " Launch Spotify and sign in for at least 60 seconds to create its preferences file.".into())),
                spotify_path: Some(scoop_path.to_string_lossy().to_string()),
                prefs_path: prefs.is_file().then(|| prefs.to_string_lossy().to_string()),
            };
        }
        if let Some(path) = candidates.iter().find(|path| path.join("Spotify.exe").is_file()) {
            let prefs = Path::new(&roaming).join("Spotify/prefs");
            return SpotifyDetection {
                installed: true,
                compatibility: if prefs.is_file() { "compatible" } else { "needs_configuration" }.into(),
                details: format!("Standard Spotify desktop installation detected at {}.{}",
                    path.display(),
                    if prefs.is_file() { "" } else { " Launch Spotify and sign in for at least 60 seconds so it creates its preferences file." }),
                spotify_path: Some(path.to_string_lossy().to_string()),
                prefs_path: prefs.is_file().then(|| prefs.to_string_lossy().to_string()),
            };
        }
        let packages = Path::new(&local).join("Packages");
        let store_found = fs::read_dir(packages).ok().into_iter().flatten().flatten()
            .any(|entry| entry.file_name().to_string_lossy().starts_with("SpotifyAB.SpotifyMusic"));
        if store_found {
            return SpotifyDetection {
                installed: true,
                compatibility: "unsupported".into(),
                details: "Microsoft Store Spotify was detected. Spicetify documents this distribution as unsupported; install the regular desktop version from Spotify's website instead.".into(),
                ..Default::default()
            };
        }
    }
    #[cfg(target_os = "macos")]
    {
        let candidates = [
            PathBuf::from("/Applications/Spotify.app/Contents/Resources"),
            Path::new(&home).join("Applications/Spotify.app/Contents/Resources"),
        ];
        if let Some(path) = candidates.iter().find(|path| path.is_dir()) {
            let prefs = Path::new(&home).join("Library/Application Support/Spotify/prefs");
            return SpotifyDetection {
                installed: true,
                compatibility: if prefs.is_file() { "compatible" } else { "needs_configuration" }.into(),
                details: format!("Spotify desktop app detected at {}.{}",
                    path.display(),
                    if prefs.is_file() { "" } else { " Launch Spotify and sign in for at least 60 seconds to generate its preferences file." }),
                spotify_path: Some(path.to_string_lossy().to_string()),
                prefs_path: prefs.is_file().then(|| prefs.to_string_lossy().to_string()),
            };
        }
    }
    #[cfg(target_os = "linux")]
    {
        let prefs_candidates = [
            Path::new(&home).join(".config/spotify/prefs"),
            Path::new(&home).join(".var/app/com.spotify.Client/config/spotify/prefs"),
        ];
        let prefs = prefs_candidates.iter().find(|path| path.is_file()).cloned();

        let candidates = [
            PathBuf::from("/usr/share/spotify"),
            PathBuf::from("/usr/lib/spotify"),
            PathBuf::from("/opt/spotify"),
            Path::new(&home).join(".local/share/spotify-launcher/install/usr/share/spotify"),
            Path::new(&home).join(".local/share/spotify"),
        ];
        if let Some(path) = candidates.iter().find(|path| path.join("Apps").is_dir() || path.join("spotify").is_file() || path.is_dir()) {
            let prefs_path = prefs.clone();
            let writable = Command::new("sh")
                .args(["-c", "test -w \"$1\" && test -w \"$1/Apps\"", "spicedeck-check"])
                .arg(path)
                .status()
                .map(|status| status.success())
                .unwrap_or(false);
            let configured = writable && prefs_path.is_some();
            let install_kind = if path.as_path() == Path::new("/opt/spotify") { "Arch/AUR" }
                else if path.as_path() == Path::new("/usr/share/spotify") || path.as_path() == Path::new("/usr/lib/spotify") { "APT/system package" }
                else { "user-local Spotify installation" };
            return SpotifyDetection {
                installed: true,
                compatibility: if configured { "compatible" } else { "needs_configuration" }.into(),
                details: format!("{} detected at {}. {}{}",
                    install_kind, path.display(),
                    if writable { "Spotify files are writable by your user." } else { "Spicetify needs write access to the Spotify directory and its Apps folder. Follow the official Spicetify permissions instructions." },
                    prefs_path.as_ref().map(|p| format!(" Preferences file: {}.", p.display()))
                        .unwrap_or_else(|| " The Spotify prefs file was not found; launch Spotify and sign in for at least 60 seconds.".into())),
                spotify_path: Some(path.to_string_lossy().to_string()),
                prefs_path: prefs_path.map(|p| p.to_string_lossy().to_string()),
            };
        }

        if command_available("flatpak") {
            if let Ok(output) = Command::new("flatpak").args(["info", "--show-location", "com.spotify.Client"]).output() {
                if output.status.success() {
                    let deployment = PathBuf::from(output_text(&output.stdout));
                    let path = deployment.join("files/extra/share/spotify");
                    if path.is_dir() {
                        let prefs_path = prefs.clone();
                        let prefs_message = prefs_path.as_ref().map(|p| p.display().to_string())
                            .unwrap_or_else(|| "not found yet".into());
                        return SpotifyDetection {
                            installed: true,
                            compatibility: "needs_configuration".into(),
                            details: format!("Flatpak Spotify detected. Spicetify needs spotify_path set to {} and prefs_path set to {}. The Spotify files must also be writable by your user. Launch Spotify and sign in first if the prefs file is missing.", path.display(), prefs_message),
                            spotify_path: Some(path.to_string_lossy().to_string()),
                            prefs_path: prefs_path.map(|p| p.to_string_lossy().to_string()),
                        };
                    }
                }
            }
        }

        if Path::new("/snap/bin/spotify").exists()
            || Path::new("/var/lib/snapd/snap/bin/spotify").exists() {
            return SpotifyDetection {
                installed: true,
                compatibility: "unsupported".into(),
                details: "Snap Spotify was detected. Spicetify cannot modify Snap installations. Install Spotify through APT or a supported Flatpak distribution instead.".into(),
                ..Default::default()
            };
        }

    }
    SpotifyDetection {
        installed: false,
        compatibility: "not_installed".into(),
        details: "No supported Spotify desktop installation was found in the standard locations.".into(),
        ..Default::default()
    }
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

    // Prefer the directory that actually contains config-xpui.ini. On some
    // systems, "path userdata" points to a legacy ~/.spicetify directory,
    // while the active themes/extensions/apps live under ~/.config/spicetify.
    if let Some(config) = config_directory().filter(|path| path.is_dir()) {
        candidates.push(config.join(folder));
    }

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
    require_spotify_sign_in()?;
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
    let extensions_summary = if enabled_extensions.is_empty() {
        "(none)".to_string()
    } else {
        enabled_extensions.join(", ")
    };
    let custom_apps_summary = if enabled_apps.is_empty() {
        "(none)".to_string()
    } else {
        enabled_apps.join(", ")
    };
    let scan_diagnostics = vec![
        describe_dir("Themes", &theme_dir, themes.len()),
        describe_dir("Extensions", &extension_dir, extensions.len()),
        describe_dir("Custom apps", &apps_dir, custom_apps.len()),
        format!("Configured current_theme: {}", if current_theme.is_empty() { "(empty)" } else { &current_theme }),
        format!("Configured extensions: {extensions_summary}"),
        format!("Configured custom_apps: {custom_apps_summary}"),
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
fn spicetify_backup_directory() -> Result<PathBuf, String> {
    // Spicetify stores state separately from its configuration and CLI installation.
    // On Linux and macOS the default is ~/.local/state/spicetify/Backup; on
    // Windows it is %APPDATA%/spicetify/Backup. SPICETIFY_STATE overrides the
    // state folder itself, rather than acting as a parent directory.
    let mut candidates = Vec::new();

    if let Ok(state) = std::env::var("SPICETIFY_STATE") {
        if !state.trim().is_empty() {
            candidates.push(PathBuf::from(state));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            candidates.push(PathBuf::from(appdata).join("spicetify").join("Backup"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(xdg_state) = std::env::var("XDG_STATE_HOME") {
            if !xdg_state.trim().is_empty() {
                candidates.push(PathBuf::from(xdg_state).join("spicetify").join("Backup"));
            }
        }
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        if let Ok(home) = std::env::var("HOME") {
            candidates.push(PathBuf::from(home).join(".local").join("state").join("spicetify").join("Backup"));
        }
    }

    // Older installs and custom layouts may still use the config directory.
    if let Some(config) = config_directory() {
        candidates.push(config.join("Backup"));
    }

    candidates.dedup();
    if let Some(path) = candidates.iter().find(|path| path.is_dir()) {
        return Ok(path.clone());
    }

    let searched = candidates.iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join("\n");
    Err(format!(
        "Could not locate Spicetify's backup directory. Spicetify stores backups under its state directory, usually ~/.local/state/spicetify/Backup on Linux. Checked:\n{}",
        if searched.is_empty() { "(no standard locations could be resolved)".to_string() } else { searched }
    ))
}

#[tauri::command]
fn get_backups() -> Result<Vec<BackupEntry>, String> {
    require_spotify_sign_in()?;
    let backup_dir = spicetify_backup_directory()?;
    let mut backups = Vec::new();
    for entry in fs::read_dir(&backup_dir)
        .map_err(|error| format!("Could not read Spicetify backup directory {}: {error}", backup_dir.display()))?
        .flatten()
    {
        let path = entry.path();
        let metadata = match entry.metadata() { Ok(value) => value, Err(_) => continue };
        let modified = metadata.modified().ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs());
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
    require_spotify_sign_in()?;
    let args: Vec<&str> = match action.as_str() {
        "apply" => vec!["apply"],
        "backup" => vec!["backup"],
        "restore" => vec!["restore"],
        "config" => vec!["config"],
        "setup" => vec!["backup", "apply"],
        _ => return Err("Unsupported action. Only setup, apply, backup, restore, and config are allowed.".into()),
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

#[tauri::command]
fn confirm_spotify_signed_in() -> Result<(), String> {
    if !detect_spotify() {
        return Err("Spotify was not detected at a supported installation path. Install or locate Spotify first.".into());
    }
    SPOTIFY_SIGN_IN_CONFIRMED.store(true, Ordering::SeqCst);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            get_status, run_action, get_customizations, get_backups, set_config_value, install_software, confirm_spotify_signed_in
        ])
        .run(tauri::generate_context!())
        .expect("error while running SpiceDeck");
}
