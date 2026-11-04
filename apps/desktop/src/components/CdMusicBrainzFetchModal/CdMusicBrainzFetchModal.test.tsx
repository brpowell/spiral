import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCdStore } from "../../store/useCdStore";
import { useOnboardingStore } from "../../store/useOnboardingStore";
import { CdMusicBrainzFetchModal } from "./CdMusicBrainzFetchModal";

describe("CdMusicBrainzFetchModal", () => {
  beforeEach(() => {
    useCdStore.setState({ metadataFetchPromptDriveId: "disk4" });
  });

  afterEach(() => {
    useCdStore.setState({ metadataFetchPromptDriveId: null });
    useOnboardingStore.setState({ open: false });
  });

  it("asks right away outside onboarding", () => {
    useOnboardingStore.setState({ open: false });
    render(<CdMusicBrainzFetchModal />);
    expect(screen.getByText("Fetch CD metadata")).toBeInTheDocument();
  });

  it("waits for onboarding to end before asking", () => {
    useOnboardingStore.setState({ open: true });
    render(<CdMusicBrainzFetchModal />);
    expect(screen.queryByText("Fetch CD metadata")).toBeNull();
    expect(useCdStore.getState().metadataFetchPromptDriveId).toBe("disk4");

    act(() => useOnboardingStore.setState({ open: false }));
    expect(screen.getByText("Fetch CD metadata")).toBeInTheDocument();
  });
});
