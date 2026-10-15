import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function wavResponse(status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  } as Response;
}

async function loadPlayer() {
  return import("./sfxPlayer");
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function commandsNamed(name: string): unknown[][] {
  return invoke.mock.calls.filter((call) => call[0] === name);
}

describe("playOneShot", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => wavResponse()),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches the clip once, hands the bytes to Rust, then plays it", async () => {
    const { playOneShot } = await loadPlayer();

    playOneShot("asset://click.wav");
    await settle();

    expect(fetch).toHaveBeenCalledOnce();
    const [load] = commandsNamed("load_sfx");
    expect(load![1]).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(load![2]).toEqual({ headers: { "x-sfx-id": "1" } });
    expect(commandsNamed("play_sfx")).toEqual([["play_sfx", { id: 1 }]]);
  });

  it("plays a loaded clip again without fetching", async () => {
    const { playOneShot } = await loadPlayer();

    playOneShot("asset://click.wav");
    await settle();
    playOneShot("asset://click.wav");

    expect(fetch).toHaveBeenCalledOnce();
    expect(commandsNamed("load_sfx")).toHaveLength(1);
    expect(commandsNamed("play_sfx")).toHaveLength(2);
  });

  it("gives each URL its own id", async () => {
    const { playOneShot } = await loadPlayer();

    playOneShot("asset://click.wav");
    playOneShot("asset://other.wav");
    await settle();

    expect(
      commandsNamed("play_sfx").map((c) => (c[1] as { id: number }).id),
    ).toEqual([1, 2]);
  });

  it("shares one fetch when the same URL is played before the load finishes", async () => {
    let release: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    const { playOneShot } = await loadPlayer();

    playOneShot("asset://click.wav");
    playOneShot("asset://click.wav");
    expect(fetch).toHaveBeenCalledOnce();

    release(wavResponse());
    await settle();

    expect(commandsNamed("load_sfx")).toHaveLength(1);
    // Only the latest request plays once the shared load lands.
    expect(commandsNamed("play_sfx")).toHaveLength(1);
  });

  it("logs a failed fetch and retries on the next play", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(wavResponse(404));
    const { playOneShot } = await loadPlayer();

    playOneShot("asset://missing.wav");
    await settle();

    expect(console.error).toHaveBeenCalled();
    expect(commandsNamed("play_sfx")).toHaveLength(0);

    playOneShot("asset://missing.wav");
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(commandsNamed("play_sfx")).toHaveLength(1);
  });

  it("does not play a clip Rust refused to decode, and retries later", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "load_sfx") throw new Error("not a RIFF/WAVE file");
    });
    const { playOneShot } = await loadPlayer();

    playOneShot("asset://bad.wav");
    await settle();

    expect(console.error).toHaveBeenCalled();
    expect(commandsNamed("play_sfx")).toHaveLength(0);

    playOneShot("asset://bad.wav");
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("logs when Rust cannot play a clip", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "play_sfx") throw new Error("Sound was not loaded");
    });
    const { playOneShot } = await loadPlayer();

    playOneShot("asset://click.wav");
    await settle();

    expect(console.error).toHaveBeenCalledWith(
      "Failed to play sound:",
      expect.any(Error),
    );
  });
});
