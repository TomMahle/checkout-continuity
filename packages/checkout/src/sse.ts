/*
 * Server-sent events over `fetch`, the same on every surface. React Native
 * has no EventSource, but a fetch whose body streams (`expo/fetch` there, the
 * browser's own on the web) is all SSE needs. The server only sends `data:`
 * lines and `:` comments (see /api/sessions/[id]/events), so the parser is
 * small. Unlike EventSource nothing reconnects for us, so `watchEvents` does.
 */

/**
 * Feed it text as it arrives; it calls `onData` once per complete event.
 * Handles `\n` and `\r\n` line endings (not a lone `\r`), multi-line data,
 * and comments. Other fields (`event:`, `id:`, `retry:`) are ignored.
 */
export function createSseParser(onData: (data: string) => void) {
  let buffer = "";
  let data: string[] = [];
  return (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line === "") {
        if (data.length > 0) onData(data.join("\n"));
        data = [];
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).replace(/^ /, ""));
      }
    }
  };
}

export interface WatchOptions {
  url: string;
  /** Must stream `response.body`. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  onData: (data: string) => void;
  /**
   * The server answered 404: what's being watched no longer exists (a
   * restarted demo server forgets every session). Watching stops for good.
   */
  onGone?: () => void;
  /** Waits before each reconnect; the last one repeats. Reset by a connect. */
  backoffMs?: number[];
}

export interface Watch {
  stop(): void;
  /** Skips the current backoff wait (say, the app came back to the foreground). */
  retryNow(): void;
}

const DEFAULT_BACKOFF_MS = [1000, 2000, 5000, 10_000];

/**
 * Keeps a stream open until stopped, reconnecting when it ends or fails,
 * except after a 404, which no retry will fix.
 */
export function watchEvents(options: WatchOptions): Watch {
  const doFetch = options.fetch ?? ((...args) => fetch(...args));
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  let stopped = false;
  let failures = 0;
  let abort: AbortController | null = null;
  let wake: (() => void) | null = null;

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      wake = done;
    });

  async function connect() {
    abort = new AbortController();
    const response = await doFetch(options.url, {
      headers: { accept: "text/event-stream" },
      signal: abort.signal,
    });
    if (response.status === 404) {
      stopped = true;
      options.onGone?.();
      return;
    }
    if (!response.ok || !response.body) {
      throw new Error(`Event stream failed: ${response.status}`);
    }
    failures = 0;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const feed = createSseParser(options.onData);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      feed(decoder.decode(value, { stream: true }));
    }
  }

  void (async () => {
    while (!stopped) {
      try {
        await connect();
      } catch {
        // Network error, server restart, abort: all mean "try again later".
      }
      if (stopped) return;
      await wait(backoff[Math.min(failures, backoff.length - 1)]!);
      failures += 1;
    }
  })();

  return {
    stop() {
      stopped = true;
      abort?.abort();
      wake?.();
    },
    retryNow() {
      wake?.();
    },
  };
}
