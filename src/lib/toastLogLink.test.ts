import { describe, expect, it, vi } from "vitest";
import { withLogLinkAction } from "./toastLogLink";

vi.mock("./activityLogsWindow", () => ({
  openActivityLogsWindow: vi.fn(),
}));

vi.mock("./i18n", () => ({
  t: (key: string) => key,
}));

describe("withLogLinkAction", () => {
  it("appends view-logs as a secondary action when logLink is set", () => {
    const actions = withLogLinkAction([], { operationId: "op-1" });
    expect(actions).toHaveLength(1);
    expect(actions?.[0].id).toBe("view-logs");
    expect(actions?.[0].variant).toBe("secondary");
  });

  it("keeps View logs secondary when another action is present", () => {
    const actions = withLogLinkAction(
      [{ id: "lyrics-review", label: "Review", onClick: () => {} }],
      { operationId: "op-1" },
    );
    expect(actions).toEqual([
      expect.objectContaining({ id: "lyrics-review" }),
      expect.objectContaining({ id: "view-logs", variant: "secondary" }),
    ]);
  });

  it("leaves actions unchanged when logLink is empty", () => {
    expect(withLogLinkAction(undefined, {})).toBeUndefined();
    const existing = [{ id: "retry", label: "Retry", onClick: () => {} }];
    expect(withLogLinkAction(existing, undefined)).toBe(existing);
  });

  it("does not duplicate an existing view-logs action", () => {
    const existing = [
      { id: "view-logs", label: "View logs", onClick: () => {} },
    ];
    expect(withLogLinkAction(existing, { entryId: "e1" })).toBe(existing);
  });
});
