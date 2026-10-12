import { readExactlyOneJson } from "./json-io";
import { createEditingService } from "../edit/service";
import type { CaptureHostOptions } from "../edit/inspect";
export async function runEdit(options: CaptureHostOptions, command: string, input: NodeJS.ReadableStream = process.stdin) {
  const service = createEditingService(options);
  if (!["inspect", "resolve", "plan", "review", "apply", "receipt", "discard", "supersede", "undo"].includes(command)) throw Object.assign(new Error("Unknown edit command. Use inspect, resolve, plan, review, apply, receipt, discard, supersede or undo."), { code: "invalid-request" });
  const request = await readExactlyOneJson(input);
  return service[command as keyof typeof service](request);
}
