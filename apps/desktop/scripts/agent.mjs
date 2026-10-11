#!/usr/bin/env node
// Client for the dev-only agent bridge (src-tauri/src/agent_bridge.rs).
// Start the app with `npm run dev:agent`, then drive it from here. See
// docs/contributing/agent-automation.md. Zero dependencies; macOS only.
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const SOCKET = path.join(os.tmpdir(), "spiral-agent.sock");

const HELP = `usage: node scripts/agent.mjs <command> [window] [args]

  windows                          list windows (label, visible, focused)
  show <w>                         show + focus a hidden window
  shot <w> [out.png]               screenshot the webview, prints the file path
  frames <w> <n> <ms> [dir]        n screenshots, ms apart (for motion/animation)
  eval <w> <expr>                  evaluate an expression, print JSON result
  eval <w> --body <statements>     run statements; use 'return' to produce a value
  snapshot <w>                     visible interactive elements + selectors + rects
  text <w> [selector]              visible text of the page or an element
  click <w> <css | text=Label | x,y>  dispatch a pointer click
  type <w> <selector> <text>       focus an input and set its value
  key <w> <combo>                  key press, e.g. Enter, Escape, Meta+k, Space
  invoke <w> <command> [json]      call a Tauri command from the page
  logs <w> [--clear]               buffered console output and uncaught errors

<w> is a window label ("main", "skin-mode", ...); it defaults to "main".`;

function call(request) {
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

const evalBody = async (window, body) =>
  (await call({ cmd: "eval", window, body })).value;
const evalExpr = (window, expr) => evalBody(window, `return (${expr});`);

const q = JSON.stringify;

async function screenshot(window, out) {
  const { png } = await call({ cmd: "shot", window });
  const file =
    out ??
    path.join(
      os.tmpdir(),
      "spiral-agent",
      `${window}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
    );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(png, "base64"));
  return file;
}

// Shared page-side helper: resolve a selector or "x,y" to an element + point.
const TARGET = `
  const spec = SPEC;
  let x, y, el;
  if (/^\\s*-?\\d+(\\.\\d+)?\\s*,\\s*-?\\d+(\\.\\d+)?\\s*$/.test(spec)) {
    [x, y] = spec.split(",").map(Number);
    el = document.elementFromPoint(x, y);
  } else {
    if (spec.startsWith("text=")) {
      const want = spec.slice(5).trim().toLowerCase();
      const hits = [...document.querySelectorAll("button, a, [role], summary, label, li, span, div")]
        .filter((n) => n.children.length < 4 && (n.innerText || "").trim().toLowerCase() === want && n.getBoundingClientRect().width > 0);
      el = hits[hits.length - 1] ?? null;
      if (!el) throw new Error("no visible element with text " + want);
    } else {
      el = document.querySelector(spec);
    }
    if (!el) throw new Error("no element matches " + spec);
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = el.getBoundingClientRect();
    x = r.left + r.width / 2;
    y = r.top + r.height / 2;
  }
  if (!el) throw new Error("nothing at " + spec);
`;

const CLICK = (spec) => `${TARGET.replace("SPEC", q(spec))}
  const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true };
  el.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
  el.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 1 }));
  el.dispatchEvent(new PointerEvent("pointerup", init));
  el.dispatchEvent(new MouseEvent("mouseup", init));
  el.dispatchEvent(new MouseEvent("click", init));
  return { clicked: el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""), x: Math.round(x), y: Math.round(y) };`;

const TYPE = (selector, text) => `
  const el = document.querySelector(${q(selector)});
  if (!el) throw new Error("no element matches " + ${q(selector)});
  el.focus();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, ${q(text)}); else el.textContent = ${q(text)};
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { value: el.value ?? el.textContent };`;

const KEY = (combo) => `
  const parts = ${q(combo)}.split("+");
  const key = parts.pop() === "" ? "+" : ${q(combo)}.split("+").pop();
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const aliases = { space: " ", esc: "Escape", enter: "Enter", return: "Enter" };
  const k = aliases[key.toLowerCase()] ?? key;
  const code = k.length === 1 ? (/[a-z]/i.test(k) ? "Key" + k.toUpperCase() : k === " " ? "Space" : k) : k;
  const init = { key: k, code, bubbles: true, cancelable: true, composed: true,
    metaKey: mods.has("meta") || mods.has("cmd"), ctrlKey: mods.has("ctrl"),
    altKey: mods.has("alt"), shiftKey: mods.has("shift") };
  const target = document.activeElement || document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", init));
  target.dispatchEvent(new KeyboardEvent("keyup", init));
  return { key: k, target: target.tagName.toLowerCase() };`;

const SNAPSHOT = `
  const sel = 'button, a[href], input, select, textarea, summary, [role], [tabindex], [aria-label], [data-testid]';
  const hint = (el) => {
    if (el.id) return "#" + CSS.escape(el.id);
    const t = el.getAttribute("data-testid");
    if (t) return '[data-testid="' + t + '"]';
    const a = el.getAttribute("aria-label");
    if (a) return el.tagName.toLowerCase() + '[aria-label="' + a.replace(/"/g, '\\\\"') + '"]';
    return el.tagName.toLowerCase() + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\\s+/).slice(0, 2).map(CSS.escape).join(".") : "");
  };
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || cs.visibility === "hidden" || cs.display === "none") continue;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    out.push({
      selector: hint(el),
      role: el.getAttribute("role") || el.tagName.toLowerCase(),
      name: (el.getAttribute("aria-label") || el.innerText || el.value || el.title || el.placeholder || "").trim().slice(0, 60),
      rect: [r.left, r.top, r.width, r.height].map(Math.round),
      ...(el.disabled ? { disabled: true } : {}),
    });
  }
  return { title: document.title, viewport: [innerWidth, innerHeight], elements: out.slice(0, 300) };`;

const print = (value) =>
  console.log(
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
  );

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help") return console.log(HELP);
  const window = rest[0] && !rest[0].startsWith("-") ? rest[0] : "main";
  const args = rest.slice(1);

  switch (cmd) {
    case "windows":
      return print((await call({ cmd: "windows" })).windows);
    case "show":
      await call({ cmd: "show", window });
      return console.log(`shown ${window}`);
    case "shot":
      return console.log(await screenshot(window, args[0]));
    case "frames": {
      const [count = "5", ms = "200", dir] = args;
      const base =
        dir ?? path.join(os.tmpdir(), "spiral-agent", `frames-${Date.now()}`);
      fs.mkdirSync(base, { recursive: true });
      for (let i = 0; i < Number(count); i++) {
        console.log(
          await screenshot(
            window,
            path.join(base, `${String(i).padStart(3, "0")}.png`),
          ),
        );
        if (i < Number(count) - 1)
          await new Promise((r) => setTimeout(r, Number(ms)));
      }
      return;
    }
    case "eval":
      return print(
        args[0] === "--body"
          ? await evalBody(window, args.slice(1).join(" "))
          : await evalExpr(window, args.join(" ")),
      );
    case "snapshot":
      return print(await evalBody(window, SNAPSHOT));
    case "text":
      return print(
        await evalExpr(
          window,
          args[0]
            ? `document.querySelector(${q(args[0])})?.innerText ?? null`
            : "document.body.innerText",
        ),
      );
    case "click":
      return print(await evalBody(window, CLICK(args[0])));
    case "type":
      return print(
        await evalBody(window, TYPE(args[0], args.slice(1).join(" "))),
      );
    case "key":
      return print(await evalBody(window, KEY(args[0])));
    case "invoke":
      return print(
        await evalBody(
          window,
          `return await window.__TAURI_INTERNALS__.invoke(${q(args[0])}, ${args[1] ?? "{}"});`,
        ),
      );
    case "logs":
      return print(
        await evalExpr(
          window,
          `window.__agent ? window.__agent.logs(${args.includes("--clear")}) : "log hook missing: window was created without the agent init script"`,
        ),
      );
    default:
      console.error(`unknown command: ${cmd}\n\n${HELP}`);
      process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
});
