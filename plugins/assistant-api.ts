import type { IncomingMessage, ServerResponse } from "node:http";
import type { ViteDevServer } from "vite";
import { z } from "zod";
import { trustedReleaseRequest } from "./release-api-plugin";
import { readBody } from "./file-provider-http.mjs";
import type { createEditingService } from "../server/edit/service";
import type { HostCapture } from "../server/edit/inspect";
import type { AssistantConfig } from "../server/config/assistant";
import type { AssistantStore, RunEvent } from "../server/assistant/store";
import type { AssistantRunner } from "../server/assistant/runner";

type Service = ReturnType<typeof createEditingService>;
interface Coordinator { run<T>(id: string, action: () => Promise<T>, mutates?: boolean): Promise<T> }
const name = z.string().min(1).max(256);
const command = z.object({ operation: z.string().regex(/^[a-z][a-zA-Z]{1,40}$/), workspaceId: name, input: z.record(z.string(), z.unknown()).default({}) }).strict();
const safeCodes = new Set(["approval-denied", "approval-mismatch", "authoring-busy", "browser-dirty", "browser-unavailable", "busy", "component-invalid", "conflict", "draft-full", "empty-draft", "inactive-draft", "invalid-asset", "invalid-payload", "invalid-request", "invalid-table", "limit", "memory-change-invalid", "memory-conflict", "memory-fenced", "memory-oversized", "missing-credential", "not-applied", "not-configured", "not-found", "run-inactive", "stale-asset", "stale-browser", "stale-draft", "stale-plan", "store-corrupt", "tampered-plan", "undo-conflict", "unrequested-content", "unsupported-capability", "unsupported-scope", "unsupported-target", "wrong-workspace", "commit-uncertain", "write-failed"]);
// Approval-bearing operations: explicit user action, approval capability and full browser coordination.
const approvals = new Set(["applyDraft", "undoDraft"]);

/**
 * Local operator channel for the AI Assistant. Same loopback/capability/bound
 * tab checks as native editing. No generic method dispatch: every operation is
 * named below and validated by its owner.
 */
export function installAssistantApi(server: ViteDevServer, deps: {
  service: Service; store: AssistantStore; runner: AssistantRunner; config: AssistantConfig; lease: { execute<T>(action: () => Promise<T>): Promise<T> };
  coordinator: Coordinator; capability: string; approvalCapability: string; peers: Map<string, unknown>; capture(): Promise<HostCapture>;
}) {
  const endpoint = "/__zudo-assistant";
  let requests = 0, streams = 0;
  const scopeOf = async (workspaceId: string) => {
    const capture = await deps.capture();
    if (capture.workspaceId !== workspaceId) throw Object.assign(new Error("Select this site's workspace first."), { code: "wrong-workspace" });
    const { realpath } = await import("node:fs/promises");
    return { host: await realpath(capture.config.workspaceRoot), workspaceId };
  };
  const draftOps = deps.service.drafts;
  const operations: Record<string, (workspaceId: string, input: Record<string, unknown>, clientId: string) => Promise<unknown>> = {
    status: async workspaceId => deps.runner.status(workspaceId),
    conversations: async workspaceId => deps.store.conversations(await scopeOf(workspaceId)),
    conversation: async (workspaceId, input) => deps.store.conversation(await scopeOf(workspaceId), name.parse(input.conversationId)),
    createConversation: async workspaceId => deps.store.createConversation(await scopeOf(workspaceId)),
    start: async (workspaceId, input) => deps.runner.start(workspaceId, input),
    stop: async (workspaceId, input) => deps.runner.stop(workspaceId, name.parse(input.runId)),
    run: async (workspaceId, input) => deps.runner.run(workspaceId, name.parse(input.runId)),
    rename: async (workspaceId, input) => ({ botName: await deps.store.rename(await scopeOf(workspaceId), z.string().max(40).nullable().parse(input.botName)) }),
    memory: async workspaceId => (await deps.store.settings(await scopeOf(workspaceId))).memory,
    saveMemory: async (workspaceId, input) => deps.store.saveMemory(await scopeOf(workspaceId), z.object({ body: z.string().max(100_000), expectedRevision: z.number().int().nonnegative() }).strict().parse(input)),
    clearMemory: async (workspaceId, input) => deps.store.clearMemory(await scopeOf(workspaceId), z.object({ expectedRevision: z.number().int().nonnegative() }).strict().parse(input)),
    restoreMemory: async (workspaceId, input) => deps.store.restoreMemory(await scopeOf(workspaceId), z.object({ revision: z.number().int().positive(), expectedRevision: z.number().int().nonnegative() }).strict().parse(input)),
    setMemoryMode: async (workspaceId, input) => deps.store.setMemoryMode(await scopeOf(workspaceId), z.object({ mode: z.enum(["off", "read-only", "auto"]), expectedModeRevision: z.number().int().nonnegative() }).strict().parse(input)),
    acceptMemoryProposal: async (workspaceId, input) => deps.store.acceptMemoryProposal(await scopeOf(workspaceId), z.object({ conversationId: name, proposalId: name, expectedRevision: z.number().int().nonnegative() }).strict().parse(input)),
    rejectMemoryProposal: async (workspaceId, input) => deps.store.rejectMemoryProposal(await scopeOf(workspaceId), z.object({ conversationId: name, proposalId: name }).strict().parse(input)),
    putPayload: async (workspaceId, input) => {
      const payload = z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("text"), text: z.string().min(1).max(100_000) }).strict(),
        z.object({ kind: z.literal("table"), columns: z.array(z.string().max(10_000)).min(1).max(100), rows: z.array(z.array(z.string().max(10_000))).min(1).max(1000) }).strict().refine(value => value.rows.every(row => row.length === value.columns.length), "Each row needs one cell per column."),
        z.object({ kind: z.literal("image"), assetId: name, alt: z.string().max(10_000) }).strict(),
      ]).parse(input.payload);
      return deps.store.putPayload(await scopeOf(workspaceId), { ...payload, conversationId: null });
    },
    draft: async workspaceId => draftOps.draft({ workspaceId }),
    receipt: async (workspaceId, input) => draftOps.receipt({ workspaceId, draftId: input.draftId }),
    withdraw: async (workspaceId, input) => deps.lease.execute(() => draftOps.withdraw({ workspaceId, ...input })),
    discard: async (workspaceId, input) => deps.lease.execute(() => draftOps.discard({ workspaceId, ...input })),
    revalidate: async (workspaceId, input) => deps.lease.execute(() => draftOps.revalidate({ workspaceId, ...input })),
    /** Stages offered wording as an exact operator-authored field update. */
    stageSuggestion: async (workspaceId, input) => {
      const request = z.object({ conversationId: name, suggestionId: name, generation: z.number().int().nonnegative(), draftId: name.nullable() }).strict().parse(input);
      const scope = await scopeOf(workspaceId);
      const conversation = await deps.store.conversation(scope, request.conversationId);
      const suggestion = conversation.messages.flatMap(message => message.suggestions ?? []).find(candidate => candidate.id === request.suggestionId);
      if (!suggestion?.target) throw Object.assign(new Error("This wording has no target field; copy it instead."), { code: "unsupported-target" });
      const result = await deps.lease.execute(() => draftOps.propose({ workspaceId, expected: { generation: request.generation, draftId: request.draftId }, provenance: { actor: "operator", conversationId: conversation.id }, operations: [{ kind: "updateField", page: suggestion.target!.page, nodeId: suggestion.target!.nodeId, prop: suggestion.target!.prop, value: suggestion.text, reason: "Staged from offered wording" }] }));
      await deps.store.updateMessage(scope, conversation.id, conversation.messages.find(message => message.suggestions?.some(candidate => candidate.id === suggestion.id))!.id, message => { message.suggestions = message.suggestions!.map(candidate => candidate.id === suggestion.id ? { ...candidate, status: "staged" } : candidate); });
      return result;
    },
    applyDraft: async (workspaceId, input, clientId) => deps.coordinator.run(clientId, () => deps.lease.execute(() => draftOps.apply({ workspaceId, ...input })), true),
    undoDraft: async (workspaceId, input, clientId) => deps.coordinator.run(clientId, () => deps.lease.execute(() => draftOps.undo({ workspaceId, ...input })), true),
  };
  const respond = (res: ServerResponse, status: number, value: unknown) => {
    if (res.destroyed || res.writableEnded) return;
    res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(value));
  };
  const failure = (error: unknown) => {
    const code = error instanceof z.ZodError ? "invalid-request" : error && typeof error === "object" && "code" in error && typeof error.code === "string" && safeCodes.has(error.code) ? error.code : "failed";
    // Messages from owners are written for operators and carry no host paths; unknown failures stay generic.
    const message = code === "failed" ? "The Assistant could not complete this operation. Your input is retained; retry or reload." : code === "invalid-request" ? "The request was not valid." : error instanceof Error ? error.message : "Refused.";
    return { ok: false, error: { code, message } };
  };
  server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url !== endpoint) return next();
    if (!trustedReleaseRequest(req, !!server.config.server.https) || req.method !== "POST" || req.headers["x-zudo-native-capability"] !== deps.capability || req.headers["content-type"] !== "application/json") return respond(res, 403, { ok: false, error: { code: "operator-required", message: "Direct loopback operator channel required." } });
    const clientId = req.headers["x-zudo-native-client"];
    if (typeof clientId !== "string" || !deps.peers.has(clientId)) return respond(res, 403, { ok: false, error: { code: "operator-required", message: "Connected authoring session required." } });
    let parsed: z.infer<typeof command>;
    try { parsed = command.parse(JSON.parse(String(await readBody(req, 512 * 1024)))); } catch (error) { return respond(res, 400, failure(error)); }
    if (parsed.operation === "events") {
      if (streams >= 8) return respond(res, 429, { ok: false, error: { code: "busy", message: "Too many open Assistant streams." } });
      streams++;
      let unsubscribe = () => {};
      res.once("close", () => { streams--; unsubscribe(); });
      const close = () => { if (!res.writableEnded) res.end(); };
      try {
        const input = z.object({ runId: name, afterSeq: z.number().int().min(0) }).strict().parse(parsed.input);
        res.statusCode = 200; res.setHeader("Content-Type", "application/x-ndjson"); res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
        unsubscribe = await deps.runner.subscribe(parsed.workspaceId, input.runId, input.afterSeq, (event: RunEvent) => {
          if (res.writableEnded) return;
          if (event.seq === -1) { close(); return; }
          res.write(`${JSON.stringify(event)}\n`);
        });
        if (res.writableEnded) unsubscribe();
      } catch (error) { if (!res.headersSent) respond(res, 409, failure(error)); else close(); }
      return;
    }
    const operation = Object.hasOwn(operations, parsed.operation) ? operations[parsed.operation] : undefined;
    if (!operation) return respond(res, 404, { ok: false, error: { code: "invalid-request", message: "Unknown Assistant operation." } });
    if (approvals.has(parsed.operation) && req.headers["x-zudo-native-approval"] !== deps.approvalCapability) return respond(res, 403, { ok: false, error: { code: "approval-required", message: "Explicit operator approval required." } });
    if (requests >= 8) return respond(res, 429, { ok: false, error: { code: "busy", message: "Assistant request capacity exhausted." } });
    requests++;
    try { respond(res, 200, { ok: true, result: await operation(parsed.workspaceId, parsed.input, clientId) }); }
    catch (error) { respond(res, 409, failure(error)); }
    finally { requests--; }
  });
  return { endpoint, model: deps.config.model };
}
