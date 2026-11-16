import { t as EditorialError } from "./types-nfgY3xip.mjs";
//#region src/content/editorial/differences.ts
function canonicalEditorialJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalEditorialJson).join(",")}]`;
	if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalEditorialJson(value[key])}`).join(",")}}`;
	return JSON.stringify(value);
}
//#endregion
//#region src/content/editorial/ai.ts
/** Field keys and kinds Content-AI may write. Anything else is refused. */
var CONTENT_AI_FIELD_KEYS = ["title", "body"];
var CONTENT_AI_KINDS = /* @__PURE__ */ new Set([
	"text",
	"long-text",
	"markdown"
]);
var MAX_INSTRUCTION = 2e3;
var MAX_VALUE = 5e4;
var DAY_MS = 864e5;
var PROPOSAL_ID = /^[A-Za-z0-9-]{8,80}$/;
async function contentAiCandidateDigest(value) {
	const bytes = new TextEncoder().encode(canonicalEditorialJson({
		entry: value.entry,
		expected: value.expected,
		candidate: value.candidate
	}));
	return [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function contentAiScope(options, ai, entry) {
	const policy = options.contentFields?.find((item) => item.providerId === entry.providerId && item.modelId === entry.modelId);
	const fields = (await ai.readFields({ entry })).filter((field) => CONTENT_AI_KINDS.has(field.kind) && (options.contentFields === void 0 ? CONTENT_AI_FIELD_KEYS.includes(field.key) : policy?.fieldIds.includes(field.id)));
	if (!fields.length) throw new EditorialError("forbidden", "No editable text fields are permitted by this host's Content-AI policy.");
	return fields;
}
async function sha256(value) {
	const bytes = new TextEncoder().encode(canonicalEditorialJson(value));
	return [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function preparationIdentity(options, request, provider) {
	if (typeof request.summary !== "string" || request.summary.length > 1e3 || !request.values || typeof request.values !== "object" || Array.isArray(request.values) || Object.keys(request.values).length > 100) throw new EditorialError("invalid-request", "Malformed bounded Content proposal.");
	if (request.preparationKey !== void 0 && (typeof request.preparationKey !== "string" || !request.preparationKey.trim() || request.preparationKey.length > 512)) throw new EditorialError("invalid-request", "Malformed proposal preparation key.");
	return {
		keyDigest: request.preparationKey === void 0 ? void 0 : await sha256({
			owner: options.owner,
			actorId: options.actor?.id ?? null,
			key: request.preparationKey
		}),
		payloadDigest: await sha256({
			entry: request.entry,
			expected: request.expected,
			values: request.values,
			summary: request.summary,
			provider
		})
	};
}
async function readPreparedProposal(options, identity, guard) {
	const { keyDigest, payloadDigest } = identity;
	guard.signal?.throwIfAborted();
	if (!keyDigest) return null;
	const id = `stage-${keyDigest}`;
	const record = await options.store.read(id);
	if (!record) return null;
	if (record.owner !== options.owner || record.actorId !== (options.actor?.id ?? null) || record.proposal.id !== id || record.preparation?.keyDigest !== keyDigest || record.preparation.payloadDigest !== payloadDigest) throw new EditorialError("operation-key-reuse", "This preparation key belongs to another proposal.");
	guard.signal?.throwIfAborted();
	await guard.beforePersist?.();
	guard.signal?.throwIfAborted();
	return {
		status: "proposed",
		proposal: structuredClone(record.proposal)
	};
}
async function stageValidatedContentAi(options, raw, provider, guard) {
	const request = structuredClone(raw);
	guard.signal?.throwIfAborted();
	const identity = await preparationIdentity(options, request, provider);
	const { keyDigest, payloadDigest } = identity;
	const id = keyDigest ? `stage-${keyDigest}` : options.createId();
	const replay = () => readPreparedProposal(options, identity, guard);
	const prior = await replay();
	if (prior) return prior;
	const ai = options.boundary({
		actor: options.actor,
		source: "content-ai"
	});
	const fields = await contentAiScope(options, ai, request.entry);
	for (const [id, value] of Object.entries(request.values)) {
		const field = fields.find((field) => field.id === id);
		if (!field) throw new EditorialError("forbidden", `Content-AI may not write "${id}".`);
		if (typeof value !== "string" || value.length > MAX_VALUE) throw new EditorialError("invalid-value", `The proposed ${field.label} is not usable text.`);
	}
	if (!Object.keys(request.values).length) return {
		status: "refused",
		message: "The model proposed no change."
	};
	const validation = await ai.validateFields({
		entry: request.entry,
		expected: request.expected,
		values: request.values,
		clear: []
	});
	if (!validation.differences.length) return {
		status: "refused",
		message: "The proposal matches the saved values; there is nothing to apply."
	};
	const createdAt = options.now?.() ?? /* @__PURE__ */ new Date();
	const proposal = {
		id,
		entry: request.entry,
		expected: request.expected,
		summary: request.summary,
		values: request.values,
		differences: validation.differences,
		candidate: validation.values,
		candidateDigest: await contentAiCandidateDigest({
			entry: request.entry,
			expected: request.expected,
			candidate: validation.values
		}),
		operationKey: `content-ai:${id}`,
		provider,
		createdAt: createdAt.toISOString(),
		expiresAt: new Date(createdAt.getTime() + (options.ttlMs ?? DAY_MS)).toISOString()
	};
	guard.signal?.throwIfAborted();
	await guard.beforePersist?.();
	guard.signal?.throwIfAborted();
	try {
		await options.store.create({
			schemaVersion: 1,
			owner: options.owner,
			actorId: options.actor?.id ?? null,
			proposal,
			...keyDigest ? { preparation: {
				keyDigest,
				payloadDigest
			} } : {}
		});
	} catch (error) {
		const recovered = await replay();
		if (recovered) return recovered;
		throw error;
	}
	guard.signal?.throwIfAborted();
	return {
		status: "proposed",
		proposal: structuredClone(proposal)
	};
}
function createContentAiService(options) {
	const ai = options.boundary({
		actor: options.actor,
		source: "content-ai"
	});
	const now = () => options.now?.() ?? /* @__PURE__ */ new Date();
	async function scope(entry) {
		return contentAiScope(options, ai, entry);
	}
	async function stored(proposalId) {
		if (typeof proposalId !== "string" || !PROPOSAL_ID.test(proposalId)) throw new EditorialError("invalid-request", "Malformed proposal id.");
		const record = await options.store.read(proposalId);
		if (!record || record.owner !== options.owner || record.actorId !== (options.actor?.id ?? null) || record.proposal.id !== proposalId) throw new EditorialError("not-found", "This proposal is not available here; prepare it again.");
		return record.proposal;
	}
	const undoKey = (proposal) => `${proposal.operationKey}:undo`;
	return {
		scope,
		async prepare(request) {
			const instruction = typeof request.instruction === "string" ? request.instruction.trim() : "";
			if (!instruction || instruction.length > MAX_INSTRUCTION) throw new EditorialError("invalid-request", `Describe the change in 1 to ${MAX_INSTRUCTION} characters.`);
			const proposer = options.proposer;
			if (!proposer) throw new EditorialError("unavailable", "No AI provider is available on this host. Saved Content, history and committed AI operations stay readable.");
			request.signal?.throwIfAborted();
			const fields = await scope(request.entry);
			const pinned = await ai.readEntry({
				entry: request.entry,
				perspective: "working"
			});
			const output = await proposer.propose({
				instruction,
				fields: fields.map((field) => ({
					key: field.key,
					label: field.label,
					kind: field.kind,
					value: typeof pinned.values[field.id] === "string" ? pinned.values[field.id] : ""
				})),
				signal: request.signal ?? new AbortController().signal
			});
			request.signal?.throwIfAborted();
			if (output.kind === "refusal") return {
				status: "refused",
				message: output.message || "The model declined this change."
			};
			const values = {};
			for (const [key, value] of Object.entries(output.values)) {
				const field = fields.find((candidate) => candidate.key === key);
				if (!field) throw new EditorialError("forbidden", `Content-AI may not write "${key}".`);
				if (typeof value !== "string" || value.length > MAX_VALUE) throw new EditorialError("invalid-value", `The proposed ${field.label} is not usable text.`);
				values[field.id] = value;
			}
			return stageValidatedContentAi(options, {
				entry: request.entry,
				expected: pinned.expected,
				values,
				summary: output.summary
			}, proposer.label, { signal: request.signal });
		},
		async read(request) {
			const proposal = await stored(request.proposalId);
			const applied = await ai.readOperation({
				entry: proposal.entry,
				operationKey: proposal.operationKey
			});
			const undone = applied ? await ai.readOperation({
				entry: proposal.entry,
				operationKey: undoKey(proposal)
			}) : null;
			return structuredClone({
				proposal,
				applied,
				undone
			});
		},
		async apply(request) {
			const proposal = await stored(request.proposalId);
			const committed = await ai.readOperation({
				entry: proposal.entry,
				operationKey: proposal.operationKey
			});
			if (committed) return {
				receipt: committed,
				recovered: true
			};
			if (options.canApply === false) throw new EditorialError("forbidden", "This host permits AI proposals but not Apply.");
			if (now().getTime() > Date.parse(proposal.expiresAt)) throw new EditorialError("invalid-request", "This proposal expired before it was applied; prepare it again.");
			if (request.renderedCandidate !== proposal.candidateDigest) throw new EditorialError("invalid-request", "Apply needs a successful render of this exact candidate first.");
			const fields = await scope(proposal.entry);
			for (const id of Object.keys(proposal.values)) if (!fields.some((field) => field.id === id)) throw new EditorialError("forbidden", "This proposal includes a field no longer permitted by the host policy.");
			return {
				receipt: await ai.saveFields({
					entry: proposal.entry,
					expected: proposal.expected,
					values: proposal.values,
					clear: [],
					operationKey: proposal.operationKey
				}),
				recovered: false
			};
		},
		async undo(request) {
			const proposal = await stored(request.proposalId);
			const applied = await ai.readOperation({
				entry: proposal.entry,
				operationKey: proposal.operationKey
			});
			if (!applied?.revisionId) throw new EditorialError("invalid-request", "This proposal has not been applied.");
			const committed = await ai.readOperation({
				entry: proposal.entry,
				operationKey: undoKey(proposal)
			});
			if (committed) return {
				receipt: committed,
				recovered: true
			};
			if (options.canApply === false) throw new EditorialError("forbidden", "This host permits AI proposals but not Undo.");
			const revision = await ai.readRevision({
				entry: proposal.entry,
				revisionId: applied.revisionId
			});
			if (revision.source !== "content-ai" || revision.operation.key !== proposal.operationKey || !revision.parentId) throw new EditorialError("invalid-request", "Only the revision this proposal applied can be undone.");
			return {
				receipt: await ai.restoreRevision({
					entry: proposal.entry,
					revisionId: revision.parentId,
					expected: applied.expected,
					operationKey: undoKey(proposal)
				}),
				recovered: false
			};
		}
	};
}
/** A process-local proposal store for tests and hosts that opt out of durability. */
function createMemoryContentAiProposalStore(records = /* @__PURE__ */ new Map()) {
	return {
		async create(record) {
			if (records.has(record.proposal.id)) throw new EditorialError("operation-key-reuse", "A proposal with this id already exists.");
			records.set(record.proposal.id, structuredClone(record));
		},
		async read(id) {
			const record = records.get(id);
			return record ? structuredClone(record) : null;
		}
	};
}
/**
* Offline deterministic proposer for local trials and tests. It never contacts
* a model, and its output is not evidence of model behavior.
*/
function createFakeContentAiProposer() {
	return {
		label: "Fake provider (offline, deterministic)",
		async propose({ instruction, fields }) {
			if (/\brefuse\b/i.test(instruction)) return {
				kind: "refusal",
				message: "The fake provider declines instructions that ask it to refuse."
			};
			const values = {};
			for (const field of fields) if (field.key === "title") values.title = `${field.value} — ${instruction}`.slice(0, 200);
			else if (field.key === "body") values.body = `${field.value}\n\n## Revision note\n\n${instruction}`;
			else values[field.key] = `${field.value} — ${instruction}`.slice(0, MAX_VALUE);
			return {
				kind: "proposal",
				values,
				summary: `Applied the instruction "${instruction}" to ${fields.map((field) => field.label).join(" and ")}.`.slice(0, 1e3)
			};
		}
	};
}
//#endregion
export { createMemoryContentAiProposalStore as a, createFakeContentAiProposer as i, contentAiCandidateDigest as n, createContentAiService as r, CONTENT_AI_FIELD_KEYS as t };
