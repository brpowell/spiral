import { describe, expect, it } from "vitest";
import { packUpdatesSettleOptions } from "./toastPayloads";

describe("packUpdatesSettleOptions", () => {
  it("formats all-success as number-first updated clause", () => {
    expect(
      packUpdatesSettleOptions({
        updated: 2,
        failed: 0,
        errors: [],
        operationId: "op-1",
      }),
    ).toMatchObject({
      status: "success",
      label: "2 updated",
    });
  });

  it("joins mixed outcomes with middot", () => {
    expect(
      packUpdatesSettleOptions({
        updated: 1,
        failed: 1,
        errors: ["Xbox: boom"],
        operationId: "op-2",
      }),
    ).toMatchObject({
      status: "warning",
      label: "1 updated · 1 failed",
      detail: "Check your connection and try again.",
      logLink: { operationId: "op-2" },
    });
  });

  it("prefixes Update: when every clause is generic", () => {
    expect(
      packUpdatesSettleOptions({
        updated: 0,
        failed: 2,
        errors: ["a", "b"],
        operationId: "op-3",
      }),
    ).toMatchObject({
      status: "error",
      label: "Update: 2 failed",
      logLink: { operationId: "op-3" },
    });
  });
});
