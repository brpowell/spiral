import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VIZ_WORKER_CSP, assertWorkerCspEnforced } from "./workerCsp";

const blockedEval = {
  eval: () => {
    throw new EvalError("refused by CSP");
  },
};
const blockedImport = () => Promise.reject(new TypeError("refused by CSP"));

describe("VIZ_WORKER_CSP", () => {
  it("matches the policy the packaged app serves", () => {
    const rust = readFileSync(
      join(process.cwd(), "src-tauri/src/viz_worker_csp.rs"),
      "utf8",
    );
    expect(rust).toContain(
      `pub const VIZ_WORKER_CSP: &str = "${VIZ_WORKER_CSP}";`,
    );
  });

  it("forbids eval, network, asset reads and nested workers", () => {
    expect(VIZ_WORKER_CSP).toContain("default-src 'none'");
    expect(VIZ_WORKER_CSP).not.toMatch(/unsafe-eval|asset:|https?:|data:/);
  });
});

describe("assertWorkerCspEnforced", () => {
  it("passes when eval and data: imports are refused", async () => {
    await expect(
      assertWorkerCspEnforced(blockedEval, blockedImport),
    ).resolves.toBeUndefined();
  });

  it("fails closed when eval still works", async () => {
    await expect(
      assertWorkerCspEnforced({ eval: () => 0 }, blockedImport),
    ).rejects.toThrow(/Content-Security-Policy is not in effect/);
  });

  it("fails closed when a data: module still loads", async () => {
    await expect(
      assertWorkerCspEnforced(blockedEval, () => Promise.resolve({})),
    ).rejects.toThrow(/Content-Security-Policy is not in effect/);
  });

  it("fails closed in a realm with no CSP at all", async () => {
    await expect(assertWorkerCspEnforced()).rejects.toThrow(
      /Content-Security-Policy is not in effect/,
    );
  });
});
