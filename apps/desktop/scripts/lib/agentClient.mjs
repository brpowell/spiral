// Socket client for the dev-only agent bridge (src-tauri/src/agent_bridge.rs).
// Shared by scripts/agent.mjs and scripts/stage.mjs.
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const SOCKET = path.join(os.tmpdir(), "spiral-agent.sock");

export function call(request) {
  return new Promise((resolve, reject) => {
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
