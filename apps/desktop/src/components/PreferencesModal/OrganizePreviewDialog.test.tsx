import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FileConflict,
  FilePlanApplySummary,
  FilePlanProgress,
  FilePlanSummary,
  PlannedFileOp,
  Source,
} from "../../types/source";
import { OrganizePreviewDialog } from "./OrganizePreviewDialog";

const tauri = vi.hoisted(() => ({
  previewOrganizeSource: vi.fn(),
  applyOrganizeSource: vi.fn(),
  FILE_PLAN_PROGRESS_EVENT: "library://file-plan-progress",
}));

const events = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("../../lib/tauri", () => tauri);
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (name: string, handler: (event: { payload: unknown }) => void) => {
      events.handlers.set(name, handler);
      return Promise.resolve(() => events.handlers.delete(name));
    },
  ),
}));

const music: Source = {
  id: 3,
  rootPath: "/Volumes/Big/Music",
  name: "Music",
  autoOrganize: false,
  pathFormat: null,
  importTarget: false,
  createdAt: "2026-01-01T00:00:00Z",
};

function op(
  trackId: number,
  from: string,
  to: string,
  conflict: FileConflict | null = null,
): PlannedFileOp {
  const loc = (relPath: string) => ({
    sourceId: 3,
    relPath,
    path: `/Volumes/Big/Music/${relPath}`,
  });
  return {
    op: { kind: "move", trackId, from: loc(from), to: loc(to) },
    conflict,
  };
}

const plan: FilePlanSummary = {
  moves: 3,
  renamed: 1,
  skipped: 2,
  unchanged: 5,
  sample: [
    op(1, "a.mp3", "Artist/Album/A.mp3"),
    op(2, "b.mp3", "Artist/Album/B (2).mp3", {
      kind: "targetExists",
      wanted: "Artist/Album/B.mp3",
    }),
  ],
  conflicts: [
    op(2, "b.mp3", "Artist/Album/B (2).mp3", {
      kind: "targetExists",
      wanted: "Artist/Album/B.mp3",
    }),
    op(4, "gone.mp3", "Artist/Gone.mp3", { kind: "sourceMissing" }),
    op(5, "dot.mp3", ".hack/Dot.mp3", { kind: "hiddenTarget" }),
  ],
};

function progress(payload: FilePlanProgress) {
  act(() => {
    events.handlers.get("library://file-plan-progress")?.({ payload });
  });
}

describe("OrganizePreviewDialog", () => {
  const onClose = vi.fn();
  const onApplied = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    events.handlers.clear();
    tauri.previewOrganizeSource.mockResolvedValue(plan);
  });

  function renderDialog(pathFormat?: string) {
    render(
      <OrganizePreviewDialog
        request={{ source: music, pathFormat }}
        onClose={onClose}
        onApplied={onApplied}
      />,
    );
    return screen.getByRole("dialog", { name: "Organize “Music”?" });
  }

  it("shows counts, sample moves and localized conflicts", async () => {
    const dialog = renderDialog();
    await within(dialog).findByRole("button", { name: "Move 3 files" });

    const count = (label: string) =>
      within(dialog).getByText(label).closest("div")?.querySelector("dd")
        ?.textContent;
    expect(count("Move")).toBe("2");
    expect(count("Numbered name")).toBe("1");
    expect(count("Skipped")).toBe("2");
    expect(count("Already in place")).toBe("5");

    expect(within(dialog).getByText("Artist/Album/A.mp3")).toBeTruthy();
    expect(within(dialog).getByText("And 1 more file.")).toBeTruthy();

    expect(
      within(dialog).getByText(
        "A file already exists at Artist/Album/B.mp3, so this one gets a numbered name.",
      ),
    ).toBeTruthy();
    expect(
      within(dialog).getByText("The file is missing, so it stays where it is."),
    ).toBeTruthy();
    expect(
      within(dialog).getByText(
        "Its new path has a hidden name (starting with a dot), so it stays where it is.",
      ),
    ).toBeTruthy();
    expect(within(dialog).queryByText(/hiddenTarget/)).toBeNull();
  });

  it("previews the given format and shows it", async () => {
    const dialog = renderDialog("{artist}/{title}.{ext}");
    await within(dialog).findByRole("button", { name: "Move 3 files" });
    expect(tauri.previewOrganizeSource).toHaveBeenCalledWith(
      3,
      "{artist}/{title}.{ext}",
    );
    expect(within(dialog).getByText("{artist}/{title}.{ext}")).toBeTruthy();
  });

  it("cancels without applying", async () => {
    const dialog = renderDialog();
    await within(dialog).findByRole("button", { name: "Move 3 files" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(tauri.applyOrganizeSource).not.toHaveBeenCalled();
  });

  it("shows progress while applying, then the result", async () => {
    let finish!: (summary: FilePlanApplySummary) => void;
    tauri.applyOrganizeSource.mockReturnValue(
      new Promise<FilePlanApplySummary>((resolve) => {
        finish = resolve;
      }),
    );
    const dialog = renderDialog();
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Move 3 files" }),
    );
    await waitFor(() =>
      expect(events.handlers.has("library://file-plan-progress")).toBe(true),
    );
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();

    progress({ sourceId: 3, done: 2, total: 3 });
    expect(within(dialog).getByText("Moving files: 2 of 3")).toBeTruthy();
    progress({ sourceId: 9, done: 1, total: 10 });
    expect(within(dialog).getByText("Moving files: 2 of 3")).toBeTruthy();

    await act(async () => {
      finish({ moved: 2, failed: 1, errors: ["b.mp3: permission denied"] });
    });
    expect(
      await within(dialog).findByText(
        "Moved 2 files. Spiral now keeps this source organized.",
      ),
    ).toBeTruthy();
    expect(
      within(dialog).getByText(
        "1 file couldn't be moved and stays where it was.",
      ),
    ).toBeTruthy();
    expect(within(dialog).getByText("b.mp3: permission denied")).toBeTruthy();
    expect(onApplied).toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("offers to just turn organizing on when nothing would move", async () => {
    tauri.previewOrganizeSource.mockResolvedValue({
      ...plan,
      moves: 0,
      renamed: 0,
      skipped: 0,
      sample: [],
      conflicts: [],
    });
    tauri.applyOrganizeSource.mockResolvedValue({
      moved: 0,
      failed: 0,
      errors: [],
    });
    const dialog = renderDialog();
    expect(
      await within(dialog).findByText(/already where the path format puts it/),
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Turn on organizing" }),
    );
    await waitFor(() =>
      expect(tauri.applyOrganizeSource).toHaveBeenCalledWith(3, undefined),
    );
  });

  it("explains a preview that fails, e.g. for an offline folder", async () => {
    tauri.previewOrganizeSource.mockRejectedValue(
      "The folder /Volumes/Big/Music is not available",
    );
    const dialog = renderDialog();
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(
      /Couldn't organize this source: .*not available/,
    );
    expect(within(dialog).queryByRole("button", { name: /Move/ })).toBeNull();
  });
});
