# Roadmap

## Foundation
- [x] Tauri 2 + React + TypeScript shell
- [x] Cross-platform Spicetify CLI detection
- [x] Dashboard, status cards, and activity log
- [x] Explicit apply, backup, restore, and config actions
- [x] Fixed command allowlist for maintenance actions
- [ ] Build and smoke-test on Windows, macOS, Fedora, and Ubuntu
- [ ] Verify all Spicetify path commands across supported CLI versions

## Local management
- [x] Discover locally installed themes, extensions, and custom apps
- [x] Select an installed theme and inspect its color schemes
- [x] Enable/disable discovered extensions and custom apps in config
- [x] Allowlisted visual editor for common config keys
- [x] Display local backup-directory contents
- [x] Export diagnostic activity logs
- [ ] Test inventory parsing against real Spicetify installs and unusual filenames
- [ ] Add import/export portable profiles with path sanitization
- [ ] Add backup metadata, integrity checks, and safe restore-point selection

## Marketplace and releases
- [x] Browse community repositories by Spicetify GitHub topic with source links, search, stars, and update dates (v0.3.0 in progress)
- [ ] Read and validate Marketplace manifests before showing install actions
- [ ] Install/update/remove themes, extensions, snippets, and custom apps with path-safe file handling
- [ ] Preview theme colors from actual color.ini values
- [x] Add a first-run setup wizard with OS-aware Spotify and Spicetify installation actions (v0.3.0 in progress)
- [x] Download/install Spotify from the official Windows/macOS installers and Linux distro-aware package routes, with OS authorization when required (v0.3.0 in progress)
- [x] Download the official Spicetify CLI release for the detected OS/architecture and verify the installed binary (v0.3.0 in progress)
- [x] Add an explicit, confirmed first-run backup/apply action after Spotify has been launched and initialized (v0.3.0 in progress)
- [ ] Add live installer progress streaming and automated Windows/macOS/Linux end-to-end installer tests
- [x] Add update checks and signed release builds for Windows, macOS, and Linux (v0.2.1)
- [ ] Accessibility review and light/dark theme preference

## Design constraints
- The official Spicetify CLI remains the source of truth for supported operations.
- No administrator/root requirement for routine tasks.
- Destructive actions must be clearly named and confirmed.
- Show command output and never claim an operation succeeded before the CLI returns success.
- Treat downloaded customizations as untrusted code and never silently execute installs.
- Portable profiles must distinguish shared preferences from OS-specific paths.
