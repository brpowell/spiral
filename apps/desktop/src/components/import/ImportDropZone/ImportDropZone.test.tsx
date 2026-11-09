import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import { ImportDropZone } from "./ImportDropZone";

vi.mock("@/lib/windows/windowRole", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/windows/windowRole")>()),
  isTauri: () => false,
}));
vi.mock("@/lib/import/dragDrop", () => ({
  isExternalFileDrag: () => true,
  pathsFromDataTransfer: () => ["/music/song.mp3"],
}));

const fileEvent = (type: string) => {
  const event = new Event(type, { cancelable: true });
  return Object.assign(event, { dataTransfer: {}, clientX: 0, clientY: 0 });
};

describe("ImportDropZone", () => {
  const importFromPaths = vi.fn();

  beforeEach(() => {
    importFromPaths.mockClear();
    usePlayerStore.setState({ importFromPaths });
  });

  afterEach(() => {
    useOnboardingStore.setState({ open: false });
  });

  it("imports dropped files", () => {
    useOnboardingStore.setState({ open: false });
    render(<ImportDropZone />);

    act(() => void window.dispatchEvent(fileEvent("dragenter")));
    expect(screen.getByText("Drop to import")).toBeInTheDocument();

    act(() => void window.dispatchEvent(fileEvent("drop")));
    expect(importFromPaths).toHaveBeenCalledWith(["/music/song.mp3"]);
  });

  it("ignores drops during onboarding", () => {
    useOnboardingStore.setState({ open: true });
    render(<ImportDropZone />);

    act(() => void window.dispatchEvent(fileEvent("dragenter")));
    expect(screen.queryByText("Drop to import")).toBeNull();

    act(() => void window.dispatchEvent(fileEvent("drop")));
    expect(importFromPaths).not.toHaveBeenCalled();
  });
});
