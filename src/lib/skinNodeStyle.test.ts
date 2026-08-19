import { describe, expect, it } from "vitest";
import { styleFromSkinNode } from "./skinNodeStyle";

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
      }),
    ).toEqual({
      color: "#469fe5",
      fontSize: "8px",
      fontWeight: "bold",
      textAlign: "center",
      backgroundColor: "#000000",
    });
  });

  it("keeps omitted fields off the inline object", () => {
    expect(styleFromSkinNode({ color: "#fff", fontSize: 11 })).toEqual({
      color: "#fff",
      fontSize: "11px",
    });
  });
});
