# On-machine profiling

How to build a symbolicated Spiral binary and sample CPU, memory, disk, and idle/energy **on this machine**. **No performance telemetry, analytics, or off-device profile upload.** samply can serve Firefox Profiler **locally**; use **File → Open** on a saved profile. Do not use the public profiler upload.

What to attack (ranked findings, regression risk, skin checklist): [resource-optimization.md](../general/resource-optimization.md).

---

## Process map

Spiral is one Tauri 2 app: a Rust host (`src-tauri`, binary name **`Spiral`**) plus one WebKit/WebView2 process **per window**. There is no separate server.

| Process (typical name) | Owns |
| --- | --- |
| `Spiral` | SQLite (`~/Music/Spiral Library/Library.db`), PCM decode (Symphonia), CD monitor, pack I/O, Tauri IPC |
| WebKit Web Content / `WebKitWebProcess` (macOS/Linux) or `msedgewebview2.exe` (Windows) | React UI, Web Audio worklet, visualizers (canvas/WebGL/Three), skin GIF/bitmaps |
| GPU / `WebKit.GPU` (when compositing is on) | Visualizer and skin compositing |

`tauri.conf.json` declares **six** windows at launch (`main`, `skin-mode`, `appearance`, `equalizer`, `activity-logs`, `about`). Hidden windows still load `index.html` → `src/main.tsx` (one SPA; role is chosen after `bootstrapWindowRole()`). Extra skin-aux / toast-lab windows are created on demand.

Playback is **not** Howler for library files. Rust streams little-endian `f32` PCM over Tauri events into a Web Audio worklet (`FILE_PCM_READ_AHEAD_SECONDS = 2`). Howler remains only for skin SFX (`src/lib/skinSoundEffects.ts`).

---

## Playbook

### 0. Never profile `tauri dev`

`npm run tauri dev` is a debug Rust binary + Vite HMR. Numbers will not match users. Use a release-like binary (symbols on).

### 1. Build a symbolicated release binary

From the repo root (after `npm install` and `npm run bootstrap`):

```bash
# Frontend into dist/, then Rust release with debug info (tauri still uses [profile.release])
CARGO_PROFILE_RELEASE_DEBUG=true CARGO_PROFILE_RELEASE_STRIP=false \
  npm run tauri -- build --no-bundle
```

Or cargo-only (host lib/bin; still run `npm run build` first if you will launch the UI):

```bash
npm run build
cargo build --manifest-path src-tauri/Cargo.toml --profile profiling
```

`[profile.profiling]` inherits `release` with `debug = true`. It does **not** change `tauri build` / CI installers.

| OS | Binary to attach |
| --- | --- |
| Linux | `src-tauri/target/release/Spiral` (or `target/profiling/Spiral`) |
| macOS | `src-tauri/target/release/Spiral` or `src-tauri/target/release/bundle/macos/Spiral.app` |
| Windows | `src-tauri/target/release/Spiral.exe` |

Helper: `npm run profile:build` runs the `CARGO_PROFILE_RELEASE_DEBUG` `tauri build --no-bundle` path and prints the binary path.

Launch under a session bus on this Linux VM if you need file pickers (see `AGENTS.md`):

```bash
export DISPLAY=:1 WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1
dbus-run-session -- src-tauri/target/release/Spiral
```

WebKit GPU flags above **change** GPU/energy vs a real desktop — note that when comparing Linux VM traces to macOS/Windows laptops.

### 2. What to capture (same scenarios, local only)

Record **20–40 s** each, cold-start vs warmed. Finding numbers refer to [resource-optimization.md](../general/resource-optimization.md#ranked-opportunities).

1. **Idle library** — main visible, stopped, visualizer strip on screen, no Studio/EQ.
2. **Idle, extra windows** — open Studio + EQ + About, then hide them (eager-webview hypothesis).
3. **Playback, viz mini** — local FLAC/MP3, now-playing visualizer not expanded.
4. **Playback, viz expanded / WebGL** — Neon Tunnel.
5. **Skin mode** — hide main, canvas skin + vis, playing (click-through + viz pull + keepalive).
6. **Burst** — play audio, then install a pack or “Get more” catalog fetch (sync IPC vs PCM).

### 3. samply (Linux / macOS) → local Firefox Profiler

```bash
cargo install samply
# Launch + sample the host (Rust). Webview CPU is a sibling process — sample that too if idle JS is the question.
samply record src-tauri/target/release/Spiral
# or attach
samply record --pid "$(pgrep -n Spiral)"
```

samply opens a **local** Firefox Profiler UI. Save the profile file next to the run; do not upload.

To see JS/webview: find the WebKit PID (`pgrep -fl WebKit` / Activity Monitor “Spiral Helper” / “Web Content”) and `samply record --pid <pid>`.

### 4. Instruments (macOS)

```bash
# Time Profiler on the .app (or attach to a running Spiral)
instruments -t "Time Profiler" -D /tmp/spiral-cpu.trace \
  src-tauri/target/release/bundle/macos/Spiral.app
```

Also useful: **Energy Log**, **Allocations** (host), **Game Performance** / Metal (visualizer). Attach separately to **Spiral** and **Spiral Web Content**. Window → CPU Usage shows idle wake-ups.

### 5. Activity Monitor / Task Manager / `top`

Finding numbers: [resource-optimization.md](../general/resource-optimization.md#ranked-opportunities).

| Look at | Idle library | Playing | Skin mode |
| --- | --- | --- | --- |
| `% CPU` Spiral vs Web Content vs GPU | Web Content high → findings 1, 2, 12 | Both high → 3, 6, 11 | Web Content + IPC → 10, 11 |
| Memory (private) per webview | Grows with window count → 4, 9 | PCM buffers ~2 s/deck → expected | Skin bitmaps/GIFs |
| Energy / idle wake-ups (macOS) | Throttling / RAF → 1, 2 | | Click-through timer → 10 |
| Disk I/O | First-scroll thumbs → 13 | Decode is CPU, not disk if cached | Pack watch is quiet |

Linux:

```bash
ps -o pid,pcpu,rss,comm -p "$(pgrep -d, -f 'Spiral|WebKit')"
# optional: pidstat -H 1 ; iostat -xz 1
```

Windows: Resource Monitor → `Spiral.exe` + `msedgewebview2.exe`.

### 6. Webview performance panel (debug builds only)

Debug / `tauri dev` has Web Inspector. Use it to **identify JS call stacks** (RAF, `setFrame`, `decodePcmBase64`), not to judge release CPU. Performance → record idle vs playing. Memory → heap snapshot after opening Studio.

### 7. Suggested confirmation order (risk-first)

Profile to **confirm** a hypothesis; implement in [attack order](../general/resource-optimization.md#attack-order-risk-first), not by idle-CPU size.

1. Idle library, viz mounted → #1 (low–med risk, high idle CPU).
2. Art dir / binary size if those are the question → #13, #7 (very low risk).
3. Playing, seek bar vs time digits → #12.
4. Play + pack install / catalog → #5, #14, then #6 with an event→window matrix.
5. **Do not** treat hidden-main / skin-mode idle CPU as the first patch (#2, #10, #11) even if the profile is ugly there.

A change is done only if the intended drop appears **and** the [skin checklist](../general/resource-optimization.md#skin-focused-invariant-checklist) is green. Keep changes free of telemetry.
