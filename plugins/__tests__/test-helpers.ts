import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { PassThrough } from "node:stream";
import { vi } from "vitest";

/** Tests provide only used properties; unexpected access fails instead of lying silently. */
export function strictFixture<T extends object>(members: Partial<T>): T {
  return new Proxy(members, {
    get(target, key, receiver) {
      if (!(key in target)) throw new Error(`Unexpected fixture property: ${String(key)}`);
      return Reflect.get(target, key, receiver);
    },
  }) as T;
}

/** Vite hooks support both function and { handler } forms. */
export function hookHandler<T extends (...args: never[]) => unknown>(hook: T | { handler: T } | undefined): T {
  if (!hook) throw new Error("Expected plugin hook to be registered");
  return typeof hook === "function" ? hook : hook.handler;
}

export function httpRequest(chunks: readonly Uint8Array[] = []): IncomingMessage {
  const request = new IncomingMessage(new Socket());
  request.complete = true;
  let started = false;
  request._read = () => {
    if (started) return;
    started = true;
    let index = 0;
    const next = () => {
      request.push(chunks[index++] ?? null);
      if (index <= chunks.length) setImmediate(next);
    };
    // IncomingMessage normally receives bytes from its HTTP parser, not from
    // repeated _read calls. Simulate that parser feeding separate network turns.
    setImmediate(next);
  };
  return request;
}

/** Real ServerResponse with a memory sink, avoiding a listening socket. */
export function httpResponse() {
  const response = Object.assign(new ServerResponse(httpRequest()), { body: new PassThrough(), headers: {} as Record<string, string> });
  const setHeader = response.setHeader.bind(response);
  const setHeaderSpy = vi.spyOn(response, "setHeader").mockImplementation((name, value) => {
    response.headers[name] = String(value);
    return setHeader(name, value);
  });
  vi.spyOn(response, "write").mockImplementation((chunk) => response.body.write(chunk));
  const end = vi.spyOn(response, "end").mockImplementation((chunk?: unknown) => {
    response.body.end(typeof chunk === "function" ? undefined : chunk);
    Object.defineProperty(response, "writableEnded", { configurable: true, value: true });
    response.emit("finish");
    return response;
  });
  return Object.assign(response, { setHeader: setHeaderSpy, end });
}
