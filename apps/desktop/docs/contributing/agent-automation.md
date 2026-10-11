# Agent automation (dev only)

A coding agent can drive the running app — screenshot, read the DOM, click,
type, read console logs, call Tauri commands — to validate a change in the real
app instead of guessing.

```bash
npm run dev:agent                      # tauri dev + the bridge (macOS, debug only)
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

Run `node scripts/agent.mjs help` for every command.

## How it works

`src-tauri/src/agent_bridge.rs` listens on a private Unix socket
(`$TMPDIR/spiral-agent.sock`, mode 0600, one JSON object per line).
`scripts/agent.mjs` is the client. Eval uses `WKWebView.callAsyncJavaScript`
(promises are awaited); screenshots use `WKWebView.takeSnapshot`, so no Screen
Recording permission is needed. `src/agent_bridge.js` is injected into windows
Spiral creates to buffer console output.

## Safety

The module only compiles with `--features agent-bridge` **and** a debug build
**and** macOS; every call site carries that same `cfg`. Never pass the feature
to `tauri build`. Windows opened from the frontend (the toast and sound labs)
don't get the log buffer; eval and screenshots still work.
