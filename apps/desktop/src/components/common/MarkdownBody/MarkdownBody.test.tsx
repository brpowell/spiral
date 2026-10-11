import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownBody } from "./MarkdownBody";

const mockOpenUrl = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: mockOpenUrl,
}));

describe("MarkdownBody", () => {
  it("opens http(s) links with openUrl instead of navigating the webview", () => {
    render(
      <MarkdownBody source="See [the notes](https://spiralpowered.com/notes)." />,
    );

    fireEvent.click(screen.getByRole("link", { name: "the notes" }));

    expect(mockOpenUrl).toHaveBeenCalledWith("https://spiralpowered.com/notes");
  });

  it("does not turn relative links into anchors", () => {
    render(<MarkdownBody source="See [this heading](#features)." />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("this heading")).toBeInTheDocument();
  });
});
