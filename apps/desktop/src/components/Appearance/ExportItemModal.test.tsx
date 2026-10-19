import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode, Ref } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetDefaults, mockExport } = vi.hoisted(() => ({
  mockGetDefaults: vi.fn(),
  mockExport: vi.fn(),
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({
      children,
      ref,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: {
      children?: ReactNode;
      ref?: Ref<HTMLDivElement>;
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    } & React.HTMLAttributes<HTMLDivElement>) => (
      <div ref={ref} {...props}>
        {children}
      </div>
    ),
  },
}));
vi.mock("../../lib/tauri", () => ({
  getItemExportDefaults: mockGetDefaults,
}));
vi.mock("../../lib/items/itemActions", () => ({
  exportItemWithToast: mockExport,
}));

import { ExportItemModal } from "./ExportItemModal";

const DEFAULTS = {
  effectiveId: "bryan.theme.mine",
  itemType: "theme",
  publisherId: "bryan",
  name: "Mine",
  version: "1.0.0",
  description: "My theme",
};

function renderModal(onClose = vi.fn()) {
  render(<ExportItemModal open itemId="bryan.theme.mine" onClose={onClose} />);
  return onClose;
}

describe("ExportItemModal", () => {
  beforeEach(() => {
    mockGetDefaults.mockReset();
    mockExport.mockReset();
    mockGetDefaults.mockResolvedValue(DEFAULTS);
  });

  it("prefills name, version and description from the item and exports them", async () => {
    mockExport.mockResolvedValue({ path: "/x.spk", version: "1.0.0" });
    const onClose = renderModal();

    await waitFor(() =>
      expect(screen.getByDisplayValue("Mine")).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue("1.0.0")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("1.0.0"), {
      target: { value: " 1.2.0 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockExport).toHaveBeenCalledWith("bryan.theme.mine", {
      name: "Mine",
      version: "1.2.0",
      description: "My theme",
    });
  });

  it("blocks export until the version is valid semver", async () => {
    renderModal();
    await waitFor(() =>
      expect(screen.getByDisplayValue("1.0.0")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByDisplayValue("1.0.0"), {
      target: { value: "one" },
    });
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();

    fireEvent.change(screen.getByDisplayValue("one"), {
      target: { value: "2.0.0" },
    });
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
  });

  it("stays open when the save dialog is cancelled", async () => {
    mockExport.mockResolvedValue(null);
    const onClose = renderModal();
    await waitFor(() =>
      expect(screen.getByDisplayValue("Mine")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(mockExport).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows an error and no form when the item can't be read", async () => {
    mockGetDefaults.mockRejectedValue(new Error("gone"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderModal();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });
});
