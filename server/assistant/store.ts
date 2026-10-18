import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { SafeRootFilesystem, commitDocument, type DurableExtraErrorCode } from "../../src/shared/node-fs";

export class AssistantError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** Isolation boundary: one host installation (its real root) and one stable workspace record id. */
export interface AssistantScope { host: string; workspaceId: string }
export type MemoryMode = "off" | "read-only" | "auto";
export interface MemoryRevision {
  revision: number; body: string; actor: "human" | "assistant"; kind: "save" | "clear" | "restore" | "auto";
  createdAt: string; restoredFrom?: number; source?: { runId: string; turnId: string; key: string; change: MemoryChange };
}
export type MemoryChange = { kind: "append"; text: string } | { kind: "replace"; find: string; text: string };
export interface MemoryState { revision: number; body: string; mode: MemoryMode; modeRevision: number; clearGeneration: number; updatedAt: string | null }
export interface UsedMemory { status: "used" | "empty" | "off" | "unavailable"; revision: number | null; mode: MemoryMode; characters: number }
export interface MessageContext {
  page: { sitemapId: string; pageId: string; title?: string } | null;
  selection: { nodeId: string; componentId?: string; label?: string } | null;
  payloadIds: string[];
  instructions?: string;
}
export interface ChatMessage {
  id: string; role: "user" | "assistant"; text: string; createdAt: string; turnId: string; runId?: string;
  context?: MessageContext; memory?: UsedMemory;
  draft?: { draftId: string; operationIds: string[] } | null;
  memoryProposals?: MemoryProposal[]; remembered?: { revision: number }[]; suggestions?: Suggestion[];
  outcome?: "completed" | "stopped" | "failed" | "interrupted";
}
/** Proposed wording is advice: it changes nothing until the user stages it into the draft. */
export interface Suggestion { id: string; text: string; target: { page: { sitemapId: string; pageId: string }; nodeId: string; prop: string } | null; status: "offered" | "staged" }
export interface MemoryProposal { id: string; baseRevision: number; change: MemoryChange; status: "pending" | "accepted" | "rejected" | "stale"; resolvedRevision?: number }
export interface Conversation { schemaVersion: 1; id: string; scope: AssistantScope; title: string; createdAt: string; updatedAt: string; messages: ChatMessage[] }
export interface ConversationSummary { id: string; title: string; createdAt: string; updatedAt: string; messages: number; lastText: string }
export type RunStatus = "running" | "completed" | "stopped" | "failed" | "interrupted";
export interface RunEvent { seq: number; at: string; type: "status" | "text" | "tool" | "proposal" | "memory-proposal" | "remembered" | "clarification" | "error" | "done"; data: Record<string, unknown> }
export interface RunRecord {
  schemaVersion: 1; id: string; scope: AssistantScope; conversationId: string; turnId: string; status: RunStatus;
  startedAt: string; endedAt?: string; error?: { code: string; message: string }; events: RunEvent[];
  draft: { generation: number; draftId: string | null }; memory: UsedMemory | null; model: string;
}
export type ExactPayloadRecord = { id: string; conversationId: string | null; createdAt: string } & ({ kind: "text"; text: string } | { kind: "table"; columns: string[]; rows: string[][] } | { kind: "image"; assetId: string; alt: string });

export const MEMORY_MAX_CHARACTERS = 20_000;
const AUTO_CHANGE_MAX = 500;
const HISTORY_LIMIT = 100;
const MESSAGE_LIMIT = 500;
const CONVERSATION_LIMIT = 200;
interface SiteRecord { schemaVersion: 1; scope: AssistantScope; botName: string | null; memory: MemoryState; history: MemoryRevision[]; conversations: ConversationSummary[] }

const now = () => new Date().toISOString();
const sameScope = (a: AssistantScope, b: AssistantScope) => a.host === b.host && a.workspaceId === b.workspaceId;

/**
 * Private Assistant persistence. Each record is one whole-document atomic
 * commit under the host data root; nothing here is published, exported or
 * readable by visitor routes. The authoring server is the only writer.
 */
export async function openAssistantStore(dataRoot: string) {
  const fs = await SafeRootFilesystem.create<"assistant", DurableExtraErrorCode>({
    root: join(dataRoot, "assistant"), initializeOperation: "assistant", rootLabel: "Assistant data", ownerLabel: "Assistant data", recordLabel: "record",
    errors: {
      isError: value => value instanceof AssistantError,
      create: (_op, code, message) => new AssistantError(code, message),
      rethrow: (_op, code, message, cause): never => { if (cause instanceof AssistantError) throw cause; throw new AssistantError(code, message); },
    },
  });
  const key = (scope: AssistantScope) => createHash("sha256").update(`${scope.host}\0${scope.workspaceId}`).digest("hex").slice(0, 40);
  const id = (value: string, prefix: string) => {
    if (!new RegExp(`^${prefix}-[a-f0-9-]{36}$`).test(value)) throw new AssistantError("not-found", "Unknown Assistant record.");
    return value;
  };
  const path = (scope: AssistantScope, suffix: string) => fs.ownedPath(`site-${key(scope)}.${suffix}.json`);
  const read = async <T extends { schemaVersion: number; scope: AssistantScope }>(scope: AssistantScope, suffix: string): Promise<T | undefined> => {
    const file = await fs.readFileNoFollow("assistant", path(scope, suffix));
    if (!file) return undefined;
    let value: T;
    try { value = JSON.parse(file.text) as T; } catch { throw new AssistantError("store-corrupt", "Assistant data is unreadable. It was preserved; recover it explicitly."); }
    if (value?.schemaVersion !== 1) throw new AssistantError("store-corrupt", "Assistant data has an unknown schema version. It was preserved.");
    // Records never answer for another site even if a file were copied across.
    if (!value.scope || !sameScope(value.scope, scope)) throw new AssistantError("not-found", "Unknown Assistant record.");
    return value;
  };
  const write = (scope: AssistantScope, suffix: string, value: unknown) => commitDocument(fs, "assistant", path(scope, suffix), `${JSON.stringify(value)}\n`);
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(action: () => Promise<T>): Promise<T> => { const next = queue.then(action, action); queue = next.catch(() => {}); return next; };
  const site = async (scope: AssistantScope): Promise<SiteRecord> => await read<SiteRecord>(scope, "site") ?? {
    schemaVersion: 1, scope, botName: null, history: [], conversations: [],
    memory: { revision: 0, body: "", mode: "read-only", modeRevision: 0, clearGeneration: 0, updatedAt: null },
  };
  const pushRevision = (record: SiteRecord, entry: Omit<MemoryRevision, "revision" | "createdAt">): MemoryRevision => {
    const revision: MemoryRevision = { ...entry, revision: record.memory.revision + 1, createdAt: now() };
    record.memory = { ...record.memory, revision: revision.revision, body: revision.body, updatedAt: revision.createdAt };
    record.history = [...record.history, revision].slice(-HISTORY_LIMIT);
    return revision;
  };
  const checkSize = (body: string) => { if (body.length > MEMORY_MAX_CHARACTERS) throw new AssistantError("memory-oversized", `Memory is limited to ${MEMORY_MAX_CHARACTERS.toLocaleString("en")} characters. Your text was kept unsaved; shorten it and save again.`); };
  const memoryView = (record: SiteRecord) => ({ ...record.memory, history: record.history.map(({ revision, actor, kind, createdAt, restoredFrom, source }) => ({ revision, actor, kind, createdAt, ...(restoredFrom ? { restoredFrom } : {}), ...(source ? { source: { runId: source.runId, change: source.change } } : {}) })) });
  const applyChange = (body: string, change: MemoryChange) => {
    if (change.kind === "append") return body ? `${body.replace(/\s+$/, "")}\n${change.text}` : change.text;
    const count = body.split(change.find).length - 1;
    if (count !== 1) throw new AssistantError("memory-change-invalid", "The Memory line to correct must appear exactly once.");
    return body.replace(change.find, change.text);
  };
  const validChange = (change: MemoryChange) => {
    const texts = change.kind === "append" ? [change.text] : [change.find, change.text];
    if (texts.some(text => typeof text !== "string" || !text.trim() || text.length > AUTO_CHANGE_MAX)) throw new AssistantError("memory-change-invalid", `Memory updates are single bounded statements of at most ${AUTO_CHANGE_MAX} characters.`);
  };
  return {
    serial,
    // ── site settings ─────────────────────────────────────────────────────
    async settings(scope: AssistantScope) { const record = await site(scope); return { botName: record.botName, memory: memoryView(record) }; },
    async rename(scope: AssistantScope, botName: string | null) {
      if (botName !== null && (!/^[^\n\r\t]{1,40}$/.test(botName) || !botName.trim())) throw new AssistantError("invalid-request", "Use a name of 1–40 characters.");
      return serial(async () => { const record = await site(scope); record.botName = botName?.trim() ?? null; await write(scope, "site", record); return record.botName; });
    },
    // ── Memory ───────────────────────────────────────────────────────────
    /** Always the latest committed revision, read immediately before each model call. */
    async recall(scope: AssistantScope): Promise<{ used: UsedMemory; body: string; fence: { revision: number; modeRevision: number; clearGeneration: number } }> {
      let record: SiteRecord;
      try { record = await site(scope); } catch { return { used: { status: "unavailable", revision: null, mode: "read-only", characters: 0 }, body: "", fence: { revision: -1, modeRevision: -1, clearGeneration: -1 } }; }
      const fence = { revision: record.memory.revision, modeRevision: record.memory.modeRevision, clearGeneration: record.memory.clearGeneration };
      if (record.memory.mode === "off") return { used: { status: "off", revision: null, mode: "off", characters: 0 }, body: "", fence };
      return { used: { status: record.memory.body ? "used" : "empty", revision: record.memory.revision, mode: record.memory.mode, characters: record.memory.body.length }, body: record.memory.body, fence };
    },
    async saveMemory(scope: AssistantScope, input: { body: string; expectedRevision: number }) {
      checkSize(input.body);
      return serial(async () => {
        const record = await site(scope);
        if (record.memory.revision !== input.expectedRevision) throw new AssistantError("memory-conflict", "Memory changed since you opened it. Your text was kept; review the newer revision before saving.");
        pushRevision(record, { body: input.body, actor: "human", kind: "save" });
        await write(scope, "site", record);
        return memoryView(record);
      });
    },
    async clearMemory(scope: AssistantScope, input: { expectedRevision: number }) {
      return serial(async () => {
        const record = await site(scope);
        if (record.memory.revision !== input.expectedRevision) throw new AssistantError("memory-conflict", "Memory changed since you opened it.");
        record.memory.clearGeneration += 1;
        pushRevision(record, { body: "", actor: "human", kind: "clear" });
        await write(scope, "site", record);
        return memoryView(record);
      });
    },
    async restoreMemory(scope: AssistantScope, input: { revision: number; expectedRevision: number }) {
      return serial(async () => {
        const record = await site(scope);
        if (record.memory.revision !== input.expectedRevision) throw new AssistantError("memory-conflict", "Memory changed since you opened it.");
        const historical = record.history.find(entry => entry.revision === input.revision);
        if (!historical) throw new AssistantError("not-found", "That Memory revision is outside retained history.");
        // A restore of pre-Clear content is a deliberate human act; it still fences pending automatic updates.
        record.memory.clearGeneration += 1;
        pushRevision(record, { body: historical.body, actor: "human", kind: "restore", restoredFrom: historical.revision });
        await write(scope, "site", record);
        return memoryView(record);
      });
    },
    async setMemoryMode(scope: AssistantScope, input: { mode: MemoryMode; expectedModeRevision: number }) {
      if (!["off", "read-only", "auto"].includes(input.mode)) throw new AssistantError("invalid-request", "Unknown Memory mode.");
      return serial(async () => {
        const record = await site(scope);
        if (record.memory.modeRevision !== input.expectedModeRevision) throw new AssistantError("memory-conflict", "Memory mode changed elsewhere.");
        record.memory = { ...record.memory, mode: input.mode, modeRevision: record.memory.modeRevision + 1 };
        await write(scope, "site", record);
        return memoryView(record);
      });
    },
    /**
     * Bounded automatic update under Auto remember. Every fence the run observed
     * before its model call must still hold at commit; duplicate keys return the
     * original revision.
     */
    async autoRemember(scope: AssistantScope, input: { runId: string; turnId: string; key: string; change: MemoryChange; fence: { revision: number; modeRevision: number; clearGeneration: number }; active(): boolean }) {
      validChange(input.change);
      return serial(async () => {
        const record = await site(scope);
        const prior = record.history.find(entry => entry.source?.key === input.key);
        if (prior) return { revision: prior.revision, duplicate: true };
        if (!input.active()) throw new AssistantError("run-inactive", "The run was stopped; its Memory update was not saved.");
        if (record.memory.mode !== "auto" || record.memory.modeRevision !== input.fence.modeRevision) throw new AssistantError("memory-fenced", "Memory mode changed; the automatic update was not saved.");
        if (record.memory.clearGeneration !== input.fence.clearGeneration) throw new AssistantError("memory-fenced", "Memory was cleared or restored; the earlier automatic update was not saved.");
        if (record.memory.revision !== input.fence.revision) throw new AssistantError("memory-fenced", "Memory changed during this reply; the automatic update was not saved. Ask again to remember it.");
        const body = applyChange(record.memory.body, input.change);
        checkSize(body);
        const revision = pushRevision(record, { body, actor: "assistant", kind: "auto", source: { runId: input.runId, turnId: input.turnId, key: input.key, change: input.change } });
        await write(scope, "site", record);
        return { revision: revision.revision, duplicate: false };
      });
    },
    validChange,
    /** A human accepting a Read-only proposal is an ordinary CAS save of the proposed change. */
    async acceptMemoryProposal(scope: AssistantScope, input: { conversationId: string; proposalId: string; expectedRevision: number }) {
      return serial(async () => {
        const conversation = await this.conversation(scope, input.conversationId);
        const message = conversation.messages.find(candidate => candidate.memoryProposals?.some(proposal => proposal.id === input.proposalId));
        const proposal = message?.memoryProposals?.find(candidate => candidate.id === input.proposalId);
        if (!proposal || proposal.status !== "pending") throw new AssistantError("not-found", "That Memory proposal is no longer pending.");
        const record = await site(scope);
        if (record.memory.revision !== input.expectedRevision) throw new AssistantError("memory-conflict", "Memory changed since this proposal was shown. Review the newer Memory first.");
        const body = applyChange(record.memory.body, proposal.change);
        checkSize(body);
        const revision = pushRevision(record, { body, actor: "human", kind: "save" });
        proposal.status = "accepted"; proposal.resolvedRevision = revision.revision;
        await write(scope, "site", record);
        await write(scope, conversation.id, conversation);
        return memoryView(record);
      });
    },
    async rejectMemoryProposal(scope: AssistantScope, input: { conversationId: string; proposalId: string }) {
      return serial(async () => {
        const conversation = await this.conversation(scope, input.conversationId);
        const proposal = conversation.messages.flatMap(message => message.memoryProposals ?? []).find(candidate => candidate.id === input.proposalId);
        if (!proposal || proposal.status !== "pending") throw new AssistantError("not-found", "That Memory proposal is no longer pending.");
        proposal.status = "rejected";
        await write(scope, conversation.id, conversation);
        return conversation;
      });
    },
    // ── conversations ────────────────────────────────────────────────────
    async conversations(scope: AssistantScope) { return (await site(scope)).conversations; },
    async createConversation(scope: AssistantScope, title = "New conversation") {
      return serial(async () => {
        const record = await site(scope);
        if (record.conversations.length >= CONVERSATION_LIMIT) throw new AssistantError("limit", "Delete older conversations before starting another.");
        const conversation: Conversation = { schemaVersion: 1, id: `conversation-${randomUUID()}`, scope, title: title.slice(0, 80), createdAt: now(), updatedAt: now(), messages: [] };
        await write(scope, conversation.id, conversation);
        record.conversations = [{ id: conversation.id, title: conversation.title, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt, messages: 0, lastText: "" }, ...record.conversations];
        await write(scope, "site", record);
        return conversation;
      });
    },
    async conversation(scope: AssistantScope, conversationId: string): Promise<Conversation> {
      const value = await read<Conversation>(scope, id(conversationId, "conversation"));
      if (!value) throw new AssistantError("not-found", "Unknown Assistant record.");
      return value;
    },
    async appendMessage(scope: AssistantScope, conversationId: string, message: ChatMessage) {
      return serial(async () => {
        const conversation = await this.conversation(scope, conversationId);
        // Retried writes with the same message id resolve to the original message.
        if (conversation.messages.some(candidate => candidate.id === message.id)) return conversation;
        if (conversation.messages.length >= MESSAGE_LIMIT) throw new AssistantError("limit", "This conversation is full. Start a new conversation; Memory and the shared draft carry over.");
        conversation.messages.push(message);
        if (conversation.title === "New conversation" && message.role === "user") conversation.title = message.text.replace(/\s+/g, " ").slice(0, 60) || conversation.title;
        conversation.updatedAt = now();
        await write(scope, conversation.id, conversation);
        const record = await site(scope);
        record.conversations = [{ id: conversation.id, title: conversation.title, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt, messages: conversation.messages.length, lastText: message.text.slice(0, 120) }, ...record.conversations.filter(entry => entry.id !== conversation.id)];
        await write(scope, "site", record);
        return conversation;
      });
    },
    async updateMessage(scope: AssistantScope, conversationId: string, messageId: string, update: (message: ChatMessage) => void) {
      return serial(async () => {
        const conversation = await this.conversation(scope, conversationId);
        const message = conversation.messages.find(candidate => candidate.id === messageId);
        if (!message) throw new AssistantError("not-found", "Unknown message.");
        update(message);
        await write(scope, conversation.id, conversation);
        return conversation;
      });
    },
    // ── runs ─────────────────────────────────────────────────────────────
    async run(scope: AssistantScope, runId: string): Promise<RunRecord> {
      const value = await read<RunRecord>(scope, id(runId, "run"));
      if (!value) throw new AssistantError("not-found", "Unknown Assistant record.");
      return value;
    },
    async writeRun(run: RunRecord) { await serial(() => write(run.scope, run.id, run)); },
    /** After restart nothing is generating: unfinished runs become interrupted, never applied. */
    async interruptStaleRun(scope: AssistantScope, runId: string) {
      return serial(async () => {
        const run = await this.run(scope, runId);
        if (run.status !== "running") return run;
        run.status = "interrupted"; run.endedAt = now();
        run.events.push({ seq: (run.events.at(-1)?.seq ?? 0) + 1, at: now(), type: "done", data: { status: "interrupted" } });
        await write(scope, run.id, run);
        return run;
      });
    },
    // ── exact payloads ───────────────────────────────────────────────────
    async putPayload(scope: AssistantScope, payload: Omit<ExactPayloadRecord, "id" | "createdAt">) {
      const record = { ...payload, id: `payload-${randomUUID()}`, createdAt: now() } as ExactPayloadRecord;
      await serial(() => write(scope, record.id, { schemaVersion: 1, scope, payload: record }));
      return record;
    },
    async payload(scope: AssistantScope, payloadId: string): Promise<ExactPayloadRecord> {
      const value = await read<{ schemaVersion: 1; scope: AssistantScope; payload: ExactPayloadRecord }>(scope, id(payloadId, "payload"));
      if (!value) throw new AssistantError("not-found", "Unknown exact material.");
      return value.payload;
    },
  };
}
export type AssistantStore = Awaited<ReturnType<typeof openAssistantStore>>;
