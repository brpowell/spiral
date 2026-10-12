# Spiral

**Your music. Owned. Organized. Beautiful.**

Spiral is a free and open source desktop music player for people who still own their music: no streaming, no ads, no algorithms, no tracking. This repository holds the app, the pack registry behind its theme and skin library, and the pack format they share.

- Website: [spiralpowered.com](https://spiralpowered.com)
- Downloads: [GitHub Releases](https://github.com/brpowell/spiral/releases) (look for tags named `desktop-v*`)

## What's in this repo

| Path | What it is | License |
| --- | --- | --- |
| [`apps/desktop`](apps/desktop) | The Spiral app: Tauri 2, React + TypeScript frontend, Rust backend | Apache-2.0 |
| [`apps/registry`](apps/registry) | `spk-registry`, the Axum service that serves published packs and their catalog | Apache-2.0 |
| [`libs/spk-format`](libs/spk-format) | The `.spk` pack format: manifest schema, validation, and archive extract/write | MIT OR Apache-2.0 |

Packs (`.spk`) are zip archives that add themes, skins, visualizers and sounds to the app. `spk-format` is the single source of truth for what a valid pack is, and both the app and the registry validate with it.

## Install

Download the build for your platform from the [latest release](https://github.com/brpowell/spiral/releases/latest).

- **macOS** (`.dmg`, universal for Apple Silicon and Intel): builds are not yet signed or notarized by Apple, so macOS may say *"Spiral" is damaged and can't be opened.* The file is fine. After dragging Spiral to Applications, clear the download quarantine flag and open it again:

  ```bash
  xattr -cr /Applications/Spiral.app
  ```

- **Windows** (`-setup.exe`, x64 and ARM64): Windows SmartScreen may warn about an unrecognized app. Choose **More info**, then **Run anyway**.
- **Linux** (`.AppImage`, `.deb` or `.rpm`, x86_64 and aarch64): for the AppImage, `chmod +x` the file and run it. Install the others with `sudo apt install ./Spiral_*.deb` or `sudo dnf install ./Spiral-*.rpm`.

Once installed, Spiral checks for updates itself.

## Build from source

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

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; for anything large, please open an issue to talk it through before you start. Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

To report a security problem, follow [SECURITY.md](SECURITY.md) rather than opening a public issue.

## License

The repository is licensed under the [Apache License 2.0](LICENSE). `libs/spk-format` is dual-licensed under MIT OR Apache-2.0 so other tools can adopt the pack format freely. Third-party notices for the desktop app are in [`apps/desktop/src-tauri/NOTICE`](apps/desktop/src-tauri/NOTICE).
