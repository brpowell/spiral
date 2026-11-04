import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOnboardingStore } from "../store/useOnboardingStore";
import { useStartupCrashReport } from "./useStartupCrashReport";

vi.mock("../lib/crashReport", () => ({
  acknowledgeCrashReport: vi.fn(() => Promise.resolve()),
  listUnacknowledgedStartupRustCrashReports: vi.fn(() =>
    Promise.resolve([{ id: "crash-1" }]),
  ),
  readCrashReport: vi.fn(() => Promise.resolve({ id: "crash-1" })),
}));

describe("useStartupCrashReport", () => {
  afterEach(() => {
    useOnboardingStore.setState({ open: false });
  });

  it("opens once a crash report loads", async () => {
    useOnboardingStore.setState({ open: false });
    const { result } = renderHook(() => useStartupCrashReport());
    await waitFor(() => expect(result.current.open).toBe(true));
  });

  it("waits for onboarding to end", async () => {
    useOnboardingStore.setState({ open: true });
    const { result } = renderHook(() => useStartupCrashReport());
    await waitFor(() => expect(result.current.report).not.toBeNull());
    expect(result.current.open).toBe(false);

    act(() => useOnboardingStore.setState({ open: false }));
    expect(result.current.open).toBe(true);
  });
});
