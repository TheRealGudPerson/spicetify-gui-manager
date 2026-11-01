# Development guide

## Architecture

SpiceDeck is a Tauri 2 desktop application. React/TypeScript renders the UI; Rust calls the installed Spicetify CLI directly with fixed argument lists. No shell interpolation is used, and the frontend cannot submit arbitrary commands.

## Prerequisites

- Node.js 20 or newer and npm
- Rust stable toolchain
- Tauri 2 platform dependencies
- Spotify and Spicetify for testing CLI actions

Official platform setup: https://v2.tauri.app/start/prerequisites/

## Run locally

```bash
npm install
npm run tauri dev
```

For frontend-only work:

```bash
npm run dev
```

Production build:

```bash
npm run tauri build
```

## Fedora / Linux notes

Install the Tauri prerequisites for your Fedora version using the official Tauri documentation. On Linux, the WebKitGTK development packages and build tools are required. If running Hyprland/Wayland, launch from a terminal during development so Rust and WebView errors are visible.

## Current command contract

The backend exposes fixed, allowlisted operations for status detection, official Spotify and Spicetify installation, customization discovery, backup listing, configuration inspection and writes, and the explicit Spicetify actions `apply`, `backup`, `restore`, and initial `backup apply`.

Spotify detection reports whether an installation is compatible, needs configuration, is unsupported, or is missing. Linux detection recognizes APT/system packages, Arch/AUR, spotify-launcher, Flatpak, and unsupported Snap installs. Windows detection distinguishes the standard desktop installer from Microsoft Store Spotify. macOS detection checks the standard application bundle locations.

The app does not silently elevate routine operations. The official APT installer uses the OS authorization prompt; Flatpak installation is user-scoped. Some Linux Spotify packages require the user to grant write access to the Spotify directory and its `Apps` folder, and Flatpak requires explicit `spotify_path` and `prefs_path` configuration. Consult https://spicetify.app/docs/getting-started for distribution-specific instructions.

GitHub Actions workflows are currently removed. Run frontend builds and Rust checks manually before merging or releasing.

## Security notes

- Never replace fixed command argument lists with a shell command assembled from user input.
- Treat Marketplace metadata, theme files, and extensions as untrusted input.
- Back up files before implementing config writes or theme installation.
- Do not add an auto-update mechanism that executes remote scripts without verification.
