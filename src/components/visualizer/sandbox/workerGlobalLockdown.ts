/**
 * Allowlist-first lockdown for the VizRenderer worker.
 *
 * Anything on `globalThis` that is not listed here is removed or replaced with
 * a throwing stub before pack source runs. Open entries deliberately when a
 * real pack/engine need appears — do not grow this list "just in case".
 */

export const VIZ_WORKER_ALLOWED_GLOBALS: readonly string[] = [
  // Identity
  "globalThis",
  "self",

  // Language intrinsics packs + THREE rely on
  "Object",
  "Array",
  "Boolean",
  "Number",
  "String",
  "Symbol",
  "BigInt",
  "Math",
  "JSON",
  "Date",
  "RegExp",
  "Promise",
  "Proxy",
  "Reflect",
  "Error",
  "AggregateError",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "WeakRef",
  "FinalizationRegistry",
  "ArrayBuffer",
  "DataView",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "NaN",
  "Infinity",
  "undefined",
  "encodeURI",
  "encodeURIComponent",
  "decodeURI",
  "decodeURIComponent",
  "queueMicrotask",

  // Host blob import (createObjectURL sealed after the single load)
  "Blob",
  "URL",
  "URLSearchParams",

  // Canvas / WebGL drawing surface
  "OffscreenCanvas",
  "ImageData",
  "Path2D",
  "DOMMatrix",
  "DOMMatrixReadOnly",
  "DOMPoint",
  "DOMPointReadOnly",
  "DOMRect",
  "DOMRectReadOnly",
  "ImageBitmap",
  "TextDecoder",
  "TextEncoder",
  "WebGLRenderingContext",
  "WebGL2RenderingContext",

  // Timing (string timer eval is still rejected)
  "performance",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "requestAnimationFrame",
  "cancelAnimationFrame",

  // Host ↔ worker plumbing for pack-visible APIs. `postMessage`/`close` are
  // denied (ALWAYS_DENY); the worker script captures natives before lockdown.
  // Host dispatch uses addEventListener, so overwriting `onmessage` cannot
  // hijack message handling.
  "onmessage",
  "onmessageerror",
  "onerror",
  "MessageEvent",
  "ErrorEvent",
  "PromiseRejectionEvent",
  "Event",
  "EventTarget",
  "MessagePort",
  "MessageChannel",

  // THREE WebGLRenderer probes WorkerNavigator (userAgent, etc.)
  "navigator",

  // Pack author debugging (no network)
  "console",
];

const ALLOWED = new Set(VIZ_WORKER_ALLOWED_GLOBALS);

/** Names that must never remain usable, even if a platform exposes them oddly. */
const ALWAYS_DENY = [
  "eval",
  "Function",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "importScripts",
  "Worker",
  "SharedWorker",
  "WebAssembly",
  "createImageBitmap",
  "Caches",
  "caches",
  "indexedDB",
  "webkitRequestFileSystem",
  "webkitResolveLocalFileSystemURL",
  "location",
  "localStorage",
  "sessionStorage",
  "BroadcastChannel",
  "SharedArrayBuffer",
  "Atomics",
  "crypto",
  "Crypto",
  "SubtleCrypto",
  "ReportingObserver",
  "Scheduler",
  "scheduler",
  "trustedTypes",
  "TrustedHTML",
  "TrustedScript",
  "TrustedScriptURL",

  // WebRTC — CSP `connect-src` does not reliably govern ICE/data channels
  // across every OS-native webview; deny explicitly.
  "RTCPeerConnection",
  "RTCDataChannel",
  "RTCIceCandidate",
  "RTCSessionDescription",
  "webkitRTCPeerConnection",

  // Captured as natives in vizRenderer.worker.ts before lockdown.
  "postMessage",
  "close",
] as const;

function denyAccess(api: string): unknown {
  const throwDisabled = (): never => {
    throw new Error(`[viz-sandbox] ${api} disabled`);
  };
  return new Proxy(throwDisabled, {
    get: throwDisabled,
    apply: throwDisabled,
    construct: throwDisabled,
  });
}

function defineDenied(scope: object, key: string, value: unknown): void {
  try {
    Object.defineProperty(scope, key, {
      configurable: false,
      enumerable: true,
      writable: false,
      value,
    });
  } catch {
    try {
      (scope as Record<string, unknown>)[key] = value;
    } catch {
      // Static scan + allowlist remain the backstop.
    }
  }
}

function removeOrDeny(scope: object, key: string): void {
  const desc = Object.getOwnPropertyDescriptor(scope, key);
  if (!desc) return;

  if (desc.configurable) {
    try {
      Reflect.deleteProperty(scope, key);
      return;
    } catch {
      // fall through to deny stub
    }
  }

  defineDenied(scope, key, denyAccess(key));
}

function wrapTimers(scope: {
  setTimeout: typeof setTimeout;
  setInterval: typeof setInterval;
}): void {
  const nativeSetTimeout = scope.setTimeout.bind(scope);
  const nativeSetInterval = scope.setInterval.bind(scope);
  defineDenied(scope, "setTimeout", (handler: TimerHandler, ...args: unknown[]) => {
    if (typeof handler === "string") {
      throw new Error("[viz-sandbox] string setTimeout disabled");
    }
    return nativeSetTimeout(handler, ...(args as [number?, ...unknown[]]));
  });
  defineDenied(
    scope,
    "setInterval",
    (handler: TimerHandler, ...args: unknown[]) => {
      if (typeof handler === "string") {
        throw new Error("[viz-sandbox] string setInterval disabled");
      }
      return nativeSetInterval(handler, ...(args as [number?, ...unknown[]]));
    },
  );
}

/**
 * Strip non-allowlisted globals, then force-deny high-risk APIs and wrap timers.
 * Call before pack `import()` so top-level pack code cannot capture real APIs.
 */
export function lockDownWorkerGlobals(scope: typeof globalThis): void {
  for (const key of Reflect.ownKeys(scope)) {
    if (typeof key !== "string") continue;
    if (ALLOWED.has(key)) continue;
    removeOrDeny(scope, key);
  }

  for (const key of ALWAYS_DENY) {
    defineDenied(scope, key, denyAccess(key));
  }

  wrapTimers(scope as typeof globalThis & {
    setTimeout: typeof setTimeout;
    setInterval: typeof setInterval;
  });
}

/** After the single host blob import, seal further blob URL minting. */
export function sealBlobUrlApi(): void {
  const deny = denyAccess("URL.createObjectURL");
  const denyRevoke = denyAccess("URL.revokeObjectURL");
  try {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: false,
      writable: false,
      value: deny,
    });
  } catch {
    try {
      URL.createObjectURL = deny as typeof URL.createObjectURL;
    } catch {
      // ignore
    }
  }
  try {
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: false,
      writable: false,
      value: denyRevoke,
    });
  } catch {
    try {
      URL.revokeObjectURL = denyRevoke as typeof URL.revokeObjectURL;
    } catch {
      // ignore
    }
  }
}

export function isVizWorkerGlobalAllowed(name: string): boolean {
  return ALLOWED.has(name) && !(ALWAYS_DENY as readonly string[]).includes(name);
}
