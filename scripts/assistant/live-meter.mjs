// @ts-check
// Loopback pass-through meter for the opt-in live Assistant lane. The authoring
// server's real Anthropic adapter talks to this proxy (assistant.baseUrl allows
// loopback http); every request is forwarded unchanged to the real Messages API
// and every response is streamed back unchanged. It never fabricates, edits or
// replays model output. It only:
//   - refuses a request before forwarding when its worst-case cost would exceed
//     the approved spend cap or request count (fail closed);
//   - records the request/response contract for evidence (model requested and
//     served, thinking/effort/fallback settings, beta header, tool names,
//     stop reason, content block types, fallback hops, usage).
// Request headers are never recorded: the credential passes through in memory only.
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { TextDecoder } from "node:util";

/** USD per million tokens (input, output). Unknown models are priced at the most expensive listed rate. */
export const PRICES = /** @type {const} */ ({
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  fallback: { input: 10, output: 50 },
});
/** @param {string | undefined} model */
const price = model => (model && model in PRICES ? PRICES[/** @type {keyof typeof PRICES} */ (model)] : PRICES.fallback);
/** Cache writes bill at 1.25x input, cache reads at 0.05x input. */
/** @param {Record<string, any> | undefined} usage @param {string | undefined} model */
export function costOf(usage, model) {
  if (!usage) return 0;
  const rate = price(model);
  const input = (usage.input_tokens ?? 0) + 1.25 * (usage.cache_creation_input_tokens ?? 0) + 0.05 * (usage.cache_read_input_tokens ?? 0);
  return (input * rate.input + (usage.output_tokens ?? 0) * rate.output) / 1_000_000;
}

/**
 * @param {{ upstream: string, maxUsd: number, maxRequests: number, captureInputs?: boolean, fetchImpl?: typeof fetch }} options
 * `captureInputs` also keeps the system prompt and the newest user turn's text; use it only with synthetic data.
 */
export async function startLiveMeter({ upstream, maxUsd, maxRequests, captureInputs = false, fetchImpl = fetch }) {
  const origin = new URL(upstream);
  if (origin.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(origin.hostname)) throw new Error("The live meter forwards only to https (or a loopback test upstream).");
  /** @type {any[]} */
  const records = [];
  let spent = 0, reserved = 0, forwarded = 0;
  // Settled requests add their measured cost (or the worst case when usage never arrived); in-flight ones hold a reservation.
  const settle = (/** @type {number} */ worst, /** @type {number} */ cost) => { reserved -= worst; spent += cost; };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    if (!req.url?.startsWith("/v1/messages") || req.method !== "POST") { res.statusCode = 404; res.end(); return; }
    /** @type {Record<string, any>} */
    let body;
    try { body = JSON.parse(raw.toString("utf8")); } catch { res.statusCode = 400; res.end(); return; }
    const requested = String(body.model ?? "");
    const system = typeof body.system === "string" ? body.system : JSON.stringify(body.system ?? "");
    const newest = Array.isArray(body.messages) ? body.messages.at(-1) : undefined;
    // Worst case: every byte of the prompt is a token, and the call uses its whole output allowance.
    const worst = (raw.length * price(requested).input + Number(body.max_tokens ?? 0) * Math.max(price(requested).output, PRICES.fallback.output)) / 1_000_000;
    const record = {
      at: new Date().toISOString(), requestedModel: requested, thinking: body.thinking, effort: body.output_config?.effort, fallbacks: body.fallbacks,
      beta: req.headers["anthropic-beta"], maxTokens: body.max_tokens, tools: (body.tools ?? []).map((/** @type {any} */ tool) => ({ name: tool.name, eager: tool.eager_input_streaming === true })),
      systemSha256: createHash("sha256").update(system).digest("hex"),
      ...(captureInputs ? { system, newestUserText: newest?.role === "user" ? (typeof newest.content === "string" ? newest.content : newest.content.filter((/** @type {any} */ block) => block.type === "text").map((/** @type {any} */ block) => block.text).join("\n")) : null } : {}),
      messages: Array.isArray(body.messages) ? body.messages.length : 0, promptBytes: raw.length,
      /** @type {string | null} */ refused: null, status: 0, servedModel: /** @type {string | null} */ (null), stopReason: /** @type {string | null} */ (null),
      blocks: /** @type {string[]} */ ([]), fallbackHops: /** @type {{ from: string, to: string }[]} */ ([]), usage: /** @type {any} */ (null), iterations: /** @type {any} */ (null), costUsd: 0, error: /** @type {string | null} */ (null),
    };
    records.push(record);
    if (forwarded >= maxRequests || spent + reserved + worst > maxUsd) {
      record.refused = forwarded >= maxRequests ? "request-limit" : "spend-cap";
      res.statusCode = 400; res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: `Live lane ${record.refused} reached; request not sent.` } }));
      return;
    }
    forwarded++; reserved += worst;
    /** @type {Record<string, string>} */
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string" && !["host", "connection", "content-length", "accept-encoding"].includes(key)) headers[key] = value;
    headers["accept-encoding"] = "identity";
    let upstreamResponse;
    try { upstreamResponse = await fetchImpl(new URL(req.url, origin), { method: "POST", headers, body: raw }); }
    catch (error) { record.error = error instanceof Error ? error.name : "fetch-failed"; settle(worst, worst); res.statusCode = 502; res.end(); return; }
    record.status = upstreamResponse.status;
    res.statusCode = upstreamResponse.status;
    for (const key of ["content-type", "request-id", "retry-after", "anthropic-ratelimit-requests-remaining"]) { const value = upstreamResponse.headers.get(key); if (value) res.setHeader(key, value); }
    if (!upstreamResponse.body) { settle(worst, worst); res.end(); return; }
    let buffer = "";
    const observe = (/** @type {string} */ text) => {
      buffer += text;
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const data = frame.split("\n").find(line => line.startsWith("data: "));
        if (!data) continue;
        let event; try { event = JSON.parse(data.slice(6)); } catch { continue; }
        if (event.type === "message_start") { record.servedModel = event.message?.model ?? null; record.usage = { ...event.message?.usage }; }
        else if (event.type === "content_block_start") {
          record.blocks.push(event.content_block?.type);
          if (event.content_block?.type === "fallback") { record.fallbackHops.push({ from: event.content_block.from?.model, to: event.content_block.to?.model }); record.servedModel = event.content_block.to?.model ?? record.servedModel; }
        } else if (event.type === "message_delta") {
          record.stopReason = event.delta?.stop_reason ?? null;
          record.usage = { ...record.usage, ...event.usage };
          if (event.usage?.iterations) record.iterations = event.usage.iterations;
        } else if (event.type === "error") record.error = event.error?.type ?? "stream-error";
      }
    };
    const decoder = new TextDecoder();
    const stream = Readable.fromWeb(/** @type {any} */ (upstreamResponse.body));
    stream.on("data", chunk => { observe(decoder.decode(chunk, { stream: true })); res.write(chunk); });
    let settled = false;
    stream.on("error", () => { record.error ??= "stream-aborted"; if (!settled) { settled = true; settle(worst, worst); } res.destroy(); });
    // A stopped reply may still be billed for what was generated; it keeps its worst-case charge.
    stream.on("close", () => { if (!settled) { settled = true; record.error ??= "client-closed"; settle(worst, worst); } });
    res.on("close", () => { if (!res.writableEnded) stream.destroy(); });
    stream.on("end", () => {
      if (!(upstreamResponse.headers.get("content-type") ?? "").includes("event-stream")) {
        try { const json = JSON.parse(buffer); if (json.type === "error") record.error = json.error?.type ?? "error"; else { record.servedModel = json.model; record.stopReason = json.stop_reason; record.usage = json.usage; record.blocks = (json.content ?? []).map((/** @type {any} */ block) => block.type); } } catch { /* not JSON */ }
      }
      record.costUsd = costOf(record.usage, record.servedModel ?? requested);
      if (!settled) { settled = true; settle(worst, record.usage ? record.costUsd : worst); }
      res.end();
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const address = /** @type {import("node:net").AddressInfo} */ (server.address());
  return {
    url: `http://127.0.0.1:${address.port}`,
    records: () => records,
    spent: () => spent,
    reserved: () => reserved,
    forwarded: () => forwarded,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve(undefined)); }),
  };
}
