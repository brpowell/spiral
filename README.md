<div align="center">

<a href="https://spiralpowered.com">
  <img src=".github/assets/spiral-logo.svg" alt="Spiral logo" width="128" height="128">
</a>

# Spiral

### Reclaim your music.

A free, open source desktop music player for people who still own their music.<br>
No streaming. No ads. No algorithms. No tracking. Just your collection, played beautifully.

<!-- Badges: add or remove freely, one per line keeps diffs readable -->
[![Latest release](https://img.shields.io/github/v/release/brpowell/spiral?filter=desktop-v*&label=release&color=96c836&style=flat-square)](https://github.com/brpowell/spiral/releases/latest)
[![Tests](https://img.shields.io/github/actions/workflow/status/brpowell/spiral/desktop-test.yml?branch=main&label=tests&style=flat-square)](https://github.com/brpowell/spiral/actions/workflows/desktop-test.yml)
[![Registry CI](https://img.shields.io/github/actions/workflow/status/brpowell/spiral/registry-ci.yml?branch=main&label=registry&style=flat-square)](https://github.com/brpowell/spiral/actions/workflows/registry-ci.yml)
[![License](https://img.shields.io/github/license/brpowell/spiral?color=f6edd6&style=flat-square)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-202c0c?style=flat-square)](#-install)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support%20Spiral-FF5E5B?logo=ko-fi&logoColor=white&style=flat-square)](https://ko-fi.com/brpowell)

**[Download](https://github.com/brpowell/spiral/releases/latest)** &nbsp;·&nbsp;
**[Website](https://spiralpowered.com)** &nbsp;·&nbsp;
**[Contribute](CONTRIBUTING.md)** &nbsp;·&nbsp;
**[Support the project](#-support-spiral)**

<!-- Screenshot: drop one at .github/assets/screenshot.png and uncomment
<br><br>
<img src=".github/assets/screenshot.png" alt="Spiral playing an album" width="860">
-->

</div>

---

## Why Spiral

Streaming made music infinite, and somewhere along the way it stopped feeling like *yours*. Spiral is for the other way of listening: buying albums, ripping your CDs, curating playlists by hand, and caring about the songs you have.

Think of the media players you grew up with at their best, rebuilt with today's tools: fast, private, local-first, and made to be personalized.

> The best music experience isn't the one with the most songs. It's the one that makes you care about the songs you have.

## ✨ Features

- 📚 **Your library, organized**: Point Spiral at your files. It reads your tags, sorts by artist and album, and keeps everything in a fast local database.
- 💿 **CD ripping**: Insert a disc, pull metadata from MusicBrainz, and rip to FLAC or MP3. Your shelf becomes your library.
- 🏷️ **Metadata editing**: Fix tags, swap album art and rename tracks. Full control, no cloud required.
- 🎶 **Playlists**: Build them the old-fashioned way, by hand and with taste.
- 🌈 **Visualizers**: Audio-reactive visuals that make listening feel like an event.
- 🎨 **Themes and skins**: Restyle the whole app, or go full retro with a skin. Browse community packs right inside Spiral.
- 🔒 **Private by design**: No account, no telemetry, no ads. Your listening habits stay on your machine.

## 📦 Install

Grab the build for your platform from the **[latest release](https://github.com/brpowell/spiral/releases/latest)**. Once installed, Spiral keeps itself up to date.

<details>
<summary><b>🍎 macOS</b> &nbsp;<code>.dmg</code>, universal (Apple Silicon and Intel)</summary>
<br>

Builds are not yet signed or notarized by Apple, so macOS may say *"Spiral" is damaged and can't be opened.* The file is fine. After dragging Spiral to Applications, clear the download quarantine flag and open it again:

```bash
xattr -cr /Applications/Spiral.app
```

</details>

<details>
<summary><b>🪟 Windows</b> &nbsp;<code>-setup.exe</code>, x64 and ARM64</summary>
<br>

Windows SmartScreen may warn about an unrecognized app. Choose **More info**, then **Run anyway**.

</details>

<details>
<summary><b>🐧 Linux</b> &nbsp;<code>.AppImage</code>, <code>.deb</code> or <code>.rpm</code>, x86_64 and aarch64</summary>
<br>

For the AppImage, `chmod +x` the file and run it. Install the others with `sudo apt install ./Spiral_*.deb` or `sudo dnf install ./Spiral-*.rpm`.

</details>

## ☕ Support Spiral

Spiral is free, open source, and built in my spare time. If it brings some joy back to your music collection, a coffee helps keep it going.

<a href="https://ko-fi.com/brpowell"><img src="https://storage.ko-fi.com/cdn/kofi2.png?v=3" alt="Buy me a coffee at ko-fi.com" height="40"></a>

Not in a position to chip in? Starring the repo, reporting bugs and telling a friend help just as much.

## 🛠️ For developers

This repository holds the app, the pack registry behind its theme and skin library, and the pack format they share.

| Path | What it is | License |
| --- | --- | --- |
| [`apps/desktop`](apps/desktop) | The Spiral app: Tauri 2, React + TypeScript frontend, Rust backend | Apache-2.0 |
| [`apps/registry`](apps/registry) | `spk-registry`, the Axum service that serves published packs and their catalog | Apache-2.0 |
| [`libs/spk-format`](libs/spk-format) | The `.spk` pack format: manifest schema, validation, and archive extract/write | MIT OR Apache-2.0 |

Packs (`.spk`) are zip archives that add themes, skins, visualizers and sounds to the app. `spk-format` is the single source of truth for what a valid pack is, and both the app and the registry validate with it.

### Build from source

You need a stable [Rust](https://rustup.rs) toolchain and Node.js 22. The desktop app also needs the platform libraries Tauri requires; see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
# Desktop app
cd apps/desktop
npm install
npm run tauri dev

# Registry (listens on 127.0.0.1:8787)
cd apps/registry
cargo run

# Pack format
cargo test -p spk-format
```

Each component has its own README with more detail. The repository is a single Cargo workspace, so `cargo test -p <crate>` works from the root.

## 🤝 Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; for anything large, please open an issue to talk it through before you start. Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

To report a security problem, follow [SECURITY.md](SECURITY.md) rather than opening a public issue.

## 📄 License

The repository is licensed under the [Apache License 2.0](LICENSE). `libs/spk-format` is dual-licensed under MIT OR Apache-2.0 so other tools can adopt the pack format freely. Third-party notices for the desktop app are in [`apps/desktop/src-tauri/NOTICE`](apps/desktop/src-tauri/NOTICE).

<div align="center">
<br>
<img src=".github/assets/spiral-logo.svg" alt="" width="32" height="32">
<br>
<sub>Made for people who still buy albums.</sub>
</div>
