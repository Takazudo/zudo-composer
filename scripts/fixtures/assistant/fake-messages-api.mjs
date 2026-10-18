// @ts-check
// Test-only scripted Anthropic Messages API (SSE) on loopback. It lets browser
// proofs drive the real Assistant adapter and SDK without live inference.
// Evidence produced through it is fake-provider evidence, never live-model proof.
import { createServer } from "node:http";

/** @typedef {{ text?: string, tools?: { name: string, input: unknown | ((request: any) => unknown) }[], status?: number, error?: string, delayMs?: number, holdUntilAbort?: boolean }} Turn */

/** @param {{ port?: number }} [options] */
export async function startFakeMessagesApi(options = {}) {
  /** @type {Turn[]} */
  const queue = [];
  /** @type {{ system: string, messages: unknown[], tools: string[], at: string }[]} */
  const requests = [];
  let sequence = 0;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (req.url === "/__script" && req.method === "POST") { queue.push(...JSON.parse(raw)); res.end("{}"); return; }
    if (req.url === "/__requests") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(requests)); return; }
    if (!req.url?.startsWith("/v1/messages") || req.method !== "POST") { res.statusCode = 404; res.end(); return; }
    if (req.headers["x-api-key"] !== "test-key") { res.statusCode = 401; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } })); return; }
    const body = JSON.parse(raw);
    requests.push({ system: typeof body.system === "string" ? body.system : JSON.stringify(body.system), messages: body.messages, tools: (body.tools ?? []).map((/** @type {{name: string}} */ tool) => tool.name), at: new Date().toISOString() });
    const turn = queue.shift() ?? { text: "(no scripted reply)" };
    if (turn.status) { res.statusCode = turn.status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ type: "error", error: { type: turn.status === 429 ? "rate_limit_error" : "api_error", message: turn.error ?? "scripted failure" } })); return; }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const send = (/** @type {string} */ event, /** @type {unknown} */ data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const id = `msg_fake_${++sequence}`;
    send("message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    if (turn.holdUntilAbort) { await new Promise(resolve => req.on("close", resolve)); return; }
    let index = 0;
    if (turn.text) {
      send("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
      for (const piece of turn.text.match(/.{1,12}/gsu) ?? []) {
        send("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: piece } });
        if (turn.delayMs) await new Promise(resolve => setTimeout(resolve, turn.delayMs));
      }
      send("content_block_stop", { type: "content_block_stop", index }); index++;
    }
    for (const [offset, tool] of (turn.tools ?? []).entries()) {
      send("content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: `toolu_fake_${sequence}_${offset}`, name: tool.name, input: {} } });
      const input = typeof tool.input === "function" ? tool.input(body) : tool.input;
      send("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } });
      send("content_block_stop", { type: "content_block_stop", index }); index++;
    }
    send("message_delta", { type: "message_delta", delta: { stop_reason: turn.tools?.length ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 10 } });
    send("message_stop", { type: "message_stop" });
    res.end();
  });
  await new Promise(resolve => server.listen(options.port ?? 0, "127.0.0.1", () => resolve(undefined)));
  const address = /** @type {import("node:net").AddressInfo} */ (server.address());
  return {
    url: `http://127.0.0.1:${address.port}`,
    /** @param {Turn[]} turns */
    script: (turns) => { queue.push(...turns); },
    requests: () => requests,
    pending: () => queue.length,
    close: () => new Promise(resolve => server.close(() => resolve(undefined))),
  };
}
