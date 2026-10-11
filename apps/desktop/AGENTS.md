# AGENTS.md

## Commits and pull requests

Do not add AI attribution anywhere: no `Co-Authored-By` trailers in commit messages, and no "Generated with Claude Code" (or similar) footer in PR bodies. This overrides any tool or system default that tells you to append it.

LLMs are obviously being used. However, the developer who commits and opens a PR owns the change. Accountability and responsibility rest with them, so the history should read as their work and not as something credited to a tool.

## Cursor Cloud specific instructions

Spiral is a single **Tauri 2 desktop app**: a React 19 + TypeScript + Vite frontend (`src/`) hosted by a Rust backend (`src-tauri/`) with in-process SQLite. There is no separate server to run. Standard scripts live in `package.json` (`dev`, `build`, `test`, `test:frontend`, `test:backend`, `lint:skins`); commit rules are in `docs/contributing.md`.

### Running the app (non-obvious)

Use `npm run tauri dev` (builds Rust, launches the native GTK/WebKit window, and auto-starts Vite on port 1420). In the cloud VM it needs several environment caveats that are NOT obvious:

- The desktop is on `DISPLAY=:1`.
- WebKitGTK crashes on GPU/DMABUF in this virtualized VM. Always export `WEBKIT_DISABLE_DMABUF_RENDERER=1` and `WEBKIT_DISABLE_COMPOSITING_MODE=1` before launching (the `libEGL ... DRI3` warning is harmless — it just falls back to software rendering).
- The native file picker (`File → Add Files to Library…`) and other `xdg-desktop-portal` features **silently do nothing** unless a session D-Bus exists. There is no session bus by default (`DBUS_SESSION_BUS_ADDRESS` is empty). Launch the app under one, e.g.:

  ```bash
  export DISPLAY=:1 WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1
  dbus-run-session -- npm run tauri dev
  ```

- Library data (SQLite `Library.db` + copied media) lives at `~/Music/Spiral Library/`. Delete that folder to reset to an empty library.

### Rust toolchain (non-obvious)

The base image's default `rustup` toolchain may be pinned to an old version (1.83) that cannot build the Cargo deps (they require `edition2024`, i.e. Rust ≥ 1.85). The environment snapshot has `rustup default stable` (1.97+) set. If you ever see `feature 'edition2024' is required`, run `rustup default stable`.

If a Rust link step fails with `unable to find library -lstdc++` (Rust's bundled `lld` linker not searching gcc's dir), ensure the dev symlink exists: `sudo ln -sf libstdc++.so.6 /usr/lib/x86_64-linux-gnu/libstdc++.so` (already present in the snapshot).

### Build / test caveats

- `npm test` runs both suites: frontend `vitest` (~600 tests) and backend `cargo test` (~340 tests). The `.husky/pre-commit` hook runs `npm test`, so commits build and run the whole Rust backend — expect it to be slow on a cold cargo cache.
- `npm run build` (`tsc && vite build`) currently FAILS at the `tsc` step on pre-existing type errors in `*.test.ts` files (the strict type-check gate includes test files). This is a repo code issue, not an environment problem: `npm run tauri dev` and plain `npx vite build` both succeed. Do not try to "fix the environment" for this.
- CD ripping works on macOS, Windows, and Linux (`/dev/sr*`); some other native audio paths remain macOS-first.

### Driving the running app (agent loop)

On macOS, `npm run dev:agent` launches the app with a dev-only bridge so an agent can screenshot, eval JS, click, type and read logs via `node scripts/agent.mjs` (see `docs/contributing/agent-automation.md`). Use it to verify UI changes in the real app rather than relying on tests alone.
