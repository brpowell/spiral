import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTagWriteWarningDismissed } from "../lib/tagWriteWarningPreferences";
import { useTagWriteWarning } from "./useTagWriteWarning";

function Harness({ action }: { action: () => void }) {
  const { requestTagWrite, tagWriteDialog } = useTagWriteWarning();
  return (
    <>
      <button onClick={() => requestTagWrite(action)}>save</button>
      {tagWriteDialog}
    </>
  );
}

describe("useTagWriteWarning", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the warning and runs the action only after confirming", async () => {
    const action = vi.fn();
    render(<Harness action={action} />);

    fireEvent.click(screen.getByText("save"));
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByText(/backup/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(isTagWriteWarningDismissed()).toBe(false);
  });

  it("does not run the action when cancelled", async () => {
    const action = vi.fn();
    render(<Harness action={action} />);

    fireEvent.click(screen.getByText("save"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(action).not.toHaveBeenCalled();
  });

  it("remembers the dismissal and skips the dialog afterwards", async () => {
    const action = vi.fn();
    render(<Harness action={action} />);

    fireEvent.click(screen.getByText("save"));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(isTagWriteWarningDismissed()).toBe(true);

    fireEvent.click(screen.getByText("save"));
    expect(action).toHaveBeenCalledTimes(2);
  });
});
