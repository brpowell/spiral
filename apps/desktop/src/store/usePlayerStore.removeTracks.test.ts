import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemovedFile } from "@/lib/tauri";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
}));

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return { ...actual, invoke: mockInvoke };
});

/** Answer `remove_track` with `result(trackId)`. */
function removeTrackAnswers(result: (trackId: TrackId) => RemovedFile) {
  mockInvoke.mockImplementation(async (cmd, args) => {
    if (cmd !== "remove_track") throw new Error(`unexpected ${cmd}`);
    return result((args as { trackId: TrackId }).trackId);
  });
}

import { useBackgroundTasksStore } from "./useBackgroundTasksStore";
import { usePlayerStore } from "./usePlayerStore";
import type { TrackId } from "@/types/track";

describe("removeTracksFromLibrary", () => {
  let showToast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    showToast = vi.fn(() => "toast");
    useBackgroundTasksStore.setState({ showToast });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("explains files left in an offline music folder", async () => {
    removeTrackAnswers((id) => (id === "1" ? "trashed" : "keptUnreachable"));
    await usePlayerStore
      .getState()
      .removeTracksFromLibrary(["1", "2", "3"], true);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Couldn't send 2 files to the trash",
        status: "warning",
      }),
    );
  });

  it("stays quiet when every file was handled", async () => {
    removeTrackAnswers(() => "trashed");
    await usePlayerStore.getState().removeTracksFromLibrary(["1"], true);
    expect(showToast).not.toHaveBeenCalled();
  });
});
