import { watch } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { ViteDevServer, WebSocketClient } from "vite";
import { z } from "zod";
import { trustedReleaseRequest } from "./release-api-plugin";
import { appModuleId } from "./roots.mjs";
import { readBody, isSameOriginDevRequest } from "./file-provider-http.mjs";
import { createBrowserCoordinator } from "../server/edit/browser-coordinator.mjs";
import { loadHostContext } from "../server/host-context.mjs";
import { editDigest, createEditingService, type EditPlan, type EditReceipt } from "../server/edit/service";

const command = z.object({ operation: z.enum(["inspect", "resolve", "plan", "review", "apply", "receipt", "discard", "supersede", "undo"]), input: z.unknown(), expected: z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/), identity: z.object({ workspaceId: z.string(), sitemapId: z.string(), pageId: z.string(), providerId: z.literal("files"), recordId: z.string() }).strict() }).strict().optional() }).strict();
const bindSchema = z.object({ clientId: z.uuid(), capability: z.string(), epoch: z.number().int().nonnegative().nullable() }).strict();
const answerSchema = z.object({ clientId: z.uuid(), challenge: z.uuid(), epoch: z.number().int().nonnegative(), clean: z.boolean() }).strict();
const unbindSchema = z.object({ clientId: z.uuid(), capability: z.string() }).strict();
const browserErrorCodes = new Set(["already-applied", "approval-mismatch", "authoring-busy", "browser-dirty", "browser-unavailable", "stale-browser", "component-invalid", "conflict", "effect-invalid", "inactive-plan", "invalid-asset", "invalid-request", "invalid-table", "not-applied", "not-found", "stale-asset", "stale-config", "stale-plan", "tampered-plan", "undo-conflict", "unsupported-capability", "unsupported-scope", "unsupported-source", "unsupported-target", "wrong-host", "wrong-target", "wrong-workspace", "commit-uncertain", "write-failed", "read-failed", "unavailable", "blocked"]);
const planProjection = (plan: EditPlan) => ({ id: plan.id, digest: plan.digest, request: plan.request, identity: plan.identity, before: plan.before, candidate: plan.candidate, dependencyDigest: editDigest(plan.revisions), createdAt: plan.createdAt });
const receiptProjection = (receipt: EditReceipt | null) => receipt && ({ schemaVersion: receipt.schemaVersion, operationId: receipt.operationId, planId: receipt.planId, reviewDigest: receipt.reviewDigest, kind: receipt.kind, identity: receipt.identity, beforeDigest: receipt.beforeDigest, afterDigest: receipt.afterDigest, committedAt: receipt.committedAt });

/** Finite local operator adapter. No release operations or source text escape. */
export async function installNativeEditApi(server: ViteDevServer, lease: { execute<T>(action: () => Promise<T>): Promise<T> }, workspaceRoot: string) {
  const watchers: ReturnType<typeof watch>[] = [];
  let watching = false;
  const capability = randomBytes(32).toString("hex");
  const approvalCapability = randomBytes(32).toString("hex");
  const coordinator = createBrowserCoordinator();
  const context = await loadHostContext({ workspaceRoot });
  const watchDrafts = () => {
    if (watching) return;
    watching = true;
    const paths = context.composerConfig.paths;
    for (const root of [join(paths.data, "workspaces"), paths.compositions, paths.content, paths.mappings, paths.sitemaps, paths.assets]) {
      try {
        const watcher = watch(root, { recursive: true }, (_, name) => { if (name === null || !String(name).endsWith(".lock")) server.ws.send("native:invalidated", {}); });
        watcher.on("error", () => server.ws.send("native:invalidated", {})); watchers.push(watcher);
      } catch { server.ws.send("native:invalidated", {}); }
    }
  };
  const module = await server.ssrLoadModule(appModuleId("server/edit/service.ts"));
  const service = module.createEditingService({ config: context.composerConfig, pack: context.pack, packIdentity: context.packIdentity }) as ReturnType<typeof createEditingService>;
  await service.initializeSourceEpoch();
  const assistantConfig = context.composerConfig.assistant;
  let assistant: { endpoint: string; name: string } | undefined;
  let assistantRunner: { stopAll(): Promise<void> } | undefined;
  for (const event of ["add", "change", "unlink"] as const) server.watcher.on(event, () => server.ws.send("native:invalidated", {}));
  const peers = new Map<string, { client: WebSocketClient; send(data: unknown): void; resume(data: unknown): void; close(): void }>();
  let activeRequests = 0;
  const trusted = new WeakSet<object>();
  server.ws.on("connection", (socket, request) => { if (isSameOriginDevRequest({ headers: { ...Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? undefined : value])), "sec-fetch-site": "same-origin" }, protocol: server.config.server.https ? "https" : "http" })) trusted.add(socket); });
  server.ws.on("native:bind", (data, client) => {
    const parsed = bindSchema.safeParse(data);
    if (!parsed.success || parsed.data.capability !== capability || !trusted.has(client.socket)) return;
    const { clientId } = parsed.data;
    if (peers.has(clientId)) return;
    const peer = { client, send: (value: unknown) => client.send("native:challenge", value), resume: (value: unknown) => client.send("native:resume", value), close: () => { coordinator.disconnect(clientId, peer); if (peers.get(clientId) === peer) peers.delete(clientId); } };
    try {
      const epoch = coordinator.bind(clientId, peer, parsed.data.epoch); peers.set(clientId, peer);
      client.socket.once("close", peer.close);
      client.send("native:bound", { clientId, epoch });
    } catch (error) { client.send("native:unavailable", { clientId, reason: error && typeof error === "object" && "code" in error ? error.code : "authoring-busy" }); }
  });
  server.ws.on("native:unbind", (data, client) => {
    const parsed = unbindSchema.safeParse(data);
    if (!parsed.success || parsed.data.capability !== capability || !trusted.has(client.socket)) return;
    const peer = peers.get(parsed.data.clientId);
    if (!peer || peer.client !== client) return;
    client.socket.off("close", peer.close); peer.close();
  });
  server.ws.on("native:answer", (data, client) => {
    const parsed = answerSchema.safeParse(data); if (!parsed.success) return;
    const peer = peers.get(parsed.data.clientId); if (peer?.client !== client) return;
    coordinator.answer(parsed.data.clientId, peer, parsed.data.challenge, parsed.data.epoch, parsed.data.clean);
  });
  if (assistantConfig) {
    const [storeModule, runnerModule, providerModule, apiModule, inspectModule] = await Promise.all([
      server.ssrLoadModule(appModuleId("server/assistant/store.ts")), server.ssrLoadModule(appModuleId("server/assistant/runner.ts")),
      server.ssrLoadModule(appModuleId("server/assistant/anthropic-provider.ts")), server.ssrLoadModule(appModuleId("plugins/assistant-api.ts")),
      server.ssrLoadModule(appModuleId("server/edit/inspect.ts")),
    ]);
    const capture = () => inspectModule.captureHost({ config: context.composerConfig, pack: context.pack, packIdentity: context.packIdentity });
    const store = await storeModule.openAssistantStore(context.composerConfig.paths.data);
    const runner = runnerModule.createAssistantRunner({ store, service, provider: providerModule.createAnthropicProvider(assistantConfig), config: assistantConfig, lease, capture, siteName: (state: { workspace: { metadata: { name: string } } }) => state.workspace.metadata.name });
    assistantRunner = runner;
    const installed = apiModule.installAssistantApi(server, { service, store, runner, config: assistantConfig, lease, coordinator, capability, approvalCapability, peers, capture });
    assistant = { endpoint: installed.endpoint, name: assistantConfig.name };
  }
  server.middlewares.use(async (req, res, next) => {
    if (req.url !== "/__zudo-native-edit") return next();
    const respond = (status: number, value: unknown) => { if (res.destroyed || res.writableEnded) return; res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(value)); };
    if (!trustedReleaseRequest(req, !!server.config.server.https) || req.method !== "POST" || req.headers["x-zudo-native-capability"] !== capability || req.headers["content-type"] !== "application/json") return respond(403, { ok: false, error: { code: "operator-required", message: "Direct loopback operator channel required." } });
    const clientId = req.headers["x-zudo-native-client"];
    if (typeof clientId !== "string" || !peers.has(clientId)) return respond(403, { ok: false, error: { code: "operator-required", message: "Connected authoring session required." } });
    if (activeRequests >= 4) return respond(429, { ok: false, error: { code: "authoring-busy", message: "Native request capacity exhausted." } });
    activeRequests++;
    const timer = setTimeout(() => req.destroy(), 5000);
    try {
      const request = command.parse(JSON.parse(await readBody(req, 256 * 1024) as string)); clearTimeout(timer);
      if (["apply", "undo"].includes(request.operation) && req.headers["x-zudo-native-approval"] !== approvalCapability) return respond(403, { ok: false, error: { code: "approval-required", message: "Explicit operator approval required." } });
      const execute = async () => {
        if (["plan", "resolve"].includes(request.operation)) {
          const input = request.input as { workspaceId: string; page: string; sitemapId?: string };
          const page = await service.inspect({ workspaceId: input.workspaceId, page: input.page, ...(input.sitemapId ? { sitemapId: input.sitemapId } : {}) });
          if (!request.expected || editDigest(page.record) !== request.expected.revision || editDigest(page.identity) !== editDigest(request.expected.identity)) throw Object.assign(new Error("Wrong target revision"), { code: "stale-plan" });
        }
        switch (request.operation) {
          case "plan": {
            const plan = await service.plan(request.input);
            const { page } = await service.inspectBrowserReview({ planId: plan.id });
            return { ...planProjection(plan), ...(page.linked ? { linked: page.linked } : {}) };
          }
          case "review": {
            const { plan, page } = await service.inspectBrowserReview(request.input);
            return { ...planProjection(plan), ...(page.linked ? { linked: page.linked } : {}) };
          }
          case "inspect": {
            const result = await service.inspect(request.input);
            watchDrafts();
            return { identity: result.identity, record: result.record, ...(result.linked ? { linked: result.linked } : {}), targets: result.targets.map(target => ({ nodeId: target.nodeId, kind: target.kind, componentId: target.componentId, ordinal: target.ordinal })), allTargets: result.allTargets, writeBlockers: result.writeBlockers, capabilities: result.capabilities, revision: editDigest(result.record) };
          }
          case "resolve": {
            const result = await service.resolve(request.input);
            return { identity: result.identity, target: result.target, writeBlockers: result.writeBlockers };
          }
          case "apply": return receiptProjection(await service.apply(request.input));
          case "undo": return receiptProjection(await service.undo(request.input));
          case "receipt": {
            const result = await service.receipt(request.input);
            return { applied: receiptProjection(result.applied), undone: receiptProjection(result.undone) };
          }
          case "discard": return service.discard(request.input);
          case "supersede": return service.supersede(request.input);
        }
      };
      const result = ["inspect", "review", "receipt"].includes(request.operation)
        ? await execute()
        : await coordinator.run(clientId, () => lease.execute(execute), ["apply", "undo"].includes(request.operation));
      respond(200, { ok: true, result });
    } catch (error) {
      const internalCode = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "invalid-request";
      const code = browserErrorCodes.has(internalCode) ? internalCode : "invalid-request";
      // Native/provider diagnostics may name absolute source paths. Project a safe operator message.
      const known = { "browser-dirty": "Save all authoring tabs and finish or cancel inline editing before retrying. Pending input is retained.", "stale-plan": "Draft or dependencies changed. Review a fresh plan; source changes require a process restart.", "undo-conflict": "A later edit changed this draft; undo cannot overwrite it.", "unsupported-scope": "This page is source-authored, mapped, shared or unsupported. Use Structure or its owning source.", "authoring-busy": "Another authoring operation is active.", "already-applied": "This operation committed. Recover its receipt; use guarded Undo.", "invalid-table": "Supply one cell per column in every row." };
      respond(409, { ok: false, error: { code, message: known[code as keyof typeof known] ?? "Native editing refused this operation. Inspect the page, retained plan and receipt before retrying; restart the server if source changed." } });
    } finally { clearTimeout(timer); activeRequests--; }
  });
  return {
    config: { endpoint: "/__zudo-native-edit", capability, approvalCapability, pack: { packId: context.pack.manifest.packId, packVersion: context.pack.manifest.packVersion }, ...(assistant ? { assistant } : {}) },
    isProvider: (req: { url?: string }) => /^\/__zudo_composer_[a-z_]*provider$/.test(req.url ?? "") || req.url === "/__zudo-release",
    provider: (req: { headers: Record<string, unknown> }, action: () => unknown) => coordinator.provider(String(req.headers["x-zudo-native-client"] ?? ""), Number(req.headers["x-zudo-native-epoch"]), action),
    close: () => { for (const watcher of watchers) watcher.close(); coordinator.close(); void assistantRunner?.stopAll(); },
    drain: () => coordinator.drain(),
  };
}
