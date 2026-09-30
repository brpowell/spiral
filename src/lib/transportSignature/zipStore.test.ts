import { describe, expect, it } from "vitest";
import { crc32, zipStored } from "./zipStore";

describe("zipStored", () => {
  it("uses the standard CRC and stores each file uncompressed", () => {
    const payload = new TextEncoder().encode("123456789");
    expect(crc32(payload)).toBe(0xcbf43926);

    const zip = zipStored([
      { name: "play.wav", data: payload },
      { name: "next.wav", data: new Uint8Array([1, 2, 3]) },
    ]);
    expect(String.fromCharCode(zip[0], zip[1], zip[2], zip[3])).toBe(
      "PK\u0003\u0004",
    );
    const text = new TextDecoder().decode(zip);
    expect(text).toContain("play.wav");
    expect(text).toContain("next.wav");
    expect(text).toContain("123456789");
    const end = zip.length - 22;
    expect(zip[end]).toBe(0x50);
    expect(zip[end + 1]).toBe(0x4b);
    expect(zip[end + 2]).toBe(0x05);
    expect(zip[end + 3]).toBe(0x06);
  });
});
