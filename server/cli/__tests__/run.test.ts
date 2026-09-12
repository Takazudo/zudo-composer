import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { ASSETS_IMPORT_ENTRY_PATH, BUILD_SITE_ENTRY_PATH, RELEASE_ENTRY_PATH, CLOSE_GRACE_MS, USAGE, parseArguments, runComposerCli, superviseDevServer } from "../run.mjs";
import { forwardedSignals, superviseChild } from "../supervise.mjs";

function fakeProcess(platform = "linux") {
  const emitter = new EventEmitter();
  const out: string[] = [];
  const err: string[] = [];
  return {
    emitter,
    out,
    err,
    exits: [] as (number | undefined)[],
    kills: [] as [number, string][],
    platform,
    execPath: "/usr/bin/node",
    pid: 4242,
    exitCode: undefined as number | undefined,
    stdout: { write: (value: string) => out.push(value) },
    stderr: { write: (value: string) => err.push(value) },
    on: (signal: string, handler: () => void) => emitter.on(signal, handler),
    off: (signal: string, handler: () => void) => emitter.off(signal, handler),
    kill(pid: number, signal: string) {
      this.kills.push([pid, signal]);
    },
    exit(code?: number) {
      this.exits.push(code);
    },
  };
}

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> };
  child.kill = vi.fn();
  return child;
}

describe("parseArguments", () => {
  it("treats no arguments and every help spelling as the usage request", () => {
    for (const argv of [[], ["--help"], ["-h"], ["help"], ["dev", "--help"], ["build-site", "--help"], ["build-site", "-h"]]) {
      expect(parseArguments(argv)).toEqual({ command: "help" });
    }
  });

  it("reads build-site paths relative to the caller and allows verification with route printing", () => {
    expect(parseArguments(["build-site"])).toEqual({ command: "build-site", options: {} });
    expect(parseArguments(["build-site", "--root", "host/..", "--print-routes", "--verify", "artifact"]))
      .toEqual({ command: "build-site", options: { workspaceRoot: resolve("host/.."), printRoutes: true, verifyDirectory: resolve("artifact") } });
  });

  it("rejects build-site flags with missing paths, dev-only flags and positional arguments", () => {
    for (const argv of [["--root"], ["--root", "--print-routes"], ["--root", ""]]) {
      expect(parseArguments(["build-site", ...argv])).toEqual({ error: "--root requires a directory." });
    }
    for (const argv of [["--verify"], ["--verify", "--print-routes"], ["--verify", ""]]) {
      expect(parseArguments(["build-site", ...argv])).toEqual({ error: "--verify requires a directory." });
    }
    for (const argv of [["--source-revision"], ["--source-revision", "--print-routes"], ["--source-revision", ""], ["--source-revision", "  "]]) {
      expect(parseArguments(["build-site", ...argv])).toEqual({ error: "--source-revision requires a nonempty revision." });
    }
    for (const flag of ["--port", "--host", "--strict-port", "host-dir"]) {
      expect(parseArguments(["build-site", flag])).toEqual({ error: `Unknown build-site option "${flag}".` });
    }
  });

  it("preserves an explicit host revision verbatim and keeps the option scoped to build-site", () => {
    const sourceRevision = "release:2026-09-13/candidate-2";
    expect(parseArguments(["build-site", "--source-revision", sourceRevision])).toEqual({ command: "build-site", options: { sourceRevision } });
    expect(parseArguments(["dev", "--source-revision", sourceRevision])).toEqual({ error: 'Unknown dev option "--source-revision".' });
  });

  it("reads the dev options", () => {
    expect(parseArguments(["dev", "--port", "0", "--strict-port", "--host"])).toEqual({
      command: "dev",
      options: { port: 0, strictPort: true, host: true },
    });
    expect(parseArguments(["dev", "--host", "0.0.0.0", "--root", "/tmp/host"])).toEqual({
      command: "dev",
      options: { host: "0.0.0.0", workspaceRoot: "/tmp/host" },
    });
  });

  it("rejects unknown commands, unknown dev options and value-less flags", () => {
    expect(parseArguments(["build"])).toEqual({ error: 'Unknown command "build".' });
    expect(parseArguments(["dev", "--open"])).toEqual({ error: 'Unknown dev option "--open".' });
    expect(parseArguments(["dev", "--port"])).toEqual({ error: "--port requires a number." });
    expect(parseArguments(["dev", "--port", "--host"])).toEqual({ error: "--port requires a number." });
    expect(parseArguments(["dev", "--root"])).toEqual({ error: "--root requires a directory." });
  });

  it("forwards every argument after `release` untouched", () => {
    expect(parseArguments(["release", "--anything", "-h"])).toEqual({ command: "release", rest: ["--anything", "-h"] });
  });

  it("accepts a manifest relative to the host, or JSON stdin, with scoped asset options", () => {
    expect(parseArguments(["assets", "import"])).toEqual({ command: "assets-import", options: {} });
    expect(parseArguments(["assets", "import", "images-src/manifest.json", "--root", "host"]))
      .toEqual({ command: "assets-import", options: { manifest: "images-src/manifest.json", workspaceRoot: resolve("host") } });
    for (const argv of [["assets", "--help"], ["assets", "import", "-h"]]) expect(parseArguments(argv)).toEqual({ command: "help" });
    for (const argv of [["assets"], ["assets", "list"]]) expect(parseArguments(argv)).toEqual({ error: 'assets requires the "import" subcommand.' });
    expect(parseArguments(["assets", "import", "--root"])).toEqual({ error: "--root requires a directory." });
    expect(parseArguments(["assets", "import", "a.json", "b.json"])).toEqual({ error: "assets import accepts one manifest path." });
    expect(parseArguments(["assets", "import", "  "])).toEqual({ error: "assets import requires a nonempty manifest path." });
    expect(parseArguments(["assets", "import", "--verify"])).toEqual({ error: 'Unknown assets import option "--verify".' });
  });
});

describe("runComposerCli", () => {
  it("documents the build-site artifact modes in the exact usage text", () => {
    expect(USAGE).toBe(`Usage: zudo-composer <command> [options]

Commands:
  dev         Start the authoring dev server, rooted at the current project.
  release     Run the SiteProject release API (one JSON request on stdin, one
              canonical JSON response on stdout).
  build-site  Build and verify the host's static website in dist-site.
  assets import [manifest]
              Import a host asset manifest, or read { "manifest": "path" } on
              stdin; write one canonical JSON response on stdout.

dev options:
  --root <dir>     Host project root (default: the current directory).
  --port <number>  Port to listen on (0 picks a free one).
  --host [addr]    Expose the server; bare --host listens on all addresses.
  --strict-port    Fail instead of moving to the next free port.

build-site options:
  --root <dir>     Host project root (default: the current directory).
  --print-routes   Verify an existing artifact and print its routes as JSON.
  --verify <dir>   Verify this artifact instead of building (relative to cwd).
                  Combine with --print-routes to print this artifact's routes.
  --source-revision <revision>
                  Host revision to record or verify exactly (default: GITHUB_SHA
                  when nonempty; omitted otherwise).

assets import options:
  --root <dir>     Host project root (default: the current directory).
  <manifest>      JSON manifest path, relative to the host root or absolute.
                  Files are relative to the manifest directory. The resolved
                  host config selects the asset store; reruns preserve edits.
`);
  });

  it("prints usage on stdout, and usage plus the reason on stderr for a bad command", async () => {
    const help = fakeProcess();
    await runComposerCli([], { proc: help });
    expect(help.out.join("")).toBe(USAGE);
    expect(help.exitCode).toBeUndefined();

    const bad = fakeProcess();
    await runComposerCli(["build"], { proc: bad });
    expect(bad.err.join("")).toContain('Unknown command "build".');
    expect(bad.err.join("")).toContain(USAGE);
    expect(bad.exitCode).toBe(1);
  });

  it("spawns the release entry with this Node binary and forwards the remaining arguments", async () => {
    const proc = fakeProcess();
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    await runComposerCli(["release", "--flag"], { proc, spawn: spawn as never, exists: () => true });
    expect(spawn).toHaveBeenCalledWith("/usr/bin/node", [RELEASE_ENTRY_PATH, "--flag"], { stdio: "inherit" });
  });

  it("supervises the build-site child and passes normalized explicit paths", async () => {
    const proc = fakeProcess();
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const sourceRevision = "a".repeat(40);
    await runComposerCli(["build-site", "--root", "host", "--verify", "artifact", "--print-routes", "--source-revision", sourceRevision], { proc, spawn: spawn as never, exists: () => true });
    expect(spawn).toHaveBeenCalledWith("/usr/bin/node", [BUILD_SITE_ENTRY_PATH, "--root", resolve("host"), "--print-routes", "--verify", resolve("artifact"), "--source-revision", sourceRevision], { stdio: "inherit" });
    proc.emitter.emit("SIGTERM");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.emit("exit", 7, null);
    expect(proc.exits).toEqual([7]);
  });

  it("supervises asset import and preserves the manifest path for resolution by the host", async () => {
    const proc = fakeProcess();
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    await runComposerCli(["assets", "import", "images-src/manifest.json", "--root", "host"], { proc, spawn: spawn as never, exists: () => true });
    expect(spawn).toHaveBeenCalledWith("/usr/bin/node", [ASSETS_IMPORT_ENTRY_PATH, "images-src/manifest.json", "--root", resolve("host")], { stdio: "inherit" });
    proc.emitter.emit("SIGINT");
    expect(child.kill).toHaveBeenCalledWith("SIGINT");
    child.emit("exit", 2, null);
    expect(proc.exits).toEqual([2]);
  });

  it("inherits JSON stdin for assets import and fails a partial install before spawn", async () => {
    const proc = fakeProcess();
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    await runComposerCli(["assets", "import"], { proc, spawn: spawn as never, exists: () => true });
    expect(spawn).toHaveBeenCalledWith("/usr/bin/node", [ASSETS_IMPORT_ENTRY_PATH], { stdio: "inherit" });
    spawn.mockClear();
    await runComposerCli(["assets", "import"], { proc, spawn: spawn as never, exists: () => false });
    expect(spawn).not.toHaveBeenCalled();
    expect(proc.err.join("")).toContain(ASSETS_IMPORT_ENTRY_PATH);
    expect(proc.exits).toEqual([1]);
  });

  it("does not start a missing builder or spawn for an invalid build-site option", async () => {
    const proc = fakeProcess();
    const spawn = vi.fn();
    await runComposerCli(["build-site"], { proc, spawn: spawn as never, exists: () => false });
    expect(spawn).not.toHaveBeenCalled();
    expect(proc.err.join("")).toContain(BUILD_SITE_ENTRY_PATH);
    expect(proc.exits).toEqual([1]);
    const bad = fakeProcess();
    await runComposerCli(["build-site", "--verify"], { proc: bad, spawn: spawn as never });
    expect(spawn).not.toHaveBeenCalled();
    expect(bad.exitCode).toBe(1);
  });

  it("names the resolved absolute path when the package file is missing, and spawns nothing", async () => {
    const proc = fakeProcess();
    const spawn = vi.fn();
    await runComposerCli(["release"], { proc, spawn: spawn as never, exists: () => false });
    expect(spawn).not.toHaveBeenCalled();
    expect(proc.err.join("")).toContain(RELEASE_ENTRY_PATH);
    expect(proc.exits).toEqual([1]);
  });

  it("starts the dev server with the parsed options and supervises it", async () => {
    const proc = fakeProcess();
    const server = { close: vi.fn(async () => {}), printUrls: vi.fn() };
    const start = vi.fn(async () => ({ server }));
    await runComposerCli(["dev", "--port", "0"], { proc, start: start as never });
    expect(start).toHaveBeenCalledWith({ port: 0 });
    expect(server.printUrls).toHaveBeenCalled();

    proc.emitter.emit("SIGINT");
    await vi.waitFor(() => expect(proc.exits).toEqual([128 + 2]));
    expect(server.close).toHaveBeenCalledTimes(1);
  });
});

describe("superviseDevServer", () => {
  it("closes once, even when the signal arrives repeatedly", async () => {
    const proc = fakeProcess();
    const server = { close: vi.fn(async () => {}) };
    superviseDevServer(server, proc);

    proc.emitter.emit("SIGTERM");
    proc.emitter.emit("SIGTERM");
    await vi.waitFor(() => expect(proc.exits.length).toBe(1));
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(proc.exits).toEqual([128 + 15]);
  });

  it("still exits when close rejects, so the port is never held by a stuck handler", async () => {
    const proc = fakeProcess();
    const server = { close: vi.fn(async () => { throw new Error("close failed"); }) };
    superviseDevServer(server, proc);

    proc.emitter.emit("SIGINT");
    await vi.waitFor(() => expect(proc.exits).toEqual([128 + 2]));
    expect(proc.err.join("")).toContain("close failed");
  });

  it("exits anyway when close never settles, so a stalled shutdown cannot hold the port", async () => {
    vi.useFakeTimers();
    try {
      const proc = fakeProcess();
      superviseDevServer({ close: () => new Promise<void>(() => {}) }, proc);
      proc.emitter.emit("SIGINT");
      await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS);
      expect(proc.exits).toEqual([128 + 2]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("superviseChild", () => {
  it("forwards SIGHUP only off Windows", () => {
    expect(forwardedSignals("darwin")).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
    expect(forwardedSignals("win32")).toEqual(["SIGINT", "SIGTERM"]);
  });

  it("forwards each terminating signal to the child", () => {
    const proc = fakeProcess("darwin");
    const child = fakeChild();
    superviseChild(child as never, { label: "the API", entryPath: "/pkg/entry.mjs", proc: proc as never });
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) proc.emitter.emit(signal);
    expect(child.kill.mock.calls.flat()).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
  });

  it("re-raises the child's terminating signal on itself rather than reporting a plain exit code", () => {
    const proc = fakeProcess();
    const child = fakeChild();
    superviseChild(child as never, { label: "the API", entryPath: "/pkg/entry.mjs", proc: proc as never, signalNumbers: { SIGTERM: 15 } });
    child.emit("exit", null, "SIGTERM");
    expect(proc.kills).toEqual([[4242, "SIGTERM"]]);
    expect(proc.exits).toEqual([128 + 15]);
    // The forwarder must be gone before the re-raise, or it would swallow it.
    expect(proc.emitter.listenerCount("SIGTERM")).toBe(0);
  });

  it("passes a clean exit code through", () => {
    const proc = fakeProcess();
    const child = fakeChild();
    superviseChild(child as never, { label: "the API", entryPath: "/pkg/entry.mjs", proc: proc as never });
    child.emit("exit", 3, null);
    expect(proc.exits).toEqual([3]);
  });

  it("surfaces a spawn failure with the resolved path", () => {
    const proc = fakeProcess();
    const child = fakeChild();
    superviseChild(child as never, { label: "the API", entryPath: "/pkg/entry.mjs", proc: proc as never });
    child.emit("error", new Error("EACCES"));
    expect(proc.err.join("")).toContain("/pkg/entry.mjs");
    expect(proc.err.join("")).toContain("failed to start the API");
    expect(proc.exits).toEqual([1]);
  });
});
