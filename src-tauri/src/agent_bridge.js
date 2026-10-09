// Injected into every Spiral window by `agent_bridge.rs` (dev builds only).
// Buffers console output and uncaught errors so `scripts/agent.mjs logs` can
// read what happened before the agent attached.
(() => {
  if (window.__agent) return;
  const MAX = 500;
  const buf = [];
  const fmt = (v) => {
    if (typeof v === "string") return v;
    if (v instanceof Error) return v.stack || String(v);
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };
  const push = (level, args) => {
    buf.push({ t: Date.now(), level, msg: args.map(fmt).join(" ") });
    if (buf.length > MAX) buf.shift();
  };
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      push(level, args);
      original(...args);
    };
  }
  addEventListener("error", (e) =>
    push("error", [`${e.message} @ ${e.filename}:${e.lineno}`]),
  );
  addEventListener("unhandledrejection", (e) =>
    push("error", [`unhandledrejection: ${fmt(e.reason)}`]),
  );
  window.__agent = {
    logs(clear) {
      const out = buf.slice();
      if (clear) buf.length = 0;
      return out;
    },
  };
})();
