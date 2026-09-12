import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import composerAppHtmlPlugin, { APP_ENTRY_HTML_SRC, APP_ENTRY_MODULE, APP_HTML_PATH, rewriteAppEntry } from "../composer-app-html.mjs";
import { SITE_BUILD_ENTRY, appModuleId } from "../roots.mjs";

function middlewareOf(plugin: ReturnType<typeof composerAppHtmlPlugin>) {
  const stack: ((req: unknown, res: unknown, next: (error?: unknown) => void) => Promise<void>)[] = [];
  const server = {
    middlewares: { use: (handler: never) => stack.push(handler) },
    transformIndexHtml: vi.fn(async (_url: string, html: string) => `<!--transformed-->${html}`),
  };
  const configureServer = plugin.configureServer as (server: unknown) => () => void;
  configureServer(server)();
  return { handler: stack[0]!, server };
}

function fakeResponse() {
  return { statusCode: 0, headers: {} as Record<string, string>, body: undefined as string | undefined, setHeader(key: string, value: string) { this.headers[key] = value; }, end(body?: string) { this.body = body; } };
}

describe("rewriteAppEntry", () => {
  it("replaces the root-absolute entry with the package's own /@fs id", () => {
    expect(rewriteAppEntry(`<script type="module" src=${APP_ENTRY_HTML_SRC}></script>`)).toBe(
      `<script type="module" src=${JSON.stringify(appModuleId(APP_ENTRY_MODULE))}></script>`,
    );
  });

  it("fails loudly rather than serving a shell whose entry resolves against the host root", () => {
    expect(() => rewriteAppEntry("<html></html>")).toThrow(/no longer references/);
    expect(() => rewriteAppEntry(`<script src=${APP_ENTRY_HTML_SRC}></script><script src=${APP_ENTRY_HTML_SRC}></script>`)).toThrow(/exactly once/);
    expect(() => rewriteAppEntry(`<div data-entry=${APP_ENTRY_HTML_SRC}></div>`)).toThrow(/exactly once/);
  });

  it("can select the package-owned static visitor while preserving the single shell input", () => {
    expect(rewriteAppEntry(`<script type="module" src=${APP_ENTRY_HTML_SRC}></script>`, SITE_BUILD_ENTRY)).toBe(
      `<script type="module" src=${JSON.stringify(appModuleId(SITE_BUILD_ENTRY))}></script>`,
    );
  });

  it("matches the shipped index.html, so the rewrite cannot silently drift", async () => {
    expect(await readFile(APP_HTML_PATH, "utf8")).toContain(APP_ENTRY_HTML_SRC);
  });
});

describe("the shell middleware", () => {
  it("serves the package shell for an html navigation on any route", async () => {
    const { handler, server } = middlewareOf(composerAppHtmlPlugin());
    const response = fakeResponse();
    await handler({ method: "GET", url: "/content", originalUrl: "/content", headers: { accept: "text/html,*/*" } }, response, () => {
      throw new Error("must not fall through");
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("text/html");
    expect(server.transformIndexHtml).toHaveBeenCalledWith("/content", expect.stringContaining("/@fs"), "/content");
    expect(response.body).toContain("<!--transformed-->");
  });

  it("passes non-html and non-GET requests through, so asset and endpoint routes keep precedence", async () => {
    const { handler } = middlewareOf(composerAppHtmlPlugin());
    for (const req of [
      { method: "GET", url: "/main.js", headers: { accept: "*/*" } },
      { method: "POST", url: "/content", headers: { accept: "text/html" } },
      { method: "GET", url: "/content", headers: {} },
    ]) {
      const next = vi.fn();
      await handler(req, fakeResponse(), next);
      expect(next).toHaveBeenCalledOnce();
    }
  });

  it("hands a shell failure to the connect error path instead of writing a broken 200", async () => {
    const { handler, server } = middlewareOf(composerAppHtmlPlugin());
    server.transformIndexHtml.mockRejectedValueOnce(new Error("transform failed"));
    const next = vi.fn();
    const response = fakeResponse();
    await handler({ method: "GET", url: "/", originalUrl: "/", headers: { accept: "text/html" } }, response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "transform failed" }));
    expect(response.statusCode).toBe(0);
  });
});
