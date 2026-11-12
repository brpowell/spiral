# Agent automation (dev only)

A coding agent can drive the running app — screenshot, read the DOM, click,
type, read console logs, call Tauri commands — to validate a change in the real
app instead of guessing.

```bash
npm run dev:agent                      # tauri dev + the bridge (macOS or Linux, debug only)
node scripts/agent.mjs windows         # list windows
node scripts/agent.mjs shot main       # PNG screenshot, prints the path
node scripts/agent.mjs snapshot main   # visible interactive elements + selectors
node scripts/agent.mjs click main "text=Albums"
node scripts/agent.mjs eval main "document.title"
node scripts/agent.mjs invoke main some_command '{"arg":1}'
node scripts/agent.mjs logs main       # buffered console + uncaught errors
node scripts/agent.mjs frames main 10 100   # 10 shots, 100 ms apart
node scripts/agent.mjs show skin-mode  # secondary windows start hidden
```

Run `node scripts/agent.mjs help` for every command. To record and replay
staged states for marketing shots, see [marketing-stage.md](marketing-stage.md).

## How it works

`src-tauri/src/agent_bridge.rs` listens on a private Unix socket
(`spiral-agent.sock`, mode 0600, one JSON object per line) in
`$XDG_RUNTIME_DIR` when it is set (per-user on Linux), else `$TMPDIR`
(per-user on macOS). Screenshots land in `spiral-agent/` in the same folder.
`scripts/agent.mjs` is the client; it refuses a socket or screenshot folder
owned by another user, which only matters if it falls back to a shared `/tmp`. Eval uses `WKWebView.callAsyncJavaScript`
(promises are awaited); screenshots use `WKWebView.takeSnapshot`, so no Screen
Recording permission is needed. On Linux, eval uses WebKitGTK's
`evaluate_javascript` (the body runs in the page and the bridge polls for its
result, so promises are awaited too) and screenshots use
`webkit_web_view_snapshot`, which needs no permission. The native window
`capture` command (frame + shadow) is macOS-only. `src/agent_bridge.js` is injected into windows
Spiral creates to buffer console output.

## Safety

The module only compiles with `--features agent-bridge` **and** a debug build
**and** macOS or Linux; every call site carries that same `cfg`. Never pass the feature
to `tauri build`. Windows opened from the frontend (the toast and sound labs)
don't get the log buffer; eval and screenshots still work.

## Linux

On an immutable distro, build in the container that has the WebKitGTK headers,
then run the binary where the GPU is, with Vite serving the frontend:

```bash
npm run dev                          # Vite, on the host
cargo build --features agent-bridge  # in src-tauri, inside the dev container
../../target/debug/Spiral            # on the host
```
