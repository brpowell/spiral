import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VIZ_WORKER_CSP } from "./src/components/visualizer/sandbox/workerCsp";

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

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), stripMjsShebang(), vizWorkerCsp()],
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
