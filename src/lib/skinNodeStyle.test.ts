import { describe, expect, it } from "vitest";
import { evaluateSkinCondition } from "./skinBinds";
import { resolveNodeStyle, styleFromSkinNode } from "./skinNodeStyle";
import { minimalBindState } from "../test/skinBindFixtures";

describe("styleFromSkinNode", () => {
  it("returns undefined when style is omitted", () => {
    expect(styleFromSkinNode(undefined)).toBeUndefined();
  });

  it("returns undefined when every field is omitted", () => {
    expect(styleFromSkinNode({})).toBeUndefined();
  });

  it("emits only declared fields as inline CSS", () => {
    expect(
      styleFromSkinNode({
        color: "#469fe5",
        fontSize: 8,
        fontWeight: "bold",
        textAlign: "center",
        backgroundColor: "#000000",
        opacity: 0.5,
      }),
    ).toEqual({
      color: "#469fe5",
      fontSize: "8px",
      fontWeight: "bold",
      textAlign: "center",
      backgroundColor: "#000000",
      opacity: 0.5,
    });
  });

  it("keeps omitted fields off the inline object", () => {
    expect(styleFromSkinNode({ color: "#fff", fontSize: 11 })).toEqual({
      color: "#fff",
      fontSize: "11px",
    });
  });

  it("omits opacity when SkinBounds owns it", () => {
    expect(
      styleFromSkinNode({ color: "#fff", opacity: 0 }, { omitOpacity: true }),
    ).toEqual({ color: "#fff" });
  });
});

describe("resolveNodeStyle", () => {
  it("keeps resting style when no styleWhen matches", () => {
    expect(
      resolveNodeStyle(
        { opacity: 0 },
        { "hover.visFrame": { opacity: 1 } },
        () => false,
      ),
    ).toEqual({ opacity: 0 });
  });

  it("applies the last matching styleWhen overlay", () => {
    expect(
      resolveNodeStyle(
        { opacity: 0, color: "#fff" },
        {
          "hover.visFrame": { opacity: 1 },
          "player.hasTrack": { color: "#0f0" },
        },
        (path) => path === "hover.visFrame" || path === "player.hasTrack",
      ),
    ).toEqual({ opacity: 1, color: "#0f0" });
  });

  it("applies an ordered list row whose when is a compound condition", () => {
    const styleWhen = [
      {
        when: {
          any: ["state.infoType.textExit", "state.galleryPhase.grid"],
        },
        opacity: 0.71,
      },
      {
        when: { all: ["state.galleryPhase.grid", "hover.thumb1"] },
        opacity: 1,
      },
    ];
    const resolve = (viewState: Record<string, string>, hovered: string[]) =>
      resolveNodeStyle({ opacity: 0 }, styleWhen, (condition) =>
        evaluateSkinCondition(
          condition,
          minimalBindState({
            viewState,
            hoveredNodeIds: new Set(hovered),
          }),
        ),
      );

    expect(resolve({ galleryPhase: "grid" }, [])).toEqual({ opacity: 0.71 });
    expect(resolve({ galleryPhase: "grid" }, ["thumb1"])).toEqual({
      opacity: 1,
    });
    expect(resolve({ galleryPhase: "magnified" }, ["thumb1"])).toEqual({
      opacity: 0,
    });
  });
});
