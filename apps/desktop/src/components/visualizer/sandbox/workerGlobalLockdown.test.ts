import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  VIZ_WORKER_ALLOWED_GLOBALS,
  isVizWorkerGlobalAllowed,
  lockDownWorkerGlobals,
  sealFunctionConstructors,
} from "./workerGlobalLockdown";

describe("viz worker global allowlist", () => {
  it("allows drawing / language primitives packs need", () => {
    expect(isVizWorkerGlobalAllowed("Math")).toBe(true);
    expect(isVizWorkerGlobalAllowed("OffscreenCanvas")).toBe(true);
    expect(isVizWorkerGlobalAllowed("Float32Array")).toBe(true);
    expect(isVizWorkerGlobalAllowed("console")).toBe(true);
    expect(isVizWorkerGlobalAllowed("requestAnimationFrame")).toBe(true);
  });

  it("denies network, code-loading, and storage surfaces", () => {
    for (const name of [
      "fetch",
      "XMLHttpRequest",
      "WebSocket",
      "Worker",
      "importScripts",
      "eval",
      "Function",
      "WebAssembly",
      "createImageBitmap",
      "indexedDB",
      "localStorage",
      "crypto",
    ]) {
      expect(isVizWorkerGlobalAllowed(name)).toBe(false);
    }
  });

  it("denies WebRTC (CSP connect-src is not a reliable backstop for ICE)", () => {
    for (const name of [
      "RTCPeerConnection",
      "RTCDataChannel",
      "RTCIceCandidate",
      "RTCSessionDescription",
      "webkitRTCPeerConnection",
    ]) {
      expect(isVizWorkerGlobalAllowed(name)).toBe(false);
    }
  });

  it("denies postMessage/close so packs cannot forge protocol messages", () => {
    expect(isVizWorkerGlobalAllowed("postMessage")).toBe(false);
    expect(isVizWorkerGlobalAllowed("close")).toBe(false);
  });

  it("denies SharedArrayBuffer/Atomics deliberately", () => {
    expect(isVizWorkerGlobalAllowed("SharedArrayBuffer")).toBe(false);
    expect(isVizWorkerGlobalAllowed("Atomics")).toBe(false);
  });

  it("allows navigator for THREE WebGL capability probes", () => {
    expect(isVizWorkerGlobalAllowed("navigator")).toBe(true);
  });

  it("has no duplicates in the allowlist", () => {
    expect(new Set(VIZ_WORKER_ALLOWED_GLOBALS).size).toBe(
      VIZ_WORKER_ALLOWED_GLOBALS.length,
    );
  });

  it("strips non-allowlisted own properties and stubs ALWAYS_DENY APIs", () => {
    const scope = {
      Math,
      Object,
      fetch: () => Promise.resolve(new Response()),
      postMessage: () => 1,
      evilApi: () => 1,
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
    } as unknown as typeof globalThis;

    Object.defineProperty(scope, "Math", { value: Math, configurable: true });
    Object.defineProperty(scope, "Object", {
      value: Object,
      configurable: true,
    });

    lockDownWorkerGlobals(scope);

    expect(Object.prototype.hasOwnProperty.call(scope, "evilApi")).toBe(false);
    expect(() =>
      (scope as unknown as { fetch: () => unknown }).fetch(),
    ).toThrow(/disabled/);
    expect(() =>
      (scope as unknown as { postMessage: () => unknown }).postMessage(),
    ).toThrow(/disabled/);
  });

  it("seals the function-constructor escape on every function kind", () => {
    // A separate realm, so this test does not seal Vitest's own intrinsics.
    const realm = createContext({});
    const prototypes = runInContext(
      `[function () {}, async function () {}, function* () {}, async function* () {}]
        .map((fn) => Object.getPrototypeOf(fn))`,
      realm,
    ) as object[];

    sealFunctionConstructors(prototypes);

    for (const kind of [
      "(function () {})",
      "(async function () {})",
      "(function* () {})",
      "(async function* () {})",
      "(() => {})",
    ]) {
      expect(() =>
        runInContext(`${kind}.constructor("return 1")()`, realm),
      ).toThrow(/disabled/);
    }
    // Ordinary functions keep working.
    expect(runInContext("[1, 2].map((n) => n * 2).join()", realm)).toBe("2,4");
  });
});
