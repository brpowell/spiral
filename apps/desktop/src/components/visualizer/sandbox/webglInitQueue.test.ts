import { describe, expect, it } from "vitest";
import { queueWebglInit } from "./webglInitQueue";

function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("queueWebglInit", () => {
  it("runs one init at a time, in order", async () => {
    const started: string[] = [];
    const a = deferred();
    const b = deferred();

    const first = queueWebglInit(async () => {
      started.push("a");
      await a.promise;
      return "a";
    });
    const second = queueWebglInit(async () => {
      started.push("b");
      await b.promise;
      return "b";
    });

    await flush();
    expect(started).toEqual(["a"]);

    a.resolve();
    await expect(first).resolves.toBe("a");
    await flush();
    expect(started).toEqual(["a", "b"]);

    b.resolve();
    await expect(second).resolves.toBe("b");
  });

  it("starts the next init after one fails", async () => {
    const failing = queueWebglInit(() =>
      Promise.reject(new Error("init exceeded budget")),
    );
    const next = queueWebglInit(() => Promise.resolve("next"));

    await expect(failing).rejects.toThrow("init exceeded budget");
    await expect(next).resolves.toBe("next");
  });
});
