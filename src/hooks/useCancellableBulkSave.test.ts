import { describe, expect, it, vi } from "vitest";
import {
  bulkSaveFooterProps,
  bulkSaveLabel,
  canCancelBulkSave,
} from "./useCancellableBulkSave";

describe("canCancelBulkSave", () => {
  it("is true only during a multi-track progress loop", () => {
    expect(canCancelBulkSave(false, null)).toBe(false);
    expect(canCancelBulkSave(true, null)).toBe(false);
    expect(canCancelBulkSave(true, { current: 2, total: 5 })).toBe(true);
  });
});

describe("bulkSaveLabel", () => {
  const t = vi.fn((key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}:${JSON.stringify(opts)}` : key,
  );

  it("returns save label when idle", () => {
    expect(bulkSaveLabel(false, null, t)).toBe("common:save");
  });

  it("returns progress label during bulk save", () => {
    expect(bulkSaveLabel(true, { current: 2, total: 5 }, t)).toBe(
      'library:editor.savingProgress:{"current":2,"total":5}',
    );
  });
});

describe("bulkSaveFooterProps", () => {
  const t = vi.fn((key: string) => key);
  const requestCancel = vi.fn();
  const requestClose = vi.fn();

  it("routes cancel to requestCancel during bulk save", () => {
    const props = bulkSaveFooterProps({
      saving: true,
      saveProgress: { current: 1, total: 3 },
      cancelRequested: false,
      requestCancel,
      requestClose,
      t,
    });

    props.onCancel();
    expect(requestCancel).toHaveBeenCalled();
    expect(requestClose).not.toHaveBeenCalled();
    expect(props.cancelDisabled).toBe(false);
  });

  it("routes cancel to requestClose when not in bulk save", () => {
    const props = bulkSaveFooterProps({
      saving: false,
      saveProgress: null,
      cancelRequested: false,
      requestCancel,
      requestClose,
      t,
    });

    props.onCancel();
    expect(requestClose).toHaveBeenCalled();
  });
});
