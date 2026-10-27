import { describe, expect, it, vi } from "vitest";
import { createSseParser, watchEvents } from "./sse";

describe("createSseParser", () => {
  it("emits one event per blank line, across chunk boundaries", () => {
    const seen: string[] = [];
    const feed = createSseParser((d) => seen.push(d));
    feed('data: {"a"');
    feed(":1}\n");
    expect(seen).toEqual([]);
    feed("\ndata: two\n\n");
    expect(seen).toEqual(['{"a":1}', "two"]);
  });

  it("joins multi-line data, skips comments and other fields, and takes CRLF", () => {
    const seen: string[] = [];
    const feed = createSseParser((d) => seen.push(d));
    feed(": keep-alive\r\n\r\nevent: x\r\nid: 7\r\ndata: a\r\ndata:b\r\n\r\n");
    expect(seen).toEqual(["a\nb"]);
  });
});

/** A fetch whose responses are streams the test writes to. */
function fakeServer() {
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const encoder = new TextEncoder();
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streams.push(controller);
        init?.signal?.addEventListener("abort", () => {
          try {
            controller.error(new Error("aborted"));
          } catch {}
        });
      },
    });
    return new Response(body, { status: 200 });
  });
  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    calls: () => fetch.mock.calls.length,
    send: (i: number, text: string) =>
      streams[i]!.enqueue(encoder.encode(text)),
    end: (i: number) => streams[i]!.close(),
  };
}

const until = async (check: () => boolean) => {
  await vi.waitFor(() => expect(check()).toBe(true), { timeout: 1000 });
};

describe("watchEvents", () => {
  it("delivers events and reconnects after the stream ends", async () => {
    const server = fakeServer();
    const seen: string[] = [];
    const watch = watchEvents({
      url: "/events",
      fetch: server.fetch,
      onData: (d) => seen.push(d),
      backoffMs: [5],
    });
    await until(() => server.calls() === 1);
    server.send(0, "data: one\n\n");
    await until(() => seen.length === 1);
    server.end(0);
    await until(() => server.calls() === 2);
    server.send(1, "data: two\n\n");
    await until(() => seen.length === 2);
    expect(seen).toEqual(["one", "two"]);
    watch.stop();
  });

  it("retries a failing fetch, and retryNow skips the wait", async () => {
    let attempts = 0;
    const fetch = (async () => {
      attempts += 1;
      throw new Error("offline");
    }) as unknown as typeof globalThis.fetch;
    const watch = watchEvents({
      url: "/events",
      fetch,
      onData: () => {},
      backoffMs: [60_000],
    });
    await until(() => attempts === 1);
    watch.retryNow();
    await until(() => attempts === 2);
    watch.stop();
  });

  it("gives up on a 404 and says so, since retrying can't help", async () => {
    let attempts = 0;
    const fetch = (async () => {
      attempts += 1;
      return new Response("{}", { status: 404 });
    }) as unknown as typeof globalThis.fetch;
    const onGone = vi.fn();
    watchEvents({
      url: "/events",
      fetch,
      onData: () => {},
      onGone,
      backoffMs: [1],
    });
    await until(() => onGone.mock.calls.length === 1);
    await new Promise((r) => setTimeout(r, 30));
    expect(attempts).toBe(1);
  });

  it("stops for good: aborts the open stream and never reconnects", async () => {
    const server = fakeServer();
    const watch = watchEvents({
      url: "/events",
      fetch: server.fetch,
      onData: () => {},
      backoffMs: [1],
    });
    await until(() => server.calls() === 1);
    watch.stop();
    await new Promise((r) => setTimeout(r, 30));
    expect(server.calls()).toBe(1);
  });
});
