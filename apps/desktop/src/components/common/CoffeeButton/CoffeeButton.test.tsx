import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BUY_ME_A_COFFEE_URL } from "@/components/About/aboutContent";
import { CoffeeButton } from "./CoffeeButton";

const openUrl = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

describe("CoffeeButton", () => {
  it("opens the Buy Me a Coffee page", () => {
    render(<CoffeeButton />);
    fireEvent.click(screen.getByRole("button", { name: "Buy me a coffee" }));
    expect(openUrl).toHaveBeenCalledWith(BUY_ME_A_COFFEE_URL);
  });

  it("passes size and class through", () => {
    render(<CoffeeButton size="sm" className="extra" />);
    const button = screen.getByRole("button", { name: "Buy me a coffee" });
    expect(button.className).toContain("btn--sm");
    expect(button.className).toContain("extra");
  });
});
