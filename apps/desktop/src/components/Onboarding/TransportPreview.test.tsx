import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../../store/usePlayerStore";
import { TransportPreview } from "./TransportPreview";

const playTransportCue = vi.hoisted(() => vi.fn());
vi.mock("../../lib/transportCues", () => ({ playTransportCue }));

describe("TransportPreview", () => {
  beforeEach(() => {
    playTransportCue.mockClear();
  });

  it("shows the transport under its heading with every button enabled", () => {
    render(<TransportPreview />);
    expect(
      screen.getByRole("heading", { name: "Transport preview" }),
    ).toBeInTheDocument();
    for (const name of [
      "Turn shuffle on",
      "Previous track",
      "Play",
      "Next track",
      "Repeat off",
    ]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
  });

  it("reacts and plays a cue on each press", () => {
    render(<TransportPreview />);

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(playTransportCue).toHaveBeenLastCalledWith("play");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(playTransportCue).toHaveBeenLastCalledWith("control");

    fireEvent.click(screen.getByRole("button", { name: "Turn shuffle on" }));
    expect(
      screen.getByRole("button", { name: "Turn shuffle off" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Repeat off" }));
    expect(
      screen.getByRole("button", { name: "Repeat all" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Repeat all" }));
    expect(
      screen.getByRole("button", { name: "Repeat one" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next track" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous track" }));
    expect(playTransportCue).toHaveBeenCalledTimes(7);
  });

  it("never touches the real player", () => {
    const before = usePlayerStore.getState();
    render(<TransportPreview />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Next track" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn shuffle on" }));
    const after = usePlayerStore.getState();
    expect(after.playbackState).toBe(before.playbackState);
    expect(after.shuffle).toBe(before.shuffle);
    expect(after.currentTrackId).toBe(before.currentTrackId);
  });
});
