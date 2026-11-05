import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VIZ_WORKER_CSP } from "./src/components/visualizer/sandbox/workerCsp";
import {
  applyIconTagUpdate,
  parseIconTagUpdate,
  type IconTagTable,
} from "./src/lib/iconLibrary/iconTagTable";

const host = process.env.TAURI_DEV_HOST;

/** vite-node strips `#!…\n` but not `#!…\r\n`, so CRLF checkouts break .mjs imports. */
function stripMjsShebang(): Plugin {
  return {
    name: "strip-mjs-shebang",
    transform(code, id) {
      if (!id.endsWith(".mjs") || !code.startsWith("#!")) return null;
      return code.replace(/^#![^\r\n]*\r?\n/, "");
    },
  };
}

/**
 * Serve the visualizer worker with its own CSP under `tauri dev`, as
 * `src-tauri/src/viz_worker_csp.rs` does for packaged builds. The worker
 * refuses to run pack code without it.
 */
function vizWorkerCsp(): Plugin {
  return {
    name: "viz-worker-csp",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [path, query = ""] = (req.url ?? "").split("?", 2);
        if (
          path?.endsWith("/visualizer/sandbox/vizRenderer.worker.ts") &&
          new URLSearchParams(query).has("worker_file")
        ) {
          res.setHeader("Content-Security-Policy", VIZ_WORKER_CSP);
        }
        next();
      });
    },
  };
}

const ICON_TAGS_FILE = fileURLToPath(
  new URL("./src/lib/iconLibrary/iconTags.json", import.meta.url),
);
const ICON_TAGS_ENDPOINT = "/__icon-lab/tags";
/** An icon tag update is tiny; refuse anything bigger. */
const ICON_TAGS_MAX_BODY = 16 * 1024;

/**
 * Dev-only endpoint behind Developer → Icon Lab: persists one icon's tags into
 * `iconTags.json`. Vite then hot-applies the file (see iconLibrary/registry).
 */
function iconLabTags(): Plugin {
  return {
    name: "icon-lab-tags",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(ICON_TAGS_ENDPOINT, (req, res) => {
        const reply = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        if (req.method !== "POST") {
          reply(405, { error: "POST only" });
          return;
        }
        let raw = "";
        let tooLarge = false;
        req.on("data", (chunk: Buffer) => {
          raw += chunk.toString("utf8");
          if (raw.length > ICON_TAGS_MAX_BODY) {
            tooLarge = true;
            req.destroy();
          }
        });
        req.on("close", () => {
          if (tooLarge) reply(413, { error: "Body too large" });
        });
        req.on("end", () => {
          void (async () => {
            try {
              const update = parseIconTagUpdate(JSON.parse(raw));
              if (!update) {
                reply(400, { error: "Expected { id, tags: string[] }" });
                return;
              }
              const current = JSON.parse(
                await fs.readFile(ICON_TAGS_FILE, "utf8"),
              ) as IconTagTable;
              const next = applyIconTagUpdate(current, update);
              const prettier = await import("prettier");
              const formatted = await prettier.format(JSON.stringify(next), {
                parser: "json",
              });
              await fs.writeFile(ICON_TAGS_FILE, formatted);
              reply(200, { ok: true });
            } catch (err) {
              reply(500, { error: String(err) });
            }
          })();
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), stripMjsShebang(), vizWorkerCsp(), iconLabTags()],
  // Expose SPIRAL_* (e.g. SPIRAL_ENABLE_UPDATER) alongside default VITE_*.
  envPrefix: ["VITE_", "SPIRAL_"],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
          environment: "node",
          setupFiles: ["./src/test/setup.unit.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "ui",
          include: ["src/**/*.test.tsx"],
          environment: "happy-dom",
          setupFiles: ["./src/test/setup.ts"],
        },
      },
    ],
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
