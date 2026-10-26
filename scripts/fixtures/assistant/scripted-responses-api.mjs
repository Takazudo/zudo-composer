// @ts-check
/**
 * Loopback scripted stand-in for the OpenAI Responses API, used only by the
 * opt-in Codex CLI harness. Every reply is scripted by the harness; nothing
 * here contacts a model. It records each request it receives (with the
 * Authorization header reduced to "matches the dummy key or not") so the
 * harness can prove every model request reached this server.
 */
import { createServer } from "node:http";

/** @typedef {{ status?: number, events?: object[], body?: unknown, hang?: boolean, headers?: Record<string, string> }} ScriptedResponse */
/** @typedef {{ method: string, path: string, authMatchesDummy: boolean, body: any }} RecordedRequest */

/** @param {object[]} events */
export function sse(events) {
  return events.map(event => `event: ${/** @type {any} */ (event).type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

export const responseEvents = {
  created: (/** @type {string} */ id) => ({ type: "response.created", response: { id } }),
  completed: (/** @type {string} */ id) => ({ type: "response.completed", response: { id, usage: { input_tokens: 10, input_tokens_details: null, output_tokens: 5, output_tokens_details: null, total_tokens: 15 } } }),
  message: (/** @type {string} */ id, /** @type {string} */ text) => ({ type: "response.output_item.done", item: { type: "message", role: "assistant", id, content: [{ type: "output_text", text }] } }),
  functionCall: (/** @type {string} */ callId, /** @type {string} */ name, /** @type {string} */ args) => ({ type: "response.output_item.done", item: { type: "function_call", call_id: callId, name, arguments: args } }),
  customToolCall: (/** @type {string} */ callId, /** @type {string} */ name, /** @type {string} */ input) => ({ type: "response.output_item.done", item: { type: "custom_tool_call", call_id: callId, name, input } }),
  reasoning: (/** @type {string} */ id, /** @type {string} */ summary) => ({ type: "response.output_item.done", item: { type: "reasoning", id, summary: [{ type: "summary_text", text: summary }] } }),
};

/**
 * @param {{ dummyKey: string, respond: (request: RecordedRequest, index: number) => ScriptedResponse }} options
 */
export async function startScriptedResponsesApi({ dummyKey, respond }) {
  /** @type {RecordedRequest[]} */
  const requests = [];
  /** @type {Set<import("node:http").ServerResponse>} */
  const open = new Set();
  let modelCalls = 0;
  const server = createServer((req, res) => {
    const chunks = /** @type {Buffer[]} */ ([]);
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      let body;
      try { body = raw.length ? JSON.parse(raw.toString("utf8")) : null; } catch { body = { unparsed: true, bytes: raw.length }; }
      const path = (req.url ?? "").split("?")[0];
      const recorded = { method: req.method ?? "", path, authMatchesDummy: req.headers.authorization === `Bearer ${dummyKey}`, body };
      requests.push(recorded);
      if (req.method === "GET" && /\/models$/.test(path)) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ models: [] }));
        return;
      }
      if (req.method !== "POST" || !/\/responses$/.test(path)) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "not scripted" } }));
        return;
      }
      const scripted = respond(recorded, modelCalls++);
      if (scripted.hang) {
        open.add(res);
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(sse([responseEvents.created("resp_hang")]));
        res.on("close", () => open.delete(res));
        return;
      }
      if (scripted.events) {
        res.writeHead(scripted.status ?? 200, { "content-type": "text/event-stream", ...scripted.headers });
        res.end(sse(scripted.events));
        return;
      }
      res.writeHead(scripted.status ?? 500, { "content-type": "application/json", ...scripted.headers });
      res.end(JSON.stringify(scripted.body ?? { error: { message: "scripted error" } }));
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const address = /** @type {import("node:net").AddressInfo} */ (server.address());
  return {
    port: address.port,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    get modelCalls() { return modelCalls; },
    async close() {
      for (const res of open) res.destroy();
      server.closeAllConnections();
      await new Promise(resolve => server.close(() => resolve(undefined)));
    },
  };
}
