import { describe, expect, it } from "vitest";
import {
  cssColorToRgb,
  fieldBackingSize,
  restingNoteAlpha,
  seedNotes,
  stepNotes,
  type FieldPointer,
  type Note,
  type NoteKind,
} from "./notesField";

function noteAt(x: number, y: number, kind: NoteKind = "quarter"): Note {
  return {
    x,
    y,
    homeX: x,
    homeY: y,
    vx: 0,
    vy: 0,
    angle: 0,
    homeAngle: 0,
    va: 0,
    scale: 1,
    kind,
    stir: 0,
  };
}

describe("notesField", () => {
  it("converts oklch theme colors to ink instead of treating hue as blue", () => {
    const gray = cssColorToRgb("oklch(0.72 0.01 250)", [0, 0, 0]);
    expect(gray[2]).toBeLessThan(220);
    expect(Math.abs(gray[0] - gray[1])).toBeLessThan(20);
    expect(Math.abs(gray[1] - gray[2])).toBeLessThan(20);
    expect(gray[0]).toBeGreaterThan(140);

    const red = cssColorToRgb("oklch(0.628 0.258 29.23)", [0, 0, 0]);
    expect(red[0]).toBeGreaterThan(200);
    expect(red[1]).toBeLessThan(80);
    expect(red[2]).toBeLessThan(80);

    const missingHue = cssColorToRgb("oklch(0.68 0.012 none)", [0, 0, 0]);
    expect(missingHue[0]).toBeGreaterThan(140);
    expect(Math.abs(missingHue[0] - missingHue[2])).toBeLessThan(20);

    expect(cssColorToRgb("rgb(200, 180, 160)", [0, 0, 0])).toEqual([
      200, 180, 160,
    ]);
  });

  it("keeps resting notes quieter on light themes", () => {
    expect(restingNoteAlpha("light")).toBeLessThan(restingNoteAlpha("dark"));
    expect(restingNoteAlpha("dark")).toBe(0.1);
    expect(restingNoteAlpha(undefined)).toBe(0.1);
  });

  it("grows the bitmap with devicePixelRatio and keeps the draw scale in step", () => {
    const css = { width: 800, height: 600 };
    const low = fieldBackingSize(css.width, css.height, 1);
    const retina = fieldBackingSize(css.width, css.height, 2);

    expect(low).toEqual({ width: 800, height: 600, scale: 1 });
    expect(retina).toEqual({ width: 1600, height: 1200, scale: 2 });
    expect(retina.width / css.width).toBe(retina.scale);
    expect(retina.height / css.height).toBe(retina.scale);
  });

  it("tiles the note wallpaper across the view", () => {
    const notes = seedNotes(480, 480);
    expect(notes.length).toBeGreaterThan(8);
    const kinds = new Set(notes.map((note) => note.kind));
    expect(kinds.has("beamed")).toBe(true);
    expect(kinds.has("eighth")).toBe(true);
    expect(kinds.has("quarter")).toBe(true);
  });

  it("lets a moving pointer push a nearby note aside", () => {
    const near = noteAt(200, 100);
    const far = noteAt(20, 420, "eighth");
    const pointer: FieldPointer = {
      x: 170,
      y: 100,
      dx: 28,
      dy: 0,
      inside: true,
    };

    stepNotes([near, far], pointer, 16);

    expect(near.x).toBeGreaterThan(200);
    expect(near.stir).toBeGreaterThan(0);
    expect(Math.hypot(far.vx, far.vy)).toBeLessThan(0.01);
    expect(far.x).toBeCloseTo(20, 1);
  });

  it("leaves notes in place while the pointer is still", () => {
    const note = noteAt(200, 100);
    stepNotes([note], { x: 190, y: 100, dx: 0, dy: 0, inside: true }, 16);
    expect(note.x).toBeCloseTo(200, 4);
    expect(note.y).toBeCloseTo(100, 4);
  });

  it("settles a displaced note back toward home", () => {
    const note = noteAt(200, 100);
    note.x = 248;
    note.vx = 6;
    const idle: FieldPointer = { x: 0, y: 0, dx: 0, dy: 0, inside: false };

    for (let i = 0; i < 900; i++) stepNotes([note], idle, 16);

    expect(note.x).toBeCloseTo(note.homeX, 0);
    expect(note.y).toBeCloseTo(note.homeY, 0);
    expect(Math.hypot(note.vx, note.vy)).toBeLessThan(0.05);
  });
});
