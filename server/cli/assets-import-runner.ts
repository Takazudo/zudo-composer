import type { JsonValue } from "@zudo-composer/component-contract";
import { canonicalStringifyJson } from "../../src/site-project/model/canonical";
import type { AssetImportResponse } from "./assets-import-service";
import { readExactlyOneJson } from "./json-io";

export interface AssetImportCliIo {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

/** Exactly one JSON request and canonical response, with release's 0/2/1 exit convention. */
export async function runAssetImportCli(
  service: { handle(request: unknown): Promise<AssetImportResponse> },
  io: AssetImportCliIo,
): Promise<number> {
  let request: unknown;
  let response: AssetImportResponse;
  try { request = await readExactlyOneJson(io.stdin); }
  catch (error) {
    response = { ok: false, error: { code: "malformed-request", message: error instanceof Error ? error.message : "Request stdin is not valid JSON." } };
    io.stdout.write(canonicalStringifyJson(response as unknown as JsonValue));
    return 2;
  }
  try { response = await service.handle(request); }
  catch (error) {
    io.stderr.write(`Assets import internal failure: ${error instanceof Error ? error.message : "unknown error"}\n`);
    response = { ok: false, error: { code: "internal", message: "The Assets import failed unexpectedly." } };
  }
  io.stdout.write(canonicalStringifyJson(response as unknown as JsonValue));
  if (response.ok) return 0;
  return ["malformed-request", "validation", "not-found", "conflict"].includes(response.error.code) ? 2 : 1;
}
