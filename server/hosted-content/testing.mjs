import { t as createHostedContentService } from "./chunks/service-EjK9CN-b.mjs";
//#region src/hosted-content/testing.ts
var receiptKey = (actorId, operationKey) => JSON.stringify([actorId, operationKey]);
var entryKey = (entry) => JSON.stringify([
	entry.providerId,
	entry.modelId,
	entry.recordId
]);
var sequenceKey = (revision) => JSON.stringify([entryKey(revision.entry), revision.sequence]);
function load(seed) {
	const database = clone(seed);
	return {
		head: {
			version: "seed",
			state: database.state,
			baselineProviders: database.baselineProviders,
			activePublicationId: database.activePublicationId ?? null
		},
		receipts: new Map(database.receipts.map((item) => [receiptKey(item.actorId, item.operationKey), item])),
		snapshots: new Map(database.snapshots.map((item) => [item.id, item])),
		publications: new Map(database.publications.map((item) => [item.id, item])),
		revisions: new Map((database.revisions ?? []).map((item) => [item.id, item]))
	};
}
function dumpData(data) {
	return clone({
		state: data.head.state,
		baselineProviders: data.head.baselineProviders,
		activePublicationId: data.head.activePublicationId,
		receipts: [...data.receipts.values()],
		snapshots: [...data.snapshots.values()],
		publications: [...data.publications.values()],
		revisions: [...data.revisions.values()].sort((left, right) => entryKey(left.entry).localeCompare(entryKey(right.entry)) || left.sequence - right.sequence)
	});
}
/** The conditional write every adapter must implement atomically. */
function applyCommit(data, change) {
	if (data.head.version !== change.expectedVersion || change.head.version === change.expectedVersion) return null;
	if (change.receipt && data.receipts.has(receiptKey(change.receipt.actorId, change.receipt.operationKey))) return null;
	if (change.snapshot && data.snapshots.has(change.snapshot.id)) return null;
	const sequences = new Set([...data.revisions.values()].map(sequenceKey)), ids = new Set(data.revisions.keys());
	for (const revision of change.revisions ?? []) {
		if (ids.has(revision.id) || sequences.has(sequenceKey(revision))) return null;
		ids.add(revision.id);
		sequences.add(sequenceKey(revision));
	}
	const next = {
		head: clone(change.head),
		receipts: new Map(data.receipts),
		snapshots: new Map(data.snapshots),
		publications: new Map(data.publications),
		revisions: new Map(data.revisions)
	};
	for (const revision of change.revisions ?? []) next.revisions.set(revision.id, clone(revision));
	if (change.receipt) next.receipts.set(receiptKey(change.receipt.actorId, change.receipt.operationKey), clone(change.receipt));
	if (change.snapshot) next.snapshots.set(change.snapshot.id, clone(change.snapshot));
	if (change.publication) next.publications.set(change.publication.id, clone(change.publication));
	return next;
}
function memoryReads(read) {
	return {
		async readHead() {
			return clone(read().head);
		},
		async readReceipt(actorId, operationKey) {
			return clone(read().receipts.get(receiptKey(actorId, operationKey)) ?? null);
		},
		async readSnapshot(snapshotId) {
			return clone(read().snapshots.get(snapshotId) ?? null);
		},
		async readPublication(publicationId) {
			return clone(read().publications.get(publicationId) ?? null);
		},
		async readRevision(revisionId) {
			return clone(read().revisions.get(revisionId) ?? null);
		},
		async listRevisions(entry, page) {
			return clone([...read().revisions.values()].filter((revision) => entryKey(revision.entry) === entryKey(entry) && (page.beforeSequence === void 0 || revision.sequence < page.beforeSequence)).sort((left, right) => right.sequence - left.sequence).slice(0, page.limit));
		}
	};
}
/** In-process storage for tests and single-isolate examples. It proves no durability or cross-process behavior. */
function createMemoryHostedStorage(seed) {
	let data = load(seed);
	return {
		storage: {
			...memoryReads(() => data),
			async commit(change) {
				const next = applyCommit(data, clone(change));
				if (next) data = next;
				return !!next;
			}
		},
		dump: () => dumpData(data),
		replace(database) {
			const version = data.head.version;
			data = load(database);
			data.head.version = `${version}+replaced`;
		}
	};
}
/**
* Deterministic fault/interleaving reference only. This fake does not demonstrate
* disk durability, process isolation, SQLite or D1 behavior.
*/
function createMemoryHostedConformanceFactory() {
	return { async create(seed) {
		let data = load(seed);
		let generation = 0;
		let disposed = false;
		return {
			async open() {
				const openedAt = generation;
				let fault;
				let held;
				const check = () => {
					if (disposed || openedAt !== generation) throw new Error("Conformance handle is closed");
				};
				return {
					storage: {
						...memoryReads(() => {
							check();
							return data;
						}),
						async commit(change) {
							check();
							const selectedFault = fault;
							fault = void 0;
							const selectedGate = held;
							held = void 0;
							const detached = clone(change);
							if (selectedGate) {
								selectedGate.entered();
								await selectedGate.wait;
								check();
							}
							if (selectedFault === "before-commit" || selectedFault === "receipt-persistence") throw new Error(`Injected ${selectedFault}`);
							const next = applyCommit(data, detached);
							if (next) data = next;
							if (next && selectedFault === "lost-acknowledgement") throw new Error("Injected lost acknowledgement after commit");
							return !!next;
						}
					},
					faultNextCommit(next) {
						check();
						fault = next;
					},
					holdNextCommit() {
						check();
						let release;
						let entered;
						const gate = {
							entered: new Promise((resolve) => {
								entered = resolve;
							}),
							release: () => release()
						};
						held = {
							entered,
							wait: new Promise((resolve) => {
								release = resolve;
							})
						};
						return gate;
					},
					async dump() {
						check();
						return dumpData(data);
					}
				};
			},
			async restart() {
				generation++;
			},
			async close() {
				disposed = true;
				generation++;
			}
		};
	} };
}
var actor = { id: "allowed-editor" };
var lesson = {
	providerId: "content",
	modelId: "lesson",
	recordId: "lesson-entry"
};
var faq = {
	providerId: "content",
	modelId: "faq",
	recordId: "faq-initial"
};
var timestamp = "2026-01-01T00:00:00.000Z";
var clone = (value) => value === void 0 ? value : JSON.parse(JSON.stringify(value));
/** Public deterministic data shared by adapter and independent-process proofs. */
function createHostedContentConformanceSeed() {
	const providers = [{
		providerId: "content",
		models: [{
			id: "lesson",
			createdAt: timestamp,
			updatedAt: timestamp,
			document: {
				schemaVersion: 1,
				id: "lesson",
				name: "Lesson",
				description: "",
				kind: "single",
				fields: [
					{
						id: "title",
						key: "title",
						label: "Title",
						required: true,
						kind: "text"
					},
					{
						id: "price",
						key: "price",
						label: "Price",
						required: true,
						kind: "number"
					},
					{
						id: "enabled",
						key: "enabled",
						label: "Enabled",
						required: false,
						kind: "boolean"
					},
					{
						id: "faqs",
						key: "faqs",
						label: "FAQ",
						required: false,
						kind: "reference-list",
						target: {
							providerId: "content",
							recordId: "faq"
						},
						ordered: true
					}
				]
			}
		}, {
			id: "faq",
			createdAt: timestamp,
			updatedAt: timestamp,
			document: {
				schemaVersion: 1,
				id: "faq",
				name: "FAQ",
				description: "",
				kind: "collection",
				fields: [{
					id: "question",
					key: "question",
					label: "Question",
					required: true,
					kind: "text"
				}, {
					id: "answer",
					key: "answer",
					label: "Answer",
					required: true,
					kind: "text"
				}]
			}
		}],
		entries: [{
			schemaVersion: 1,
			id: lesson.recordId,
			modelId: lesson.modelId,
			createdAt: timestamp,
			updatedAt: timestamp,
			generation: 1,
			lifecycle: "published",
			values: {
				title: "日本語の講座",
				price: 100,
				enabled: true,
				faqs: [faq]
			}
		}, {
			schemaVersion: 1,
			id: faq.recordId,
			modelId: faq.modelId,
			createdAt: timestamp,
			updatedAt: timestamp,
			generation: 1,
			lifecycle: "published",
			values: {
				question: "初回の質問",
				answer: "初回の回答"
			}
		}]
	}];
	return {
		state: {
			draftRevision: "r0",
			baseline: {
				gitSha: "0".repeat(40),
				contentDigest: "content-0"
			},
			definition: "definition-v1",
			integrationFence: 0,
			providers: clone(providers)
		},
		baselineProviders: clone(providers),
		receipts: [],
		snapshots: [],
		publications: [],
		revisions: []
	};
}
function createHostedContentConformancePolicy() {
	return {
		models: [{
			providerId: "content",
			modelId: "lesson",
			entryIds: [lesson.recordId],
			fields: [
				{
					fieldId: "title",
					replace: true,
					clear: true
				},
				{
					fieldId: "price",
					replace: true
				},
				{
					fieldId: "enabled",
					replace: true
				}
			]
		}, {
			providerId: "content",
			modelId: "faq",
			entryIds: [faq.recordId],
			fields: [{
				fieldId: "question",
				replace: true
			}, {
				fieldId: "answer",
				replace: true
			}]
		}],
		collections: [{
			id: "lesson-faqs",
			owner: lesson,
			fieldId: "faqs",
			target: {
				providerId: "content",
				modelId: "faq"
			},
			create: true,
			add: true,
			reorder: true,
			maxItems: 8,
			initialValues: {
				question: "新しい質問",
				answer: "新しい回答"
			}
		}],
		assets: []
	};
}
/** A deterministic test digest; production hosts must supply a cryptographic digest. */
async function hostedConformanceDigest(value) {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
	return `fixture-${(hash >>> 0).toString(16).padStart(8, "0")}-${value.length}`;
}
function createHostedConformanceService(storage, handleId, definition = "definition-v1") {
	let nextId = 0;
	return createHostedContentService({
		siteId: "conformance",
		definition,
		policy: createHostedContentConformancePolicy(),
		storage,
		authorize(who) {
			if (who.id !== actor.id) throw new Error("Unauthorized fixture actor");
		},
		digest: hostedConformanceDigest,
		createId: () => `${handleId}-${++nextId}`,
		now: () => timestamp,
		project: (providers, assets) => clone({
			providers,
			assets
		}),
		validateSubmission: () => void 0
	});
}
function identities(state) {
	return {
		draftRevision: state.draftRevision,
		baseline: clone(state.baseline),
		definition: state.definition
	};
}
function edit(state, operationKey, title, target = lesson) {
	return {
		kind: "set-fields",
		operationKey,
		expected: identities(state),
		entry: target,
		values: target.modelId === "faq" ? { question: title } : { title },
		clear: []
	};
}
function value(state, target, field) {
	return state.providers.find((p) => p.providerId === target.providerId)?.entries.find((entry) => entry.id === target.recordId && entry.modelId === target.modelId)?.values[field];
}
/**
* Portable, framework-independent service conformance. It imports no Node/DOM APIs.
* Run it against a deterministic fault backend and the actual downstream adapter.
* A pass identifies only the tested backend; it is never evidence for another database.
*/
async function runHostedContentConformance(factory) {
	const report = {
		scenarios: [],
		assertions: 0
	};
	const assert = (condition, message) => {
		report.assertions++;
		if (!condition) throw new Error(`Hosted Content conformance: ${message}`);
	};
	const equal = (left, right, message) => assert(JSON.stringify(left) === JSON.stringify(right), message);
	const errorCode = async (work, expected) => {
		let error;
		try {
			await work();
		} catch (caught) {
			error = caught;
		}
		assert(typeof error === "object" && error !== null && "code" in error && error.code === expected, `expected ${expected}, received ${error instanceof Error ? error.message : String(error)}`);
	};
	const scenario = async (name, run) => {
		const backend = await factory.create(createHostedContentConformanceSeed(), name);
		try {
			const a = await backend.open();
			const b = await backend.open();
			assert(a.storage !== b.storage, `${name}: independent storage handles required`);
			await run(backend, a, b, createHostedConformanceService(a.storage, `${name}-a`), createHostedConformanceService(b.storage, `${name}-b`));
			report.scenarios.push(name);
		} finally {
			await backend.close();
		}
	};
	await scenario("independent-cas", async (_backend, a, _b, one, two) => {
		const initial = await one.readState(actor);
		const gate = a.holdNextCommit();
		const first = one.execute(actor, edit(initial, "cas-a", "A"));
		await gate.entered;
		const second = await two.execute(actor, edit(initial, "cas-b", "B"));
		gate.release();
		await errorCode(() => first, "revision-conflict");
		const saved = await two.readState(actor);
		equal(saved, second.state, "CAS winner is the stored state");
		equal(value(saved, lesson, "title"), "B", "CAS winner retained");
		equal(value(saved, lesson, "faqs"), [faq], "CAS keeps membership");
		equal(await two.readReceipt(actor, "cas-a"), null, "refused writer has no receipt");
	});
	await scenario("duplicate-create-and-key-reuse", async (_backend, a, _b, one, two) => {
		const request = {
			kind: "create-entry",
			operationKey: "create-same",
			expected: identities(await one.readState(actor)),
			collectionId: "lesson-faqs",
			values: {
				question: "質問A",
				answer: "回答A"
			},
			before: null
		};
		const gate = a.holdNextCommit();
		const first = one.execute(actor, request);
		await gate.entered;
		const right = await two.execute(actor, clone(request));
		gate.release();
		const left = await first;
		equal(left, right, "duplicate create returns original exact receipt");
		assert(Boolean(left.createdEntry), "create assigns an entry identity");
		const db = await a.dump();
		equal(db.receipts.length, 1, "duplicate has one receipt");
		equal(db.state.providers[0]?.entries.length, 3, "duplicate creates only one entry");
		equal(value(db.state, lesson, "faqs"), [faq, left.createdEntry], "create atomically appends membership");
		await errorCode(() => two.execute(actor, {
			...request,
			values: {
				question: "別の質問",
				answer: "回答A"
			}
		}), "operation-key-reuse");
		await errorCode(() => two.execute(actor, {
			...request,
			expected: identities(db.state)
		}), "operation-key-reuse");
		equal(await a.dump(), db, "key reuse cannot change database");
	});
	await scenario("competing-reorder", async (_backend, a, _b, one, two) => {
		const initial = await one.readState(actor);
		const first = await one.execute(actor, {
			kind: "create-entry",
			operationKey: "reorder-create",
			expected: identities(initial),
			collectionId: "lesson-faqs",
			values: {},
			before: null
		});
		const created = await one.execute(actor, {
			kind: "create-entry",
			operationKey: "reorder-create-2",
			expected: identities(first.state),
			collectionId: "lesson-faqs",
			values: {},
			before: null
		});
		assert(first.createdEntry && created.createdEntry, "reorder fixture created");
		const request = {
			kind: "reorder",
			operationKey: "reorder-a",
			expected: identities(created.state),
			collectionId: "lesson-faqs",
			entries: [
				first.createdEntry,
				faq,
				created.createdEntry
			]
		};
		const winner = {
			...request,
			operationKey: "reorder-b",
			entries: [
				created.createdEntry,
				first.createdEntry,
				faq
			]
		};
		const gate = a.holdNextCommit();
		const held = one.execute(actor, request);
		await gate.entered;
		await two.execute(actor, winner);
		gate.release();
		await errorCode(() => held, "revision-conflict");
		equal(value(await two.readState(actor), lesson, "faqs"), winner.entries, "winning reorder exact IDs and order");
	});
	for (const fault of ["before-commit", "receipt-persistence"]) await scenario(`rollback-${fault}`, async (_backend, a, _b, one, two) => {
		const before = await a.dump();
		a.faultNextCommit(fault);
		let failed = false;
		try {
			await one.execute(actor, edit(before.state, "rollback", "must-not-persist"));
		} catch {
			failed = true;
		}
		assert(failed, `${fault} reaches caller`);
		equal(await a.dump(), before, `${fault}: head and receipts rollback together`);
		equal(await two.readReceipt(actor, "rollback"), null, `${fault}: no successful receipt`);
		const retried = await two.execute(actor, edit(before.state, "rollback", "must-not-persist"));
		equal(value(retried.state, lesson, "title"), "must-not-persist", `${fault}: exact retry can succeed`);
	});
	await scenario("conditional-commit-atomicity", async (_backend, a, b, one) => {
		const saved = await one.execute(actor, edit(await one.readState(actor), "atomic-save", "saved"));
		const captured = await one.execute(actor, {
			kind: "capture-snapshot",
			operationKey: "atomic-capture",
			expected: identities(saved.state)
		});
		const before = await b.dump();
		const head = await a.storage.readHead();
		const changed = clone(head);
		changed.version = "atomic-next";
		changed.state.draftRevision = "uncommitted";
		changed.state.providers[0].entries[0].values.title = "uncommitted";
		const receipt = await a.storage.readReceipt(actor.id, "atomic-save");
		const snapshot = await a.storage.readSnapshot(captured.snapshot.id);
		assert(receipt && snapshot, "committed receipt and snapshot are readable by key");
		assert(!await a.storage.commit({
			expectedVersion: `${head.version}-stale`,
			head: changed
		}), "stale version is refused");
		assert(!await a.storage.commit({
			expectedVersion: head.version,
			head: changed,
			receipt: {
				...receipt,
				fingerprint: "other"
			}
		}), "existing receipt key is refused");
		assert(!await a.storage.commit({
			expectedVersion: head.version,
			head: changed,
			snapshot
		}), "existing snapshot id is refused");
		const [latest] = await a.storage.listRevisions(lesson, { limit: 1 });
		assert(latest, "the save recorded a revision");
		const fresh = (sequence) => ({
			...latest,
			id: "atomic-fresh-revision",
			parentId: latest.id,
			sequence
		});
		assert(!await a.storage.commit({
			expectedVersion: head.version,
			head: changed,
			revisions: [fresh(latest.sequence + 1), fresh(latest.sequence + 2)]
		}), "a fresh revision id repeated within one commit is refused");
		equal(await b.dump(), before, "refused commits write nothing, including the head");
		assert(await a.storage.commit({
			expectedVersion: head.version,
			head: changed
		}), "current version commits");
		equal((await b.storage.readHead()).version, "atomic-next", "a successful commit stores the new version");
		equal((await b.storage.readHead()).state, changed.state, "the complete head is replaced atomically");
	});
	await scenario("commit-retry-after-bookkeeping", async (_backend, a, _b, one, two) => {
		const initial = await one.readState(actor);
		const gate = a.holdNextCommit();
		const first = one.execute(actor, {
			kind: "capture-snapshot",
			operationKey: "retry-capture-a",
			expected: identities(initial)
		});
		await gate.entered;
		const second = await two.execute(actor, {
			kind: "capture-snapshot",
			operationKey: "retry-capture-b",
			expected: identities(initial)
		});
		gate.release();
		const retried = await first;
		assert(retried.snapshot && second.snapshot && retried.snapshot.id !== second.snapshot.id, "refused commit retried from fresh reads");
		equal(retried.snapshot.draftRevision, initial.draftRevision, "retried capture keeps its unchanged draft revision");
		equal(await two.readSnapshot(actor, retried.snapshot.id), retried.snapshot, "retried snapshot persisted");
		equal(await two.readSnapshot(actor, second.snapshot.id), second.snapshot, "concurrent snapshot persisted");
		equal(await two.execute(actor, {
			kind: "capture-snapshot",
			operationKey: "retry-capture-a",
			expected: identities(initial)
		}), retried, "retried receipt replays exactly");
		equal((await a.dump()).receipts.length, 2, "one receipt per operation");
	});
	await scenario("lost-create-ack-restart", async (backend, a, _b, one) => {
		const request = {
			kind: "create-entry",
			operationKey: "lost-create",
			expected: identities(await one.readState(actor)),
			collectionId: "lesson-faqs",
			values: {
				question: "失われた応答",
				answer: "保存済み"
			},
			before: null
		};
		a.faultNextCommit("lost-acknowledgement");
		let failed = false;
		try {
			await one.execute(actor, request);
		} catch {
			failed = true;
		}
		assert(failed, "response loss surfaces uncertainty");
		await backend.restart();
		const reopened = await backend.open();
		const recovered = createHostedConformanceService(reopened.storage, "restart");
		const receipt = await recovered.readReceipt(actor, request.operationKey);
		assert(receipt?.result.createdEntry, "original creation receipt survives restart");
		const replay = await recovered.execute(actor, clone(request));
		equal(replay, receipt?.result, "restart retry returns original receipt and IDs");
		const db = await reopened.dump();
		equal(db.state.providers[0]?.entries.length, 3, "lost create response never duplicates entry");
		equal(db.receipts.length, 1, "lost create response never duplicates receipt");
	});
	await scenario("coherent-immutable-capture", async (_backend, a, _b, one, two) => {
		const initial = await one.readState(actor);
		const gate = a.holdNextCommit();
		const capture = one.execute(actor, {
			kind: "capture-snapshot",
			operationKey: "capture-race",
			expected: identities(initial)
		});
		await gate.entered;
		await two.execute(actor, {
			kind: "create-entry",
			operationKey: "capture-create",
			expected: identities(initial),
			collectionId: "lesson-faqs",
			values: {
				question: "coherent",
				answer: "coherent"
			},
			before: null
		});
		gate.release();
		await errorCode(() => capture, "revision-conflict");
		const latest = await two.readState(actor);
		const captured = await two.execute(actor, {
			kind: "capture-snapshot",
			operationKey: "capture-coherent",
			expected: identities(latest)
		});
		assert(captured.snapshot, "coherent capture persisted");
		const frozen = clone(captured.snapshot);
		equal(captured.snapshot?.providers[0]?.entries.length, 3, "capture includes whole multi-record create");
		equal(captured.snapshot?.providers[0]?.entries.find((entry) => entry.id === lesson.recordId)?.values.faqs, value(latest, lesson, "faqs"), "capture membership agrees with included records");
		captured.snapshot.providers[0].entries[0].values.title = "caller-mutation";
		equal(await one.readSnapshot(actor, frozen.id), frozen, "snapshot reads are detached");
		const changed = await one.execute(actor, edit(latest, "after-capture", "later"));
		equal(await two.readSnapshot(actor, frozen.id), frozen, "later saves cannot mutate captured bytes");
		const published = await two.execute(actor, {
			kind: "capture-snapshot",
			operationKey: "current",
			expected: identities(changed.state)
		});
		const staleDb = await a.dump();
		await errorCode(() => two.execute(actor, {
			kind: "begin-publication",
			operationKey: "stale-submit",
			expected: identities(changed.state),
			snapshotId: frozen.id
		}), "revision-conflict");
		equal(await a.dump(), staleDb, "stale submit does not create operation or receipt");
		assert(published.snapshot?.id !== frozen.id, "new revision has independent snapshot identity");
	});
	for (const isNewEntry of [false, true]) await scenario(isNewEntry ? "two-integrations-new-entry" : "two-integrations-existing-entry", async (backend, a, _b, one, two) => {
		let current = await one.readState(actor);
		let target = lesson;
		let saved;
		if (isNewEntry) {
			saved = await one.execute(actor, {
				kind: "create-entry",
				operationKey: "save-a",
				expected: identities(current),
				collectionId: "lesson-faqs",
				values: {
					question: "A",
					answer: "回答"
				},
				before: null
			});
			target = saved.createdEntry;
		} else saved = await one.execute(actor, edit(current, "save-a", "A"));
		current = saved.state;
		const s1 = (await one.execute(actor, {
			kind: "capture-snapshot",
			operationKey: "snapshot-a",
			expected: identities(current)
		})).snapshot;
		const p1 = (await one.execute(actor, {
			kind: "begin-publication",
			operationKey: "publication-a",
			expected: identities(current),
			snapshotId: s1.id
		})).publication;
		assert(p1, "first publication intent durably created");
		await errorCode(() => two.execute(actor, {
			kind: "begin-publication",
			operationKey: "competing-publication",
			expected: identities(current),
			snapshotId: s1.id
		}), "publication-busy");
		equal((await a.dump()).publications.length, 1, "one active publication cannot be overwritten");
		const integrationGate = a.holdNextCommit();
		const pendingIntegrationA = one.recordConfirmedIntegration({
			publicationId: p1.id,
			snapshotId: s1.id,
			expectedBaseline: p1.expectedBaseline,
			gitSha: "1".repeat(40),
			contentDigest: s1.digest
		});
		await integrationGate.entered;
		const savedB = await two.execute(actor, edit(current, "save-b", "B", target));
		integrationGate.release();
		const field = isNewEntry ? "question" : "title";
		equal(value(savedB.state, target, field), "B", "later B saved during publication A");
		const integratedA = await pendingIntegrationA;
		equal(value(integratedA, target, field), "B", "integration A preserves latest B");
		equal(integratedA.baseline, {
			gitSha: "1".repeat(40),
			contentDigest: s1.digest
		}, "baseline advances to A");
		assert(integratedA.draftRevision !== savedB.state.draftRevision, "integration advances CAS revision");
		equal(await two.execute(actor, edit(current, "save-b", "B", target)), savedB, "exact save replay survives baseline advancement");
		const recoveredP1 = await one.execute(actor, {
			kind: "begin-publication",
			operationKey: "publication-a",
			expected: identities(current),
			snapshotId: s1.id
		});
		equal(recoveredP1.snapshot, s1, "accepted publication replay retains original reviewed snapshot after B save and integration");
		equal(recoveredP1.publication, p1, "accepted publication replay retains original publication receipt");
		if (isNewEntry) equal(integratedA.providers[0].entries.find((entry) => entry.id === target.recordId)?.lifecycle, "draft", "newer created Entry B remains working draft after A integration");
		const s2 = (await two.execute(actor, {
			kind: "capture-snapshot",
			operationKey: "snapshot-b",
			expected: identities(integratedA)
		})).snapshot;
		equal(s2.providers.find((provider) => provider.providerId === target.providerId)?.entries.find((entry) => entry.id === target.recordId)?.values[field], "B", "second delivery candidate contains B including created entry");
		if (isNewEntry) equal(s2.providers[0].entries.find((entry) => entry.id === target.recordId)?.lifecycle, "published", "second immutable delivery includes the still-draft created Entry B");
		const p2 = (await two.execute(actor, {
			kind: "begin-publication",
			operationKey: "publication-b",
			expected: identities(integratedA),
			snapshotId: s2.id
		})).publication;
		await backend.restart();
		const reopened = await backend.open();
		const recovery = createHostedConformanceService(reopened.storage, "integration-restart");
		equal((await recovery.getPublication(actor, p2.id)).snapshotId, s2.id, "pending operation survives provider crash/restart");
		const integratedB = await recovery.recordConfirmedIntegration({
			publicationId: p2.id,
			snapshotId: s2.id,
			expectedBaseline: p2.expectedBaseline,
			gitSha: "2".repeat(40),
			contentDigest: s2.digest
		});
		equal(value(integratedB, target, field), "B", "second integration retains B");
		equal(integratedB.baseline, {
			gitSha: "2".repeat(40),
			contentDigest: s2.digest
		}, "baseline advances to B");
		if (isNewEntry) equal(integratedB.providers[0].entries.find((entry) => entry.id === target.recordId)?.lifecycle, "published", "matching newly integrated Entry B may be marked clean");
		const beforeLate = await reopened.dump();
		await recovery.recordConfirmedIntegration({
			publicationId: p1.id,
			snapshotId: s1.id,
			expectedBaseline: p1.expectedBaseline,
			gitSha: "1".repeat(40),
			contentDigest: s1.digest
		});
		equal((await recovery.readState(actor)).baseline, integratedB.baseline, "late P1 cannot regress B2 baseline");
		await recovery.recordStatus({
			publicationId: p1.id,
			snapshotId: s1.id,
			statusVersion: 1,
			status: "building"
		});
		equal((await recovery.getPublication(actor, p1.id)).status, "integrated", "late P1 status cannot regress integrated truth");
		equal((await reopened.dump()).state, beforeLate.state, "late callback never marks newer state clean");
		if (isNewEntry) assert(Array.isArray(value(integratedB, lesson, "faqs")) && value(integratedB, lesson, "faqs").some((ref) => ref.recordId === target.recordId), "new entry membership remains after both integrations");
	});
	await scenario("external-baseline-adoption", async (_backend, a, _b, one, two) => {
		const initial = await one.readState(actor);
		const saved = await one.execute(actor, edit(initial, "external-save", "retained"));
		const captured = await one.execute(actor, {
			kind: "capture-snapshot",
			operationKey: "external-capture",
			expected: identities(saved.state)
		});
		const canonical = clone((await a.dump()).baselineProviders);
		canonical[0].entries.find((entry) => entry.id === lesson.recordId).values.price = 200;
		canonical[0].entries.find((entry) => entry.id === faq.recordId).values.answer = "外部の回答";
		const external = {
			gitSha: "e".repeat(40),
			contentDigest: "external"
		};
		const adoption = {
			expected: {
				baseline: initial.baseline,
				definition: initial.definition
			},
			baseline: external,
			providers: canonical,
			draft: "rebase"
		};
		const before = await a.dump();
		const report = await one.adoptCanonicalBaseline({
			...adoption,
			apply: false
		});
		equal([
			report.applied,
			report.carried,
			report.dropped
		], [
			false,
			[{
				entry: lesson,
				fieldId: "title"
			}],
			[]
		], "dry run reports the carried draft");
		equal(await a.dump(), before, "dry run writes nothing");
		const adopted = await one.adoptCanonicalBaseline({
			...adoption,
			apply: true
		});
		equal(adopted.state, await two.readState(actor), "adoption returns the stored state");
		equal([
			value(adopted.state, lesson, "title"),
			value(adopted.state, lesson, "price"),
			value(adopted.state, faq, "answer")
		], [
			"retained",
			200,
			"外部の回答"
		], "retained draft is rebased onto new canonical content");
		equal(adopted.state.baseline, external, "baseline adopted");
		await errorCode(() => one.adoptCanonicalBaseline({
			...adoption,
			apply: true
		}), "baseline-conflict");
		await errorCode(() => two.execute(actor, {
			kind: "begin-publication",
			operationKey: "external-submit",
			expected: identities(saved.state),
			snapshotId: captured.snapshot.id
		}), "baseline-conflict");
		equal(await one.readSnapshot(actor, captured.snapshot.id), captured.snapshot, "old reviewed snapshot is retained but cannot be submitted");
		const fresh = (await two.execute(actor, {
			kind: "capture-snapshot",
			operationKey: "external-recapture",
			expected: identities(adopted.state)
		})).snapshot;
		equal(fresh.baseline, external, "a fresh preview binds the adopted baseline");
		assert((await two.execute(actor, {
			kind: "begin-publication",
			operationKey: "external-resubmit",
			expected: identities(adopted.state),
			snapshotId: fresh.id
		})).publication, "rebased draft can be submitted again");
	});
	await scenario("definition-change-adoption", async (_backend, a, _b, one) => {
		const initial = await one.readState(actor);
		const saved = await one.execute(actor, {
			kind: "set-fields",
			operationKey: "definition-save",
			expected: identities(initial),
			entry: lesson,
			values: {
				title: "保持",
				price: 300
			},
			clear: []
		});
		const upgraded = createHostedConformanceService(a.storage, "definition-v2", "definition-v2");
		await errorCode(() => upgraded.execute(actor, edit(saved.state, "definition-edit", "blocked")), "configuration-required");
		equal(value((await a.dump()).state, lesson, "title"), "保持", "definition change never destroys draft");
		const canonical = clone((await a.dump()).baselineProviders);
		for (const model of canonical[0].models) if (model.id === "lesson") model.document.fields = model.document.fields.filter((field) => field.id !== "price");
		for (const entry of canonical[0].entries) delete entry.values.price;
		const adoption = {
			expected: {
				baseline: initial.baseline,
				definition: initial.definition
			},
			baseline: {
				gitSha: "d".repeat(40),
				contentDigest: "definition-v2"
			},
			providers: canonical,
			draft: "rebase"
		};
		const report = await upgraded.adoptCanonicalBaseline({
			...adoption,
			apply: false
		});
		equal([report.carried, report.dropped], [[{
			entry: lesson,
			fieldId: "title"
		}], [{
			entry: lesson,
			fieldId: "price",
			reason: "field-removed"
		}]], "dry run reports carried and dropped changes");
		const adopted = await upgraded.adoptCanonicalBaseline({
			...adoption,
			apply: true
		});
		equal([
			adopted.state.definition,
			value(adopted.state, lesson, "title"),
			value(adopted.state, lesson, "price")
		], [
			"definition-v2",
			"保持",
			void 0
		], "definition adopted with the still-valid draft");
		await errorCode(() => one.execute(actor, edit(adopted.state, "old-definition-edit", "stale")), "configuration-required");
		const resumed = await upgraded.execute(actor, edit(adopted.state, "definition-resume", "再開"));
		equal(value(resumed.state, lesson, "title"), "再開", "editing resumes under the adopted definition");
		const history = (await upgraded.listRevisions(actor, { entry: lesson })).revisions;
		equal(history.map((revision) => [
			revision.operation.kind,
			revision.definition,
			revision.values.price
		]), [
			[
				"set-fields",
				"definition-v2",
				void 0
			],
			[
				"adopt-canonical-baseline",
				"definition-v2",
				void 0
			],
			[
				"set-fields",
				"definition-v1",
				300
			],
			[
				"initial",
				"definition-v1",
				100
			]
		], "adoption is recorded as its own revision");
		let incompatible;
		try {
			await upgraded.execute(actor, {
				kind: "restore-revision",
				operationKey: "definition-restore",
				expected: identities(resumed.state),
				entry: lesson,
				revisionId: history[2].id
			});
		} catch (error) {
			incompatible = error;
		}
		equal(incompatible?.restoreDiagnostics?.map((item) => [item.fieldId, item.code]), [["price", "field-removed"]], "a value for a removed field is reported, never dropped");
		equal(value((await a.dump()).state, lesson, "title"), "再開", "a refused restore keeps the draft");
	});
	await scenario("external-integration-conflict", async (_backend, a, _b, one, two) => {
		const initial = await one.readState(actor);
		const saved = await one.execute(actor, edit(initial, "external-integration-save", "retained"));
		const snapshot = (await one.execute(actor, {
			kind: "capture-snapshot",
			operationKey: "external-integration-capture",
			expected: identities(saved.state)
		})).snapshot;
		const publication = (await one.execute(actor, {
			kind: "begin-publication",
			operationKey: "external-integration-submit",
			expected: identities(saved.state),
			snapshotId: snapshot.id
		})).publication;
		const adoption = {
			expected: {
				baseline: initial.baseline,
				definition: initial.definition
			},
			baseline: {
				gitSha: "f".repeat(40),
				contentDigest: "external-integrated-content"
			},
			providers: clone((await a.dump()).baselineProviders),
			draft: "discard",
			apply: true
		};
		const active = await a.dump();
		await errorCode(() => two.adoptCanonicalBaseline(adoption), "publication-busy");
		equal(await a.dump(), active, "an active publication blocks adoption without writes");
		await two.recordStatus({
			publicationId: publication.id,
			snapshotId: snapshot.id,
			statusVersion: 2,
			status: "conflict",
			message: "Remote base moved"
		});
		const discarded = await two.adoptCanonicalBaseline(adoption);
		equal(discarded.dropped, [{
			entry: lesson,
			fieldId: "title",
			reason: "discarded"
		}], "discard is explicit and reported");
		const before = await a.dump();
		await errorCode(() => two.recordConfirmedIntegration({
			publicationId: publication.id,
			snapshotId: snapshot.id,
			expectedBaseline: publication.expectedBaseline,
			gitSha: "1".repeat(40),
			contentDigest: snapshot.digest
		}), "baseline-conflict");
		equal(await a.dump(), before, "late integration evidence for the conflicted publication changes nothing");
		equal(await one.readSnapshot(actor, snapshot.id), snapshot, "conflicted publication keeps its exact snapshot");
	});
	await scenario("editorial-perspectives-and-history", async (backend, a, _b, one, two) => {
		const initial = await one.readState(actor);
		const savedA = await one.execute(actor, edit(initial, "history-a", "A"));
		const reviewed = (await one.execute(actor, {
			kind: "capture-snapshot",
			operationKey: "history-capture",
			expected: identities(savedA.state)
		})).snapshot;
		const publication = (await one.execute(actor, {
			kind: "begin-publication",
			operationKey: "history-submit",
			expected: identities(savedA.state),
			snapshotId: reviewed.id
		})).publication;
		const submitted = await two.readPublicationStatus(actor);
		equal([
			submitted.submission?.status,
			submitted.activated.baseline,
			submitted.deployed
		], [
			"submitted",
			initial.baseline,
			false
		], "submission is reported apart from activation");
		await two.execute(actor, edit(savedA.state, "history-b", "B"));
		await one.recordConfirmedIntegration({
			publicationId: publication.id,
			snapshotId: reviewed.id,
			expectedBaseline: publication.expectedBaseline,
			gitSha: "1".repeat(40),
			contentDigest: reviewed.digest
		});
		const integrated = await two.readPublicationStatus(actor);
		equal([
			integrated.submission?.status,
			integrated.activated.baseline.gitSha,
			integrated.artifact,
			integrated.deployed
		], [
			"integrated",
			"1".repeat(40),
			null,
			false
		], "activation is reported without a deployment");
		await one.recordStatus({
			publicationId: publication.id,
			snapshotId: reviewed.id,
			statusVersion: 9,
			status: "deployed",
			facts: { artifact: "artifact-a" }
		});
		equal([(await two.readPublicationStatus(actor)).artifact, (await two.readPublicationStatus(actor)).deployed], ["artifact-a", true], "artifact and deployment are separate host facts");
		const working = await two.readEntry(actor, {
			perspective: "working",
			entry: lesson
		});
		const published = await two.readEntry(actor, {
			perspective: "published",
			entry: lesson
		});
		equal([
			working.values.title,
			working.status,
			published.values.title,
			published.status
		], [
			"B",
			"changed",
			"A",
			"changed"
		], "working reads B while published reads the activated A");
		const headRevision = (await two.listRevisions(actor, {
			entry: lesson,
			limit: 1
		})).revisions[0].id;
		equal([
			working.workingRevisionId,
			published.workingRevisionId,
			working.valuesIdentity,
			published.valuesIdentity
		], [
			headRevision,
			headRevision,
			{
				perspective: "working",
				draftRevision: (await two.readState(actor)).draftRevision,
				revisionId: headRevision
			},
			{
				perspective: "published",
				baseline: integrated.activated.baseline,
				integrationFence: integrated.activated.integrationFence
			}
		], "published values are identified by the activated baseline, never by the newest working revision");
		equal((await two.readEntry(actor, {
			perspective: "working",
			entry: faq
		})).status, "published", "an unchanged Entry is published");
		const page = await two.listEntries(actor, {
			perspective: "published",
			providerId: "content",
			modelId: "lesson"
		});
		equal([page.entries.map((entry) => entry.values.title), page.nextCursor], [["A"], null], "published lists read the baseline");
		const models = await two.listModels(actor);
		equal(models.map((model) => [
			model.model.id,
			model.workingEntries,
			model.publishedEntries
		]), [[
			"lesson",
			1,
			1
		], [
			"faq",
			1,
			1
		]], "model list is bounded to the policy");
		const history = await two.listRevisions(actor, { entry: lesson });
		equal(history.revisions.map((revision) => [
			revision.sequence,
			revision.operation.kind,
			revision.values.title
		]), [
			[
				3,
				"set-fields",
				"B"
			],
			[
				2,
				"set-fields",
				"A"
			],
			[
				1,
				"initial",
				"日本語の講座"
			]
		], "history is newest first, from the prior values");
		const [revisionB, revisionA, original] = history.revisions;
		equal([
			revisionB.parentId,
			revisionA.parentId,
			original.parentId
		], [
			revisionA.id,
			original.id,
			null
		], "each revision names its parent");
		equal([
			revisionA.actor,
			original.actor,
			revisionA.operation.key,
			revisionA.definition
		], [
			{ id: actor.id },
			null,
			"history-a",
			"definition-v1"
		], "revisions carry trusted actor, operation and definition");
		equal(await two.readRevision(actor, revisionA.id), revisionA, "keyed revision read is exact");
		const firstPage = await two.listRevisions(actor, {
			entry: lesson,
			limit: 2
		});
		const secondPage = await two.listRevisions(actor, {
			entry: lesson,
			limit: 2,
			cursor: firstPage.nextCursor
		});
		equal([
			firstPage.revisions.length,
			firstPage.nextCursor,
			secondPage.revisions.map((revision) => revision.id),
			secondPage.nextCursor
		], [
			2,
			"2",
			[original.id],
			null
		], "history pages by sequence");
		const diff = await two.compareRevisions(actor, {
			entry: lesson,
			from: { revisionId: revisionA.id },
			to: { perspective: "working" }
		});
		equal(diff.differences, [{
			fieldId: "title",
			key: "title",
			label: "Title",
			removedFromDefinition: false,
			change: "changed",
			before: "A",
			after: "B"
		}], "field comparison names the changed field");
		const beforeNoOp = await a.dump();
		const current = await two.readState(actor);
		await two.execute(actor, edit(current, "history-noop", "B"));
		const afterNoOp = await a.dump();
		equal([afterNoOp.revisions.length, afterNoOp.state], [beforeNoOp.revisions.length, beforeNoOp.state], "a no-op save writes no revision and keeps the draft");
		const restore = {
			kind: "restore-revision",
			operationKey: "history-restore",
			expected: identities(current),
			entry: lesson,
			revisionId: revisionA.id
		};
		a.faultNextCommit("lost-acknowledgement");
		let lost = false;
		try {
			await one.execute(actor, restore);
		} catch {
			lost = true;
		}
		assert(lost, "restore acknowledgement loss surfaces uncertainty");
		const restored = await two.execute(actor, clone(restore));
		equal(await two.execute(actor, clone(restore)), restored, "restore retry replays its receipt");
		const restoredHistory = (await two.listRevisions(actor, { entry: lesson })).revisions;
		equal(restoredHistory.map((revision) => revision.sequence), [
			4,
			3,
			2,
			1
		], "restore appends exactly one revision and keeps the rest");
		equal([
			restoredHistory[0].values,
			restoredHistory[0].restoredFrom,
			restoredHistory[0].parentId,
			restoredHistory[0].operation.kind
		], [
			revisionA.values,
			revisionA.id,
			revisionB.id,
			"restore-revision"
		], "restoring A from B creates C");
		equal([
			value(restored.state, lesson, "title"),
			restored.state.baseline.gitSha,
			(await two.readEntry(actor, {
				perspective: "published",
				entry: lesson
			})).values.title
		], [
			"A",
			"1".repeat(40),
			"A"
		], "restore keeps the active baseline");
		equal(restored.state.providers[0].entries.find((entry) => entry.id === lesson.recordId).lifecycle, current.providers[0].entries.find((entry) => entry.id === lesson.recordId).lifecycle, "restore keeps lifecycle intent");
		const stale = await a.dump();
		await errorCode(() => two.execute(actor, edit(current, "history-stale", "lost")), "revision-conflict");
		await errorCode(() => two.execute(actor, {
			kind: "restore-revision",
			operationKey: "history-stale-restore",
			expected: identities(current),
			entry: lesson,
			revisionId: revisionA.id
		}), "revision-conflict");
		equal(await a.dump(), stale, "stale save and restore keep stored work");
		const createdState = (await two.execute(actor, {
			kind: "create-entry",
			operationKey: "history-create",
			expected: identities(restored.state),
			collectionId: "lesson-faqs",
			values: {
				question: "Q",
				answer: "A"
			},
			before: null
		})).state;
		const beforeRestore = await a.dump();
		let incompatible;
		try {
			await two.execute(actor, {
				kind: "restore-revision",
				operationKey: "history-incompatible",
				expected: identities(createdState),
				entry: lesson,
				revisionId: original.id
			});
		} catch (error) {
			incompatible = error;
		}
		const diagnostics = incompatible?.restoreDiagnostics;
		equal([incompatible?.code, diagnostics?.map((item) => [item.fieldId, item.code])], ["restore-incompatible", [["faqs", "collection-owned"]]], "incompatible history reports diagnostics");
		equal(await a.dump(), beforeRestore, "an incompatible restore writes nothing");
		await backend.restart();
		const reopened = await backend.open();
		const recovered = createHostedConformanceService(reopened.storage, "history-restart");
		equal((await recovered.listRevisions(actor, { entry: lesson })).revisions, (await reopened.dump()).revisions.filter((revision) => revision.entry.recordId === lesson.recordId).reverse(), "history survives restart");
		equal([(await recovered.readEntry(actor, {
			perspective: "working",
			entry: lesson
		})).values.title, (await recovered.readEntry(actor, {
			perspective: "published",
			entry: lesson
		})).values.title], ["A", "A"], "perspectives survive restart");
	});
	return report;
}
//#endregion
export { createHostedConformanceService, createHostedContentConformancePolicy, createHostedContentConformanceSeed, createMemoryHostedConformanceFactory, createMemoryHostedStorage, hostedConformanceDigest, runHostedContentConformance };
