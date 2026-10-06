import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeAudioContext {
  state = "suspended";
  destination = { name: "dest" };
  readonly sources: FakeSource[] = [];
  resume = vi.fn(async () => {
    this.state = "running";
  });
  decodeAudioData = vi.fn(async () => ({ id: `buf-${this.sources.length}` }));
  createBufferSource = vi.fn(() => {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  });
}

let context: FakeAudioContext;

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

describe("playOneShot", () => {
  beforeEach(() => {
    vi.resetModules();
    context = new FakeAudioContext();
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          return context;
        }
      },
    );
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

  it("decodes once, resumes the context, and starts the clip", async () => {
    const { playOneShot } = await loadPlayer();

    playOneShot("asset://click.wav");
    await settle();

    expect(context.resume).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    expect(context.decodeAudioData).toHaveBeenCalledOnce();
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.start).toHaveBeenCalledWith(0);
    expect(context.sources[0]?.connect).toHaveBeenCalledWith(
      context.destination,
    );
  });

  it("restarts the same URL and leaves a different URL playing", async () => {
    const { playOneShot } = await loadPlayer();

    playOneShot("asset://click.wav");
    playOneShot("asset://other.wav");
    await settle();

    const [click, other] = context.sources;
    expect(click?.stop).not.toHaveBeenCalled();
    expect(other?.stop).not.toHaveBeenCalled();

    playOneShot("asset://click.wav");
    await settle();

    expect(click?.stop).toHaveBeenCalledOnce();
    expect(click?.disconnect).toHaveBeenCalledOnce();
    expect(other?.stop).not.toHaveBeenCalled();
    expect(context.sources).toHaveLength(3);
    expect(context.sources[2]?.start).toHaveBeenCalledWith(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("shares one fetch when the same URL is played before decode finishes", async () => {
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

    expect(context.decodeAudioData).toHaveBeenCalledOnce();
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.start).toHaveBeenCalledWith(0);
  });

  it("logs a failed load and retries on the next play", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(wavResponse(404));
    const { playOneShot } = await loadPlayer();

    playOneShot("asset://missing.wav");
    await settle();

    expect(console.error).toHaveBeenCalled();
    expect(context.createBufferSource).not.toHaveBeenCalled();

    playOneShot("asset://missing.wav");
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.start).toHaveBeenCalledWith(0);
  });
});
