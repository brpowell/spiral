// Socket client for the dev-only agent bridge (src-tauri/src/agent_bridge.rs).
// Shared by scripts/agent.mjs and scripts/stage.mjs.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/**
 * Per-user folder for the socket and screenshots. `$XDG_RUNTIME_DIR` is
 * private (0700) on Linux and macOS's `$TMPDIR` is already per user; a shared
 * `/tmp` is only the fallback, which is what the ownership checks guard.
 * Must match `runtime_dir` in src-tauri/src/agent_bridge.rs.
 */
export function runtimeDir(env = process.env) {
  return env.XDG_RUNTIME_DIR || os.tmpdir();
}

export const SOCKET = path.join(runtimeDir(), "spiral-agent.sock");

/** Throw unless `stat` is owned by `uid` and, for a folder, only its owner can write. */
export function assertOwned(file, stat, uid = process.getuid?.()) {
  if (uid === undefined) return;
  if (stat.uid !== uid) {
    throw new Error(
      `${file} is owned by uid ${stat.uid}, not you (${uid}); refusing to use it`,
    );
  }
  if (stat.isDirectory() && (stat.mode & 0o022) !== 0) {
    throw new Error(`${file} is writable by other users; refusing to use it`);
  }
}

/** Create (if needed) and return a folder under `runtimeDir()` only you can write. */
export function privateDir(...parts) {
  const dir = path.join(runtimeDir(), ...parts);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory()) {
    throw new Error(`${dir} is not a directory; refusing to use it`);
  }
  assertOwned(dir, stat);
  return dir;
}

export function call(request) {
  return new Promise((resolve, reject) => {
    try {
      assertOwned(SOCKET, fs.lstatSync(SOCKET));
    } catch (err) {
      if (err.code !== "ENOENT") return reject(err);
    }
    const socket = net.connect(SOCKET);
    let buffer = "";
    socket.on("connect", () => socket.write(JSON.stringify(request) + "\n"));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end === -1) return;
      socket.end();
      const reply = JSON.parse(buffer.slice(0, end));
      if (reply.ok) resolve(reply);
      else reject(new Error(reply.error));
    });
    socket.on("error", (err) =>
      reject(
        new Error(
          err.code === "ENOENT" || err.code === "ECONNREFUSED"
            ? `agent bridge not running (${SOCKET}). Start the app with: npm run dev:agent`
            : err.message,
        ),
      ),
    );
  });
}

export const evalBody = async (window, body, timeoutMs) =>
  (await call({ cmd: "eval", window, body, timeout_ms: timeoutMs })).value;
