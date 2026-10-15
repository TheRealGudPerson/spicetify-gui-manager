# Roadmap

## Foundation (in progress)

- [x] Tauri 2 + React + TypeScript shell
- [x] Cross-platform Spicetify CLI detection
- [x] Dashboard, status cards, and activity log
- [x] Explicit apply, backup, restore, and config actions
- [x] Fixed command allowlist in the Rust backend
- [ ] Build and smoke-test on Windows, macOS, Fedora, and Ubuntu
- [ ] Improve Spotify detection for Flatpak, Snap, custom paths, and Store installs

## Next

- [ ] Installation wizard using official Spicetify installation guidance
- [ ] Read and validate config values; safe visual config editor
- [ ] Backup history and restore-point details
- [ ] Error explanations and diagnostics export
- [ ] Real Marketplace browsing for themes, extensions, snippets, and custom apps
- [ ] Theme and color-scheme preview / selection
- [ ] Extension and custom-app enable/disable controls
- [ ] Import/export portable profiles without machine-specific paths
- [ ] Update checks and release builds for Windows, macOS, and Linux
- [ ] Accessibility review and light/dark theme preference

## Design constraints

- The official Spicetify CLI remains the source of truth for supported operations.
- No administrator/root requirement for routine tasks.
- Destructive actions must be clearly named and confirmed.
- Show command output and never claim an operation succeeded before the CLI returns success.
- Portable profiles must distinguish shared preferences from operating-system-specific paths.
