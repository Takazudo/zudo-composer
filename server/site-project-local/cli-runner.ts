import { canonicalStringifyJson } from "../../src/site-project/model/canonical";
import type { SiteProjectApiResponse, SiteProjectApiService } from "../../src/site-project/api/types";

export interface SiteProjectCliIo {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

const PROTOCOL_FAILURES = new Set([
  "malformed-request", "unsupported-protocol", "validation", "compile-blocked", "not-found", "conflict",
]);

function exitCode(response: SiteProjectApiResponse): number {
  if (response.ok) return 0;
  if (PROTOCOL_FAILURES.has(response.error.code)) return 2;
  return 1;
}

async function readExactlyOneJson(stream: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const bytesChunk = Buffer.from(chunk as string | Uint8Array);
    bytes += bytesChunk.byteLength;
    if (bytes > 8 * 1024 * 1024) throw new Error("Request exceeds the CLI input limit.");
    chunks.push(bytesChunk);
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  if (text.trim() === "") throw new Error("Request stdin is blank.");
  return JSON.parse(text) as unknown;
}

function malformed(message: string): SiteProjectApiResponse {
  return { ok: false, error: { code: "malformed-request", message } };
}

export async function runSiteProjectCli(service: SiteProjectApiService, io: SiteProjectCliIo): Promise<number> {
  let response: SiteProjectApiResponse;
  let request: unknown;
  try {
    request = await readExactlyOneJson(io.stdin);
  } catch (error) {
    response = malformed(error instanceof Error ? error.message : "Request stdin is not valid JSON.");
    io.stdout.write(canonicalStringifyJson(response as unknown as import("@zudo-composer/component-contract").JsonValue));
    return exitCode(response);
  }
  try {
    response = await service.handle(request);
  } catch {
    response = { ok: false, error: { code: "internal", message: "The SiteProject service failed unexpectedly." } };
  }
  io.stdout.write(canonicalStringifyJson(response as unknown as import("@zudo-composer/component-contract").JsonValue));
  return exitCode(response);
}
