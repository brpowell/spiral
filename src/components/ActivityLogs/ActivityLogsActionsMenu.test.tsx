import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "../../lib/clipboard";
import { useActivityLogStore } from "../../store/useActivityLogStore";
import type { ActivityLogEntry } from "../../types/activityLog";
import { ActivityLogsActionsMenu } from "./ActivityLogsActionsMenu";

vi.mock("../../lib/clipboard", () => ({
  copyTextToClipboard: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../lib/diagnosticsExport", () => ({
  saveDiagnosticsToFile: vi.fn().mockResolvedValue("/tmp/logs.json"),
}));

vi.mock("../../lib/activityLogBridge", () => ({
  clearActivityLogsRemote: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/activityLogToast", () => ({
  showActivityLogCopiedToast: vi.fn(),
}));

const copyTextToClipboardMock = vi.mocked(copyTextToClipboard);

function entry(partial: Partial<ActivityLogEntry> = {}): ActivityLogEntry {
  return {
    id: "1",
    timestampMs: 1_700_000_000_000,
    level: "info",
    domain: "library.import",
    message: "Imported track.flac",
    ...partial,
  };
}

function openActionsMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Activity log actions" }));
}

describe("ActivityLogsActionsMenu", () => {
  beforeEach(() => {
    copyTextToClipboardMock.mockResolvedValue(true);
    useActivityLogStore.setState({ autoScroll: true });
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("11:13:54");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies the visible log list as display text", async () => {
    render(
      <ActivityLogsActionsMenu
        includeClear
        entries={[
          entry(),
          entry({
            id: "2",
            level: "warn",
            message: "Skipped duplicate",
          }),
        ]}
      />,
    );

    openActionsMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy logs" }));

    await waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalledWith(
        "11:13:54  info  Imported track.flac\n11:13:54  warn  Skipped duplicate",
      );
    });
  });

  it("disables copy when the visible list is empty", () => {
    render(<ActivityLogsActionsMenu includeClear entries={[]} />);
    openActionsMenu();
    expect(screen.getByRole("menuitem", { name: "Copy logs" })).toBeDisabled();
  });

  it("toggles auto-scroll from the menu without closing it", () => {
    render(<ActivityLogsActionsMenu includeClear entries={[entry()]} />);
    openActionsMenu();

    const toggle = screen.getByRole("menuitemcheckbox", {
      name: "Auto-scroll",
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);

    expect(useActivityLogStore.getState().autoScroll).toBe(false);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});
