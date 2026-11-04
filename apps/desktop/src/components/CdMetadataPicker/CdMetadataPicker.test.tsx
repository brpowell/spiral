import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCdStore } from "../../store/useCdStore";
import { useOnboardingStore } from "../../store/useOnboardingStore";
import type { DiscMetadata } from "../../types/cd";
import { CdMetadataPicker } from "./CdMetadataPicker";

const release = (album: string) =>
  ({ album, artist: "Artist", tracks: [] }) as unknown as DiscMetadata;

describe("CdMetadataPicker", () => {
  beforeEach(() => {
    useCdStore.setState({
      metadataPickDriveId: "disk4",
      metadataCandidatesByDriveId: {
        disk4: [release("First"), release("Second")],
      },
    });
  });

  afterEach(() => {
    useCdStore.setState({
      metadataPickDriveId: null,
      metadataCandidatesByDriveId: {},
    });
    useOnboardingStore.setState({ open: false });
  });

  it("waits for onboarding to end before asking", () => {
    useOnboardingStore.setState({ open: true });
    render(<CdMetadataPicker />);
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => useOnboardingStore.setState({ open: false }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
