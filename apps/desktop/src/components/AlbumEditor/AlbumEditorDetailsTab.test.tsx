import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { AlbumEditorForm } from "../../lib/albumMetadata";
import { AlbumEditorDetailsTab } from "./AlbumEditorDetailsTab";

function Harness() {
  const [form, setForm] = useState<AlbumEditorForm>({
    title: "Album",
    artist: "",
    year: "",
    genre: "",
    releaseMbid: "",
  });
  return (
    <AlbumEditorDetailsTab
      form={form}
      tracks={[]}
      artistSuggestions={["Abba", "Beck"]}
      genreSuggestions={[]}
      onFieldChange={(field, value) =>
        setForm((prev) => ({ ...prev, [field]: value }))
      }
    />
  );
}

describe("AlbumEditorDetailsTab", () => {
  it("suggests known artists for the album artist field", () => {
    render(<Harness />);
    const artist = screen.getAllByRole("combobox")[0];
    act(() => artist.focus());
    fireEvent.change(artist, { target: { value: "Ab" } });
    expect(artist.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("option", { name: "Abba" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Beck" })).toBeNull();
  });
});
