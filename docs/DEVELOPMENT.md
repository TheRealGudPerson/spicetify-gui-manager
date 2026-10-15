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

The backend currently allows only these fixed actions:

- `spicetify --version` for detection
- `spicetify path prefs` for a displayed path
- `spicetify apply`
- `spicetify backup`
- `spicetify restore`
- `spicetify config`

The app never requests root/Administrator permissions. It does not install Spicetify automatically yet. Read the official installation guide before installing: https://spicetify.app/docs/advanced-usage/installation

## Security notes

- Never replace fixed command argument lists with a shell command assembled from user input.
- Treat Marketplace metadata, theme files, and extensions as untrusted input.
- Back up files before implementing config writes or theme installation.
- Do not add an auto-update mechanism that executes remote scripts without verification.
