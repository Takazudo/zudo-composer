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
function createContentAiService(options) {
	const ai = options.boundary({
		actor: options.actor,
		source: "content-ai"
	});
	const now = () => options.now?.() ?? /* @__PURE__ */ new Date();
	const ttl = options.ttlMs ?? DAY_MS;
	async function scope(entry) {
		const fields = (await ai.readFields({ entry })).filter((field) => CONTENT_AI_FIELD_KEYS.includes(field.key) && CONTENT_AI_KINDS.has(field.kind));
		if (!fields.length) throw new EditorialError("forbidden", "Content-AI edits only an Article's title and body; this Entry has neither.");
		return fields;
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
			if (!Object.keys(values).length) return {
				status: "refused",
				message: "The model proposed no change."
			};
			const validation = await ai.validateFields({
				entry: request.entry,
				expected: pinned.expected,
				values,
				clear: []
			});
			if (!validation.differences.length) return {
				status: "refused",
				message: "The proposal matches the saved values; there is nothing to apply."
			};
			const id = options.createId();
			const createdAt = now();
			const proposal = {
				id,
				entry: structuredClone(request.entry),
				expected: pinned.expected,
				summary: output.summary,
				values,
				differences: validation.differences,
				candidate: validation.values,
				candidateDigest: await contentAiCandidateDigest({
					entry: request.entry,
					expected: pinned.expected,
					candidate: validation.values
				}),
				operationKey: `content-ai:${id}`,
				provider: proposer.label,
				createdAt: createdAt.toISOString(),
				expiresAt: new Date(createdAt.getTime() + ttl).toISOString()
			};
			await options.store.create({
				schemaVersion: 1,
				owner: options.owner,
				actorId: options.actor?.id ?? null,
				proposal
			});
			return {
				status: "proposed",
				proposal: structuredClone(proposal)
			};
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
			for (const field of fields) {
				if (field.key === "title") values.title = `${field.value} — ${instruction}`.slice(0, 200);
				if (field.key === "body") values.body = `${field.value}\n\n## Revision note\n\n${instruction}`;
			}
			return {
				kind: "proposal",
				values,
				summary: `Applied the instruction "${instruction}" to ${fields.map((field) => field.label).join(" and ")}.`
			};
		}
	};
}
//#endregion
export { createMemoryContentAiProposalStore as a, createFakeContentAiProposer as i, contentAiCandidateDigest as n, createContentAiService as r, CONTENT_AI_FIELD_KEYS as t };
