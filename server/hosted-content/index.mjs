import { a as isValueValidForField, c as isSafeRecordId, d as isPlainObject, f as HostedContentError, i as isContentAssetUse, l as cloneJson, n as canonicalSerialize, o as validateContentEntryRecord, r as buildContentGraphIndex, s as validateContentModelRecord, t as createHostedContentService, u as isJsonSafe } from "./chunks/service-EjK9CN-b.mjs";
import { a as hostedReadyMessage, c as hostedRenderSchema, d as matchesHostedPreviewBinding, f as readHostedPreviewRequest, h as COMPOSER_PREVIEW_PROTOCOL_VERSION, i as hostedPreviewResponseSchema, l as hostedRenderedMessage, m as COMPOSER_PREVIEW_CHANNEL, n as hostedDocumentErrorSchema, o as hostedReadySchema, p as readHostedPreviewResponse, r as hostedPreviewBindingSchema, s as hostedRenderMessage, t as hostedDocumentErrorMessage, u as hostedRenderedSchema } from "./chunks/preview-D3orPTyN.mjs";
import { parser } from "@lezer/markdown";
import { ContractValidationError, RESERVED_PERSISTED_KEYS, componentPackManifestSchema, validateFieldValue } from "@zudo-composer/component-contract";
//#region src/composer/model/types.ts
/**
* The stable slot id used when an `InsertionTarget` addresses the virtual
* document root (`document.root`). It is a pseudo-slot id, never a real
* component slot.
*/
var VIRTUAL_ROOT_SLOT_ID = "root";
function freezeContractValue(value) {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freezeContractValue(child);
		Object.freeze(value);
	}
	return value;
}
/** Parses a component pack and builds an identity-preserving lookup index. */
function createComponentCatalog(source) {
	const pack = freezeContractValue(structuredClone(componentPackManifestSchema.parse(source)));
	const entries = pack.components;
	const byId = /* @__PURE__ */ new Map();
	for (const entry of entries) {
		if (byId.has(entry.id)) throw new TypeError(`Duplicate component id: ${entry.id}`);
		byId.set(entry.id, entry);
	}
	return {
		pack,
		get: (id) => byId.get(id),
		has: (id) => byId.has(id),
		ids: () => [...byId.keys()]
	};
}
//#endregion
//#region src/composer/model/index-model.ts
/**
* Canonical slot ordering for a node: declared slots first (in manifest
* declaration order), then any extra slot ids present on the node but not
* declared (opaque/removed slots) appended in stable alphabetical order. The
* traversal AND the JSX generator both use this so tree order and source order
* agree for named-slot fixtures (an acceptance requirement).
*/
function orderedSlotIds(node, entry) {
	const present = Object.keys(node.slots);
	const declared = (entry?.slots ?? []).map((s) => s.id).filter((id) => id in node.slots);
	const declaredSet = new Set(declared);
	const extra = present.filter((id) => !declaredSet.has(id)).sort();
	return [...declared, ...extra];
}
/**
* Pre-order visit of every node. `visit` receives the node and its location.
* Children within a node are traversed in canonical slot order (see
* `orderedSlotIds`) so the flattened order is deterministic and matches source
* generation. The virtual root is not itself visited (it is not a node).
*/
function traverse(document, manifest, visit) {
	const walk = (children, parentId, slotId, depth) => {
		children.forEach((node, index) => {
			visit(node, {
				node,
				parentId,
				slotId,
				index,
				depth
			});
			const entry = manifest.get(node.componentId);
			for (const childSlotId of orderedSlotIds(node, entry)) walk(node.slots[childSlotId] ?? [], node.id, childSlotId, depth + 1);
		});
	};
	walk(document.root, null, VIRTUAL_ROOT_SLOT_ID, 0);
}
/** Builds the ephemeral index. Throws on duplicate ids (a broken invariant). */
function indexDocument(document, manifest) {
	const byId = /* @__PURE__ */ new Map();
	const order = [];
	traverse(document, manifest, (node, location) => {
		if (byId.has(node.id)) throw new Error(`Duplicate node id "${node.id}" in Composition document`);
		byId.set(node.id, location);
		order.push(node.id);
	});
	return {
		byId,
		order
	};
}
/** Resolve a node (and its location) by id, or `undefined` if absent. */
function findLocation(document, manifest, nodeId) {
	return indexDocument(document, manifest).byId.get(nodeId);
}
//#endregion
//#region src/composer/model/node-props.ts
var reservedProps = new Set(RESERVED_PERSISTED_KEYS);
function compareUnicodeCodePoints$1(left, right) {
	const leftPoints = [...left].map((point) => point.codePointAt(0));
	const rightPoints = [...right].map((point) => point.codePointAt(0));
	const length = Math.min(leftPoints.length, rightPoints.length);
	for (let index = 0; index < length; index += 1) if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
	return leftPoints.length - rightPoints.length;
}
function equalJson(left, right) {
	if (Object.is(left, right)) return true;
	if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
	if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equalJson(value, right[index]));
	const leftObject = left;
	const rightObject = right;
	const leftKeys = Object.keys(leftObject).sort(compareUnicodeCodePoints$1);
	const rightKeys = Object.keys(rightObject).sort(compareUnicodeCodePoints$1);
	return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && equalJson(leftObject[key], rightObject[key]));
}
/**
* Validate persisted scalar props against one manifest component contract.
* Static props are legitimate only when the manifest supplies their exact
* trusted default; callers cannot smuggle a replacement static value through
* a Composition document.
*/
function validateNodeProps(node, component) {
	const issues = [];
	const fields = new Map(component.fields.map((field) => [field.prop, field]));
	const slotProps = new Set(component.slots.map((slot) => slot.prop));
	const staticProps = new Set((component.staticProps ?? []).map((entry) => entry.prop));
	for (const prop of Object.keys(node.props).sort(compareUnicodeCodePoints$1)) {
		const value = node.props[prop];
		if (reservedProps.has(prop)) {
			issues.push({
				code: "reserved-prop",
				prop,
				message: `Prop "${prop}" is reserved and cannot be persisted.`
			});
			continue;
		}
		if (slotProps.has(prop)) {
			issues.push({
				code: "slot-backed-prop",
				prop,
				message: `Prop "${prop}" is structural slot content and cannot be persisted as a scalar prop.`
			});
			continue;
		}
		const field = fields.get(prop);
		if (field) {
			try {
				validateFieldValue(field, value, `$props.${prop}`);
			} catch (error) {
				if (!(error instanceof ContractValidationError)) throw error;
				issues.push({
					code: "invalid-field-value",
					prop,
					message: `Prop "${prop}" does not match its field contract: ${error.message}`
				});
			}
			continue;
		}
		if (staticProps.has(prop)) {
			if (!Object.hasOwn(component.defaults, prop) || !equalJson(value, component.defaults[prop])) issues.push({
				code: "static-prop-mismatch",
				prop,
				message: `Static prop "${prop}" must match its manifest default.`
			});
			continue;
		}
		issues.push({
			code: "unknown-prop",
			prop,
			message: `Prop "${prop}" is not declared by component "${node.componentId}".`
		});
	}
	return issues.length === 0 ? {
		ok: true,
		issues: []
	} : {
		ok: false,
		issues
	};
}
//#endregion
//#region src/composer/model/validate.ts
var reservedPersistedKeys = new Set(RESERVED_PERSISTED_KEYS);
function hasOnlyKeys(value, required, optional = []) {
	const allowed = /* @__PURE__ */ new Set([...required, ...optional]);
	return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}
function isValidNodeShape(value, seenIds, seenRefs) {
	if (!isPlainObject(value)) return false;
	if (seenRefs.has(value)) return false;
	seenRefs.add(value);
	const node = value;
	if (!hasOnlyKeys(node, [
		"id",
		"componentId",
		"componentVersion",
		"props",
		"slots"
	])) return false;
	if (typeof node.id !== "string" || node.id.length === 0) return false;
	if (seenIds.has(node.id)) return false;
	seenIds.add(node.id);
	if (typeof node.componentId !== "string" || node.componentId.length === 0) return false;
	if (typeof node.componentVersion !== "number" || !Number.isSafeInteger(node.componentVersion) || node.componentVersion <= 0) return false;
	if (!isPlainObject(node.props) || !isJsonSafe(node.props)) return false;
	if (Object.keys(node.props).some((key) => reservedPersistedKeys.has(key))) return false;
	if (!isPlainObject(node.slots)) return false;
	for (const children of Object.values(node.slots)) {
		if (!Array.isArray(children)) return false;
		for (const child of children) if (!isValidNodeShape(child, seenIds, seenRefs)) return false;
	}
	return true;
}
function isValidOutletTarget(value) {
	if (!isPlainObject(value) || !hasOnlyKeys(value, ["parentId", "slotId"])) return false;
	return typeof value.parentId === "string" && value.parentId.length > 0 && typeof value.slotId === "string" && value.slotId.length > 0;
}
function isValidOutlet(value) {
	if (!isPlainObject(value) || !hasOnlyKeys(value, [
		"id",
		"label",
		"target"
	])) return false;
	return typeof value.id === "string" && value.id.length > 0 && typeof value.label === "string" && isValidOutletTarget(value.target);
}
function isValidPublication(value) {
	if (!isPlainObject(value) || typeof value.kind !== "string") return false;
	if (value.kind === "global-template") return hasOnlyKeys(value, ["kind", "outlet"]) && isValidOutlet(value.outlet);
	return value.kind === "pattern" && hasOnlyKeys(value, ["kind"]);
}
function isValidBinding(value) {
	if (!isPlainObject(value) || !hasOnlyKeys(value, ["sourceRecordId", "outletId"])) return false;
	return isSafeRecordId(value.sourceRecordId) && typeof value.outletId === "string" && value.outletId.length > 0;
}
/**
* True when `value` is a well-formed `CompositionDocument` of the SUPPORTED
* schema version: correct shape, JSON-safe props, globally unique node ids, and
* no structural cycles. Unknown component ids do NOT fail this check.
*/
function isStructurallyValidDocument$1(value) {
	if (!isPlainObject(value) || !isJsonSafe(value)) return false;
	const doc = value;
	if (!hasOnlyKeys(doc, [
		"schemaVersion",
		"id",
		"name",
		"root"
	], ["publication", "binding"])) return false;
	if (doc.schemaVersion !== 2) return false;
	if (typeof doc.id !== "string" || doc.id.length === 0 || typeof doc.name !== "string") return false;
	if (!Array.isArray(doc.root)) return false;
	if (Object.hasOwn(doc, "publication") && !isValidPublication(doc.publication)) return false;
	if (Object.hasOwn(doc, "binding") && !isValidBinding(doc.binding)) return false;
	const seenIds = /* @__PURE__ */ new Set();
	const seenRefs = /* @__PURE__ */ new Set();
	for (const node of doc.root) if (!isValidNodeShape(node, seenIds, seenRefs)) return false;
	return true;
}
/** Classify a single node against the manifest. Pure; ignores children. */
function classifyNode(node, manifest) {
	const reasons = [];
	const entry = manifest.get(node.componentId);
	if (!entry) {
		reasons.push({
			code: "unknown-component",
			message: `Unknown component "${node.componentId}" — not in the manifest`
		});
		return {
			nodeId: node.id,
			componentId: node.componentId,
			opaque: true,
			reasons
		};
	}
	if (node.componentVersion !== entry.schemaVersion) reasons.push({
		code: "unsupported-version",
		message: `Node uses "${node.componentId}" v${node.componentVersion}, but the manifest provides v${entry.schemaVersion}`
	});
	const propValidation = validateNodeProps(node, entry);
	for (const issue of propValidation.issues) reasons.push({
		code: "invalid-prop",
		message: issue.message
	});
	const declaredIds = new Set(entry.slots.map((s) => s.id));
	for (const slotId of Object.keys(node.slots)) if (!declaredIds.has(slotId)) reasons.push({
		code: "removed-slot",
		message: `Slot "${slotId}" is no longer declared on "${node.componentId}"`,
		slotId
	});
	for (const slot of entry.slots) {
		const children = node.slots[slot.id] ?? [];
		if (slot.cardinality === "single" && children.length > 1) reasons.push({
			code: "cardinality-violation",
			message: `Slot "${slot.id}" is single but holds ${children.length} children`,
			slotId: slot.id
		});
		if (slot.max !== void 0 && children.length > slot.max) reasons.push({
			code: "cardinality-violation",
			message: `Slot "${slot.id}" holds at most ${slot.max} ${slot.max === 1 ? "child" : "children"} but holds ${children.length}`,
			slotId: slot.id
		});
		if (slot.accepts) {
			const allowed = new Set(slot.accepts);
			for (const child of children) if (!allowed.has(child.componentId)) reasons.push({
				code: "unaccepted-child",
				message: `Slot "${slot.id}" does not accept "${child.componentId}"`,
				slotId: slot.id
			});
		}
	}
	return {
		nodeId: node.id,
		componentId: node.componentId,
		opaque: reasons.length > 0,
		reasons
	};
}
/**
* Classify every node in the document. `canExport` is false when any node is
* opaque — the JSX generator uses it to refuse a misleading export rather than
* silently dropping preserved data.
*/
function diagnoseDocument(document, manifest, options = {}) {
	if (!isStructurallyValidDocument$1(document)) {
		const malformed = {
			nodeId: "__document__",
			componentId: "",
			opaque: true,
			reasons: [{
				code: "malformed-node",
				message: "Composition data is not structurally safe for rendering or export."
			}]
		};
		return {
			byId: /* @__PURE__ */ new Map([[malformed.nodeId, malformed]]),
			opaqueIds: [malformed.nodeId],
			hasOpaque: true,
			canExport: false,
			reuseReasons: [],
			hasReuseIssues: false
		};
	}
	const byId = /* @__PURE__ */ new Map();
	const nodesById = /* @__PURE__ */ new Map();
	const opaqueIds = [];
	const walk = (children) => {
		for (const node of children) {
			const diagnostic = classifyNode(node, manifest);
			byId.set(node.id, diagnostic);
			nodesById.set(node.id, node);
			if (diagnostic.opaque) opaqueIds.push(node.id);
			const entry = manifest.get(node.componentId);
			for (const slotId of orderedSlotIds(node, entry)) walk(node.slots[slotId] ?? []);
		}
	};
	walk(document.root);
	const reuseReasons = [];
	const containingRecordId = options.containingRecordId ?? document.id;
	if (document.publication && document.binding) reuseReasons.push({
		code: "publication-binding-conflict",
		message: "A Composition cannot be both a reusable source and a live consumer binding."
	});
	if (document.binding && document.binding.sourceRecordId === containingRecordId) reuseReasons.push({
		code: "self-binding",
		message: "A Composition cannot bind to itself as its Global template source."
	});
	if (document.publication?.kind === "pattern" && document.root.length === 0) reuseReasons.push({
		code: "empty-pattern-root",
		message: "A Pattern must retain at least one root component before it can be offered for insertion."
	});
	if (document.publication?.kind === "global-template") {
		const { parentId, slotId } = document.publication.outlet.target;
		const parent = nodesById.get(parentId);
		const targetDeclared = (parent ? manifest.get(parent.componentId) : void 0)?.slots.some((slot) => slot.id === slotId) ?? false;
		const targetChildren = parent?.slots[slotId];
		if (!parent || !targetDeclared || targetChildren !== void 0 && targetChildren.length > 0) reuseReasons.push({
			code: "stale-outlet-target",
			message: `Global template outlet target "${parentId}/${slotId}" is no longer a declared empty component slot.`
		});
	}
	return {
		byId,
		opaqueIds,
		hasOpaque: opaqueIds.length > 0,
		canExport: opaqueIds.length === 0,
		reuseReasons,
		hasReuseIssues: reuseReasons.length > 0
	};
}
function rootMaxError(max) {
	return `The bound Global template outlet holds at most ${max} root ${max === 1 ? "component" : "components"}`;
}
/** Validate an existing consumer-root forest against a resolved source outlet. */
function validateRootForest(roots, policy) {
	if (policy.kind === "unrestricted") return { ok: true };
	if (policy.kind === "unresolved") return {
		ok: false,
		error: "Cannot insert at the consumer root until its Global template outlet is resolved"
	};
	if (policy.cardinality === "single" && roots.length > 1) return {
		ok: false,
		error: "The bound Global template outlet accepts only one root component"
	};
	if (policy.max !== void 0 && roots.length > policy.max) return {
		ok: false,
		error: rootMaxError(policy.max)
	};
	if (policy.accepts) {
		for (const root of roots) if (!policy.accepts.includes(root.componentId)) return {
			ok: false,
			error: `The bound Global template outlet does not accept "${root.componentId}" at the consumer root`
		};
	}
	return { ok: true };
}
//#endregion
//#region src/composer/reuse/materialize.ts
/**
* Encode arbitrary string identities without relying on URI encoding (which
* rejects lone surrogate code units). The result is safe to concatenate into a
* runtime key and injective for all JavaScript strings.
*/
function identitySegment(value) {
	return Array.from(value, (character) => character.codePointAt(0).toString(16).padStart(6, "0")).join("");
}
function createLocalRuntimeOwner(recordId) {
	return {
		kind: "local",
		recordId,
		namespace: `local:${identitySegment(recordId)}`
	};
}
function createGlobalTemplateRuntimeOwner(sourceRecordId) {
	return {
		kind: "global-template",
		sourceRecordId,
		namespace: `global-template:${identitySegment(sourceRecordId)}`
	};
}
/** Stable owner-qualified identity for runtime keys, DOM attributes, and error boundaries. */
function materializedRuntimeKey(owner, nodeId) {
	return `${owner.namespace}:node:${identitySegment(nodeId)}`;
}
function cloneDocument$1(document) {
	return cloneJson(document);
}
function cloneOutlet(outlet) {
	return cloneJson(outlet);
}
function sameTarget(a, b) {
	return a.parentId === b.parentId && a.slotId === b.slotId;
}
function sameBinding$1(a, b) {
	return a.sourceRecordId === b.sourceRecordId && a.outletId === b.outletId;
}
/** The resolver guarantees this normally; materialization rechecks stale input before replacing a slot. */
function hasEmptyOutletTarget(document, outlet) {
	let found = false;
	let empty = false;
	const visit = (nodes) => {
		for (const node of nodes) {
			if (node.id === outlet.target.parentId) {
				found = true;
				const children = node.slots[outlet.target.slotId];
				empty = children === void 0 || Array.isArray(children) && children.length === 0;
			}
			for (const children of Object.values(node.slots)) visit(children);
		}
	};
	visit(document.root);
	return found && empty;
}
function materializeNodes(nodes, owner, outlet, localNodes, localOwner, projection) {
	return nodes.map((node) => {
		const slots = {};
		const ownsOutlet = outlet !== void 0 && node.id === outlet.target.parentId;
		let projectedOutlet = false;
		for (const [slotId, children] of Object.entries(node.slots)) if (ownsOutlet && slotId === outlet.target.slotId) {
			projectedOutlet = true;
			projection.count += 1;
			slots[slotId] = materializeNodes(localNodes, localOwner, void 0, [], localOwner, { count: 0 });
		} else slots[slotId] = materializeNodes(children, owner, outlet, localNodes, localOwner, projection);
		if (ownsOutlet && !projectedOutlet) {
			projection.count += 1;
			slots[outlet.target.slotId] = materializeNodes(localNodes, localOwner, void 0, [], localOwner, { count: 0 });
		}
		return {
			id: node.id,
			componentId: node.componentId,
			componentVersion: node.componentVersion,
			props: cloneJson(node.props),
			slots,
			owner: { ...owner },
			runtimeKey: materializedRuntimeKey(owner, node.id)
		};
	});
}
function localView(consumer) {
	const localDocument = cloneDocument$1(consumer.document);
	const localRuntime = createLocalRuntimeOwner(consumer.id);
	return {
		localDocument,
		localRuntime,
		renderRoot: materializeNodes(localDocument.root, localRuntime, void 0, [], localRuntime, { count: 0 })
	};
}
function diagnosticMessage(status) {
	switch (status) {
		case "missing-template": return "The linked Global template is unavailable.";
		case "missing-outlet": return "The linked Global template no longer exposes this outlet.";
		case "invalid-template": return "The linked Global template is invalid.";
		case "nested-template": return "Linked Global templates cannot nest.";
		case "self-reference": return "A Composition cannot use itself as its Global template.";
		case "incompatible-local-root": return "The local root does not fit the linked Global template outlet.";
		case "invalid-materialization": return "The linked Global template could not be materialized safely.";
	}
}
function blockedView(consumer, binding, code) {
	const output = {
		preview: "blocked",
		export: "blocked"
	};
	const affordances = {
		retry: true,
		detach: "remove-broken-binding"
	};
	return {
		status: "blocked",
		...localView(consumer),
		output,
		affordances,
		diagnostic: {
			code,
			message: diagnosticMessage(code),
			binding: cloneJson(binding),
			output,
			affordances
		}
	};
}
/**
* Recheck the resolved contract before projection. Normal flows receive this
* union from the resolver, but this guard keeps manually edited/stale records
* deterministic instead of recursing through malformed source data.
*/
function resolvedProjection(consumer, resolution) {
	const binding = consumer.document.binding;
	if (!binding || !sameBinding$1(binding, resolution.binding)) return { message: "The consumer binding no longer matches the resolved result." };
	if (!isStructurallyValidDocument$1(consumer.document) || !isStructurallyValidDocument$1(resolution.source.document)) return { message: "The source or consumer document is structurally invalid." };
	if (resolution.source.id !== binding.sourceRecordId || resolution.source.id === consumer.id) return { message: "The resolved source identity is invalid." };
	if (resolution.source.document.binding) return { message: "A Global template source cannot itself be bound to another template." };
	const publication = resolution.source.document.publication;
	if (publication?.kind !== "global-template" || publication.outlet.id !== binding.outletId || publication.outlet.id !== resolution.outlet.id || publication.outlet.label !== resolution.outlet.label || !sameTarget(publication.outlet.target, resolution.outlet.target) || !hasEmptyOutletTarget(resolution.source.document, publication.outlet)) return { message: "The resolved source no longer exposes the requested outlet." };
	return {
		localDocument: cloneDocument$1(consumer.document),
		sourceDocument: cloneDocument$1(resolution.source.document),
		sourceRecordId: resolution.source.id,
		outlet: cloneOutlet(publication.outlet)
	};
}
function isProjectionFailure(value) {
	return "message" in value;
}
/**
* Materialize a strict JSON preview/view input from a canonical consumer and a
* resolver result. A resolved result carries both clone-owned documents and a
* transient projected tree; every other binding outcome renders local content
* bare and blocks only linked preview/export.
*/
function materializeGlobalTemplateView(consumer, resolution) {
	if (resolution.status === "unbound") {
		if (consumer.document.binding) return blockedView(consumer, consumer.document.binding, "invalid-materialization");
		return {
			status: "local",
			...localView(consumer),
			output: {
				preview: "available",
				export: "available"
			},
			affordances: {
				retry: false,
				detach: "none"
			}
		};
	}
	if (!consumer.document.binding) return {
		status: "local",
		...localView(consumer),
		output: {
			preview: "available",
			export: "available"
		},
		affordances: {
			retry: false,
			detach: "none"
		}
	};
	if (resolution.status !== "resolved") return blockedView(consumer, consumer.document.binding, sameBinding$1(consumer.document.binding, resolution.binding) ? resolution.status : "invalid-materialization");
	const projection = resolvedProjection(consumer, resolution);
	if (isProjectionFailure(projection)) return blockedView(consumer, resolution.binding, "invalid-materialization");
	const localRuntime = createLocalRuntimeOwner(consumer.id);
	const sourceRuntime = createGlobalTemplateRuntimeOwner(projection.sourceRecordId);
	const outletProjection = { count: 0 };
	const renderRoot = materializeNodes(projection.sourceDocument.root, sourceRuntime, projection.outlet, projection.localDocument.root, localRuntime, outletProjection);
	if (outletProjection.count !== 1) return blockedView(consumer, resolution.binding, "invalid-materialization");
	return {
		status: "resolved",
		localDocument: projection.localDocument,
		localRuntime,
		sourceDocument: projection.sourceDocument,
		sourceRuntime,
		outlet: projection.outlet,
		renderRoot,
		localRootTarget: {
			owner: localRuntime,
			parentId: null,
			slotId: VIRTUAL_ROOT_SLOT_ID
		},
		output: {
			preview: "available",
			export: "available"
		},
		affordances: {
			retry: false,
			detach: "snapshot"
		}
	};
}
//#endregion
//#region src/composer/reuse/resolver.ts
function base(consumer) {
	return {
		binding: consumer.document.binding,
		localRoot: consumer.document.root
	};
}
/**
* Pure, non-mutating source/outlet validation. The parent provider adapter
* supplies a saved source record; this layer has no storage or framework I/O.
*/
function resolveGlobalTemplate(options) {
	const { consumer, source, manifest } = options;
	const binding = consumer.document.binding;
	if (!binding) return {
		status: "unbound",
		binding: void 0,
		localRoot: consumer.document.root
	};
	const preserved = base(consumer);
	if (binding.sourceRecordId === consumer.id) return {
		status: "self-reference",
		...preserved
	};
	if (source.id !== binding.sourceRecordId) return {
		status: "missing-template",
		reason: "source-id-mismatch",
		...preserved
	};
	if (source.document.binding) return {
		status: "nested-template",
		source,
		...preserved
	};
	const publication = source.document.publication;
	if (publication?.kind !== "global-template") return {
		status: "invalid-template",
		source,
		reason: "not-global-template",
		...preserved
	};
	const outlet = publication.outlet;
	if (outlet.id !== binding.outletId) return {
		status: "missing-outlet",
		source,
		...preserved
	};
	if (!diagnoseDocument(source.document, manifest).canExport) return {
		status: "invalid-template",
		source,
		reason: "invalid-outlet-target",
		...preserved
	};
	const owner = findLocation(source.document, manifest, outlet.target.parentId)?.node;
	const entry = owner ? manifest.get(owner.componentId) : void 0;
	const slot = entry?.slots.find((candidate) => candidate.id === outlet.target.slotId);
	if (!owner || !entry || !slot || (owner.slots[outlet.target.slotId]?.length ?? 0) > 0) return {
		status: "invalid-template",
		source,
		reason: "invalid-outlet-target",
		...preserved
	};
	const rootPolicy = {
		kind: "resolved",
		...slot.accepts ? { accepts: [...slot.accepts] } : {},
		cardinality: slot.cardinality,
		...slot.min === void 0 ? {} : { min: slot.min },
		...slot.max === void 0 ? {} : { max: slot.max },
		origin: {
			componentId: entry.id,
			componentTitle: entry.title,
			slotId: slot.id,
			slotLabel: slot.label,
			viaTemplate: {
				sourceName: source.document.name,
				outletLabel: outlet.label
			}
		}
	};
	const localValidation = validateRootForest(consumer.document.root, rootPolicy);
	if (!localValidation.ok) return {
		status: "incompatible-local-root",
		source,
		outlet,
		rootPolicy,
		message: localValidation.error ?? "The local roots do not fit the published outlet.",
		...preserved
	};
	return {
		status: "resolved",
		source,
		outlet,
		rootPolicy,
		...preserved
	};
}
/** Map a provider load outcome into the same deterministic, content-preserving resolution union. */
function resolveGlobalTemplateLoad(consumer, source, manifest) {
	const binding = consumer.document.binding;
	if (!binding) return {
		status: "unbound",
		binding: void 0,
		localRoot: consumer.document.root
	};
	const preserved = base(consumer);
	if (binding.sourceRecordId === consumer.id) return {
		status: "self-reference",
		...preserved
	};
	if (source.status === "not-found") return {
		status: "missing-template",
		reason: "not-found",
		...preserved
	};
	if (source.status === "invalid") return {
		status: "missing-template",
		reason: "invalid-record",
		...preserved
	};
	if (source.status === "future-schema") return {
		status: "missing-template",
		reason: "future-schema",
		...preserved
	};
	return resolveGlobalTemplate({
		consumer,
		source: source.record,
		manifest
	});
}
//#endregion
//#region src/browser/asset-download.mjs
/**
* Self-contained browser handler. JSX export embeds this function's source,
* so keep every dependency inside the function or on browser globals.
* @param {MouseEvent} event
* @param {number} maxBytes
*/
async function downloadAsset(event, maxBytes) {
	if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
	const anchor = event.currentTarget;
	if (!(anchor instanceof HTMLAnchorElement)) return;
	event.preventDefault();
	if (anchor.getAttribute("aria-busy") === "true") return;
	let status = anchor.querySelector("[data-asset-download-status]");
	if (!status || status.getAttribute("data-asset-download-status") !== "true") {
		status = document.createElement("span");
		status.setAttribute("data-asset-download-status", "true");
		status.setAttribute("role", "status");
		anchor.append(status);
	}
	status.textContent = " Downloading…";
	anchor.setAttribute("aria-busy", "true");
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 3e4);
	let reader;
	try {
		const url = new URL(anchor.href, document.baseURI);
		if (url.origin !== location.origin || url.protocol !== "blob:" && !/^\/uploaded-assets\/sha256-[a-f0-9]{64}\.[a-z0-9]+$/.test(url.pathname)) throw new Error("Invalid asset URL");
		const response = await fetch(url.href, {
			signal: controller.signal,
			credentials: "same-origin",
			redirect: "error"
		});
		if (!response.ok || !response.body || Number(response.headers.get("content-length")) > maxBytes) throw new Error("Asset unavailable or too large");
		reader = response.body.getReader();
		const chunks = [];
		let size = 0;
		for (;;) {
			const { value, done } = await reader.read();
			if (done || !value) break;
			size += value.byteLength;
			if (size > maxBytes) {
				await reader.cancel();
				throw new Error("Asset too large");
			}
			chunks.push(new Uint8Array(value).buffer);
		}
		const blob = new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" });
		const objectUrl = URL.createObjectURL(blob);
		const temporary = document.createElement("a");
		temporary.href = objectUrl;
		temporary.download = anchor.download;
		temporary.hidden = true;
		try {
			document.body.append(temporary);
			temporary.click();
		} finally {
			temporary.remove();
			setTimeout(() => URL.revokeObjectURL(objectUrl), 1e3);
		}
		status.textContent = " Download started.";
	} catch {
		status.textContent = " Download failed. Select the link to retry.";
	} finally {
		controller.abort();
		reader?.releaseLock();
		clearTimeout(timeout);
		anchor.removeAttribute("aria-busy");
	}
}
//#endregion
//#region src/assets/model/asset-kinds.mjs
/** @typedef {"image" | "document" | "archive" | "text"} AssetKindName */
/** @typedef {{ extension: string, kind: AssetKindName, previewable: boolean, inline: boolean }} AssetKindDescriptor */
/** @type {Readonly<Record<string, AssetKindDescriptor>>} */
var ASSET_KINDS = Object.freeze({
	"image/png": Object.freeze({
		extension: "png",
		kind: "image",
		previewable: true,
		inline: true
	}),
	"image/jpeg": Object.freeze({
		extension: "jpg",
		kind: "image",
		previewable: true,
		inline: true
	}),
	"image/gif": Object.freeze({
		extension: "gif",
		kind: "image",
		previewable: true,
		inline: true
	}),
	"image/webp": Object.freeze({
		extension: "webp",
		kind: "image",
		previewable: true,
		inline: true
	}),
	"application/pdf": Object.freeze({
		extension: "pdf",
		kind: "document",
		previewable: true,
		inline: true
	}),
	"application/zip": Object.freeze({
		extension: "zip",
		kind: "archive",
		previewable: false,
		inline: false
	}),
	"text/plain": Object.freeze({
		extension: "txt",
		kind: "text",
		previewable: false,
		inline: false
	}),
	"text/csv": Object.freeze({
		extension: "csv",
		kind: "text",
		previewable: false,
		inline: false
	}),
	"application/json": Object.freeze({
		extension: "json",
		kind: "text",
		previewable: false,
		inline: false
	})
});
/** @type {readonly string[]} */
var ASSET_TYPES = Object.freeze(Object.keys(ASSET_KINDS));
/** @type {Readonly<Record<string, string>>} */
var ASSET_EXTENSION_BY_TYPE = Object.freeze(Object.fromEntries(Object.entries(ASSET_KINDS).map(([mimeType, descriptor]) => [mimeType, descriptor.extension])));
Object.freeze(Object.fromEntries(Object.entries(ASSET_KINDS).map(([mimeType, descriptor]) => [descriptor.extension, mimeType])));
var extensionAlternation = [...new Set(Object.values(ASSET_KINDS).map(({ extension }) => extension))].map((extension) => extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
ASSET_TYPES.join(",");
/** Regex source for one checksum-derived file name, without anchors. */
var ASSET_CHECKSUM_FILE_NAME_SOURCE = `sha256-[a-f0-9]{64}\\.(?:${extensionAlternation})`;
/** Regex source for one checksum-derived asset URL, without anchors. */
var ASSET_CHECKSUM_URL_SOURCE = `/uploaded-assets/${ASSET_CHECKSUM_FILE_NAME_SOURCE}`;
new RegExp(`^${ASSET_CHECKSUM_FILE_NAME_SOURCE}$`);
var ASSET_CHECKSUM_URL_PATTERN = new RegExp(`^${ASSET_CHECKSUM_URL_SOURCE}$`);
new RegExp(`^asset-${ASSET_CHECKSUM_FILE_NAME_SOURCE}$`);
/** @param {string} mimeType @returns {AssetKindDescriptor | undefined} */
function assetKindForMime(mimeType) {
	return ASSET_KINDS[mimeType];
}
//#endregion
//#region src/assets/model/types.ts
/** The upload ceiling used by the Assets transport and filesystem providers. */
var ASSET_MAX_BYTE_LENGTH = 26214400;
/** Lowercase hexadecimal SHA-256 digest. */
var ASSET_CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;
function assetVersionUrl(checksum, mimeType) {
	return `/uploaded-assets/sha256-${checksum}.${ASSET_EXTENSION_BY_TYPE[mimeType]}`;
}
/** Authoring references retain asset identity; release uses exact version URLs. */
function assetAuthoringUrl(assetId) {
	return `/uploaded-assets/asset-${assetId}`;
}
//#endregion
//#region src/assets/model/validate.ts
var FILE_NAME_SEPARATOR_PATTERN = /[\\/]/u;
/** Exact own-key check used at every persisted object boundary. */
function exactKeys$1(value, keys) {
	return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function hasControlCharacter(value) {
	return Array.from(value).some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint <= 31 || codePoint >= 127 && codePoint <= 159;
	});
}
function isValidAssetType(value) {
	return typeof value === "string" && ASSET_TYPES.includes(value);
}
function isValidAssetFileName(value) {
	if (typeof value !== "string" || value.trim().length === 0) return false;
	if (Array.from(value).length > 255) return false;
	if (hasControlCharacter(value) || FILE_NAME_SEPARATOR_PATTERN.test(value)) return false;
	return true;
}
function isValidAssetByteLength(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 26214400;
}
function isValidAssetChecksum(value) {
	return typeof value === "string" && ASSET_CHECKSUM_PATTERN.test(value);
}
function assetPinKey(ref) {
	return JSON.stringify([
		ref.providerId,
		ref.assetId,
		ref.versionId
	]);
}
function validateAssetAssetRef(value) {
	return isPlainObject(value) && exactKeys$1(value, ["providerId", "assetId"]) && isSafeRecordId(value.providerId) && isSafeRecordId(value.assetId);
}
function validateAssetVersionRef(value) {
	return isPlainObject(value) && exactKeys$1(value, [
		"providerId",
		"assetId",
		"versionId"
	]) && validateAssetAssetRef({
		providerId: value.providerId,
		assetId: value.assetId
	}) && isValidAssetChecksum(value.versionId);
}
function validateAssetVersionPin(value, expected) {
	if (!isPlainObject(value) || !exactKeys$1(value, [
		"providerId",
		"assetId",
		"versionId",
		"checksum",
		"byteLength",
		"mimeType",
		"url"
	])) return false;
	const ref = {
		providerId: value.providerId,
		assetId: value.assetId,
		versionId: value.versionId
	};
	return validateAssetVersionRef(ref) && value.checksum === ref.versionId && isValidAssetType(value.mimeType) && isValidAssetByteLength(value.byteLength) && value.byteLength > 0 && value.url === assetVersionUrl(ref.versionId, value.mimeType) && (expected === void 0 || validateAssetVersionRef(expected) && assetPinKey(ref) === assetPinKey(expected));
}
//#endregion
//#region src/assets/model/presentation.ts
function assetTypeLabel(mimeType) {
	const extension = assetKindForMime(mimeType)?.extension;
	return extension === "jpg" ? "JPEG" : (extension ?? mimeType.slice(mimeType.indexOf("/") + 1)).toUpperCase();
}
Object.keys(ASSET_KINDS).map(assetTypeLabel).join(", ");
/** A display name may already contain an extension, including a stale one after replacement. */
function assetDownloadFileName(fileName, mimeType) {
	const extension = assetKindForMime(mimeType)?.extension;
	const safe = fileName.replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim();
	if (!extension) return safe || "download";
	const knownExtensions = /* @__PURE__ */ new Set([...Object.values(ASSET_KINDS).map(({ extension }) => extension), "jpeg"]);
	const suffix = safe.slice(safe.lastIndexOf(".") + 1).toLowerCase();
	const stem = (safe.includes(".") && knownExtensions.has(suffix) ? safe.slice(0, safe.lastIndexOf(".")) : safe).replace(/\.+$/, "") || "download";
	return `${Array.from(stem).slice(0, 255 - extension.length - 1).join("")}.${extension}`;
}
function assetByteLabel(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
	return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}
//#endregion
//#region src/assets/integration/download.ts
var PREFIX = "<!--zudo-asset-download:";
function assetDownloadMarkdown(use, resolved) {
	return `${PREFIX}${encodeURIComponent(JSON.stringify({
		use,
		...resolved ? { resolved } : {}
	}))}-->`;
}
function validResolved(value) {
	if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== "byteLength,fileName,mimeType,url") return false;
	const item = value;
	return typeof item.url === "string" && ASSET_CHECKSUM_URL_PATTERN.test(item.url) && !!assetKindForMime(item.mimeType) && item.url === assetVersionUrl(item.url.slice(24).split(".")[0], item.mimeType) && isValidAssetFileName(item.fileName) && item.fileName === assetDownloadFileName(item.fileName, item.mimeType) && isValidAssetByteLength(item.byteLength);
}
function parseAssetDownloadBlock(source) {
	if (!source.startsWith(PREFIX) || !source.endsWith("-->")) return void 0;
	try {
		const value = JSON.parse(decodeURIComponent(source.slice(24, -3)));
		if (!value || typeof value !== "object" || !["use", "resolved,use"].includes(Object.keys(value).sort().join(",")) || !isContentAssetUse(value.use) || value.use.kind !== "download") return void 0;
		if ("resolved" in value && !validResolved(value.resolved)) return void 0;
		return value;
	} catch {
		return;
	}
}
/** Only standalone top-level blocks, never code fences, inline text or raw HTML attributes. */
function assetDownloadBlocks(source) {
	const blocks = [];
	if (!source.includes(PREFIX)) return blocks;
	parser.parse(source).iterate({ enter(node) {
		if (node.name !== "CommentBlock" || node.node.parent?.name !== "Document") return;
		const raw = source.slice(node.from, node.to).trimEnd();
		if (raw.startsWith(PREFIX)) blocks.push({
			from: node.from,
			to: node.from + raw.length,
			block: parseAssetDownloadBlock(raw)
		});
	} });
	return blocks;
}
function splitAssetDownloadMarkdown(source) {
	const parts = [];
	let offset = 0;
	for (const item of assetDownloadBlocks(source)) {
		if (!item.block) continue;
		if (item.from > offset) parts.push({ markdown: source.slice(offset, item.from) });
		parts.push({ block: item.block });
		offset = item.to;
	}
	if (offset < source.length || !parts.length) parts.push({ markdown: source.slice(offset) });
	if (parts.some((part) => "block" in part)) {
		const definitions = [];
		parser.parse(source).iterate({ enter(node) {
			if (node.name === "LinkReference") definitions.push(source.slice(node.from, node.to));
		} });
		if (definitions.length) {
			for (const part of parts) if ("markdown" in part && part.markdown.trim()) part.markdown = `${definitions.join("\n")}\n\n${part.markdown}`;
		}
	}
	return parts;
}
function downloadMarkdownProperty(definition, props) {
	if (definition.slots.length || definition.fields.length !== 1) return void 0;
	const field = definition.fields[0];
	return field.schema.type === "string" && field.editor.kind === "text" && field.editor.mode === "markdown-source" && typeof props[field.prop] === "string" ? field.prop : void 0;
}
function assetDownloadLabel(block) {
	return [
		block.use.label,
		block.resolved && block.use.showType ? assetTypeLabel(block.resolved.mimeType) : "",
		block.resolved && block.use.showSize ? assetByteLabel(block.resolved.byteLength) : ""
	].filter(Boolean).join(" · ");
}
//#endregion
//#region src/composer/source/generate-jsx.ts
var SIMPLE_STRING = /^[^\\"<>{}&\x00-\x1F\x7F]*$/;
var VALID_JSX_ATTR_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*(-[A-Za-z0-9_$]+)*$/;
function renderScalarAttr(name, value) {
	if (value === void 0) return null;
	if (value === null) return `${name}={null}`;
	switch (typeof value) {
		case "string": return SIMPLE_STRING.test(value) ? `${name}="${value}"` : `${name}={${JSON.stringify(value)}}`;
		case "number": return Number.isFinite(value) ? `${name}={${value}}` : null;
		case "boolean": return `${name}={${value}}`;
		case "object": return `${name}={${JSON.stringify(value)}}`;
		default: return null;
	}
}
function indentLines(lines, spaces) {
	const pad = " ".repeat(spaces);
	return lines.map((line) => line.length ? pad + line : line);
}
function planImports(componentIds, manifest, reserved) {
	const sorted = [...componentIds].sort((a, b) => {
		const sa = manifest.get(a).source;
		const sb = manifest.get(b).source;
		return sa.module.localeCompare(sb.module) || sa.exportName.localeCompare(sb.exportName) || a.localeCompare(b);
	});
	const used = new Set(reserved);
	const plan = /* @__PURE__ */ new Map();
	const byExportKey = /* @__PURE__ */ new Map();
	for (const componentId of sorted) {
		const src = manifest.get(componentId).source;
		const exportKey = `${src.exportKind}:${src.module}#${src.exportName}`;
		const shared = byExportKey.get(exportKey);
		if (shared) {
			plan.set(componentId, shared);
			continue;
		}
		let local = src.localName ?? src.exportName;
		if (used.has(local)) {
			let i = 2;
			while (used.has(`${local}_${i}`)) i += 1;
			local = `${local}_${i}`;
		}
		used.add(local);
		const importPlan = {
			componentId,
			module: src.module,
			exportKind: src.exportKind,
			exportName: src.exportName,
			localName: local
		};
		byExportKey.set(exportKey, importPlan);
		plan.set(componentId, importPlan);
	}
	return plan;
}
function buildImportLines(plans) {
	const byModule = /* @__PURE__ */ new Map();
	for (const plan of plans) {
		const group = byModule.get(plan.module) ?? { named: [] };
		if (plan.exportKind === "default") group.def = plan;
		else group.named.push(plan);
		byModule.set(plan.module, group);
	}
	const lines = [];
	for (const module of [...byModule.keys()].sort()) {
		const group = byModule.get(module);
		const parts = [];
		if (group.def) parts.push(group.def.localName);
		if (group.named.length) {
			const specs = [...group.named].sort((a, b) => a.exportName.localeCompare(b.exportName)).map((n) => n.exportName === n.localName ? n.exportName : `${n.exportName} as ${n.localName}`);
			parts.push(`{ ${specs.join(", ")} }`);
		}
		lines.push(`import ${parts.join(", ")} from "${module}";`);
	}
	return lines;
}
function toIdentifier(name, fallback) {
	const cleaned = name.replace(/[^A-Za-z0-9]/g, " ").trim();
	if (!cleaned) return fallback;
	const pascal = cleaned.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
	return /^[A-Za-z_]/.test(pascal) ? pascal : fallback;
}
/**
* Generate a deterministic Preact JSX module. See the file header for the full
* determinism/escaping contract.
*/
function generateJsx(document, manifest, options = {}) {
	const diagnostics = diagnoseDocument(document, manifest);
	if (!diagnostics.canExport) return {
		ok: false,
		blocked: true,
		code: "",
		diagnostics,
		imports: [],
		emittedNodeOrder: []
	};
	const inspectDownloads = (nodes) => {
		for (const node of nodes) {
			const definition = manifest.get(node.componentId);
			const props = {
				...definition?.defaults,
				...node.props
			};
			const property = definition && downloadMarkdownProperty(definition, props);
			if (definition?.fields.some((field) => field.editor.kind === "text" && field.editor.mode === "markdown-source" && typeof props[field.prop] === "string" && assetDownloadBlocks(String(props[field.prop])).some(({ block }) => property !== field.prop || !block || !block.resolved && !options.allowUnresolvedAssetDownloads))) {
				const prior = diagnostics.byId.get(node.id);
				diagnostics.byId.set(node.id, {
					nodeId: node.id,
					componentId: node.componentId,
					opaque: true,
					reasons: [...prior?.reasons ?? [], {
						code: "invalid-prop",
						message: "Resolve Assets downloads to exact versions before exporting this Markdown field."
					}]
				});
				if (!diagnostics.opaqueIds.includes(node.id)) diagnostics.opaqueIds.push(node.id);
				diagnostics.hasOpaque = true;
				diagnostics.canExport = false;
			}
			Object.values(node.slots).forEach(inspectDownloads);
		}
	};
	inspectDownloads(document.root);
	const componentName = toIdentifier(options.componentName ?? document.name ?? "Composition", "Composition");
	const componentExport = options.componentExport ?? "named";
	const linkedOutlet = options.linkedOutlet;
	if (!diagnostics.canExport) return {
		ok: false,
		blocked: true,
		code: "",
		diagnostics,
		imports: [],
		emittedNodeOrder: []
	};
	const usedComponentIds = /* @__PURE__ */ new Set();
	const emittedNodeOrder = [];
	const collect = (children) => {
		for (const node of children) {
			usedComponentIds.add(node.componentId);
			const entry = manifest.get(node.componentId);
			for (const slotId of orderedSlotIds(node, entry)) collect(node.slots[slotId] ?? []);
		}
	};
	collect(document.root);
	const reserved = /* @__PURE__ */ new Set([componentName, ...options.reservedIdentifiers ?? []]);
	if (linkedOutlet) reserved.add("CompositionOutlets");
	let downloadHandlerName = "__zudoAssetDownload";
	while (reserved.has(downloadHandlerName)) downloadHandlerName += "_";
	reserved.add(downloadHandlerName);
	let hasDownloads = false;
	const plan = planImports([...usedComponentIds], manifest, reserved);
	const uniqueImportPlans = [...new Set(plan.values())];
	const tagOf = (componentId) => plan.get(componentId).localName;
	const renderNode = (node, chunk = false) => {
		if (!chunk) emittedNodeOrder.push(node.id);
		const entry = manifest.get(node.componentId);
		const tag = tagOf(node.componentId);
		const markdownProp = downloadMarkdownProperty(entry, {
			...entry.defaults,
			...node.props
		});
		if (!chunk && markdownProp) {
			const parts = splitAssetDownloadMarkdown(String(node.props[markdownProp] ?? entry.defaults[markdownProp]));
			if (parts.some((part) => "block" in part)) return [
				"<>",
				...indentLines(parts.flatMap((part) => {
					if ("markdown" in part) return part.markdown.trim() ? renderNode({
						...node,
						props: {
							...node.props,
							[markdownProp]: part.markdown
						}
					}, true) : [];
					if (!part.block.resolved) return ["<span role=\"status\">Download unavailable</span>"];
					hasDownloads = true;
					return [`<a onClick={(event) => { void ${downloadHandlerName}(event, ${ASSET_MAX_BYTE_LENGTH}); }} ${renderScalarAttr("aria-label", assetDownloadLabel(part.block))} ${renderScalarAttr("href", part.block.resolved.url)} ${renderScalarAttr("download", part.block.resolved.fileName)}>{${JSON.stringify(assetDownloadLabel(part.block))}}</a>`];
				}), 2),
				"</>"
			];
		}
		const slotProps = new Set(entry.slots.map((s) => s.prop));
		const textChildProp = (entry.slots.some((s) => s.prop === "children") ? void 0 : entry.fields.find((f) => f.prop === "children" && f.editor.kind === "text"))?.prop;
		const emittedProps = /* @__PURE__ */ new Set();
		const scalarAttrs = [];
		const pushScalar = (prop) => {
			if (emittedProps.has(prop)) return;
			if (prop === textChildProp || slotProps.has(prop)) return;
			if (!(prop in node.props)) return;
			if (!VALID_JSX_ATTR_NAME.test(prop)) return;
			const attr = renderScalarAttr(prop, node.props[prop]);
			if (attr !== null) scalarAttrs.push(attr);
			emittedProps.add(prop);
		};
		for (const field of entry.fields) pushScalar(field.prop);
		for (const prop of Object.keys(node.props).sort()) pushScalar(prop);
		const namedAttrLines = [];
		const structuralChildBlocks = [];
		const slotNode = linkedOutlet?.target.parentId === node.id ? {
			...node,
			slots: {
				[linkedOutlet.target.slotId]: [],
				...node.slots
			}
		} : node;
		for (const slotId of orderedSlotIds(slotNode, entry)) {
			const slot = entry.slots.find((s) => s.id === slotId);
			if (!slot) continue;
			const children = node.slots[slotId] ?? [];
			const linkedOutletExpression = linkedOutlet !== void 0 && node.id === linkedOutlet.target.parentId && slotId === linkedOutlet.target.slotId ? `outlets[${JSON.stringify(linkedOutlet.id)}]` : void 0;
			if (slot.prop === "children") {
				if (linkedOutletExpression !== void 0) {
					structuralChildBlocks.push([`{${linkedOutletExpression}}`]);
					continue;
				}
				for (const child of children) structuralChildBlocks.push(renderNode(child));
			} else {
				if (linkedOutletExpression !== void 0) {
					namedAttrLines.push([`${slot.prop}={${linkedOutletExpression}}`]);
					continue;
				}
				if (children.length === 0) continue;
				namedAttrLines.push(renderNamedSlotAttr(slot.prop, children));
			}
		}
		const textChildValue = textChildProp !== void 0 && node.props[textChildProp] != null ? String(node.props[textChildProp]) : null;
		const textChildSource = textChildValue !== null ? `{${JSON.stringify(textChildValue)}}` : "";
		const attrBlocks = [...scalarAttrs.map((a) => [a]), ...namedAttrLines];
		const attrsMultiline = attrBlocks.some((a) => a.length > 1);
		const hasStructural = structuralChildBlocks.length > 0;
		if (!attrsMultiline) {
			const attrStr = attrBlocks.length ? " " + attrBlocks.map((a) => a[0]).join(" ") : "";
			if (hasStructural) return [
				`<${tag}${attrStr}>`,
				...structuralChildBlocks.flatMap((b) => indentLines(b, 2)),
				`</${tag}>`
			];
			if (textChildSource) return [`<${tag}${attrStr}>${textChildSource}</${tag}>`];
			return [`<${tag}${attrStr} />`];
		}
		const open = [`<${tag}`, ...attrBlocks.flatMap((a) => indentLines(a, 2))];
		if (hasStructural) return [
			...open,
			`>`,
			...structuralChildBlocks.flatMap((b) => indentLines(b, 2)),
			`</${tag}>`
		];
		if (textChildSource) return [...open, `>${textChildSource}</${tag}>`];
		return [...open, `/>`];
	};
	const renderNamedSlotAttr = (prop, children) => {
		if (children.length === 1) {
			const childLines = renderNode(children[0]);
			if (childLines.length === 1) return [`${prop}={${childLines[0]}}`];
			return [
				`${prop}={`,
				...indentLines(childLines, 2),
				`}`
			];
		}
		const inner = children.flatMap((c) => renderNode(c));
		return [
			`${prop}={`,
			`  <>`,
			...indentLines(inner, 4),
			`  </>`,
			`}`
		];
	};
	const rootBlocks = document.root.map((node) => renderNode(node));
	const importLines = buildImportLines(uniqueImportPlans);
	const body = rootBlocks.length === 0 ? ["    <></>"] : [
		"    <>",
		...rootBlocks.flatMap((b) => indentLines(b, 6)),
		"    </>"
	];
	const componentParameter = linkedOutlet ? `({ outlets = {} }: { outlets?: CompositionOutlets })` : "()";
	const exportPrefix = componentExport === "default" ? "export default " : componentExport === "named" ? "export " : "";
	return {
		ok: true,
		blocked: false,
		code: [
			...importLines.length ? [...importLines, ""] : [],
			...hasDownloads ? [`const ${downloadHandlerName}: (event: MouseEvent, maxBytes: number) => Promise<void> = ${downloadAsset.toString()};`, ""] : [],
			...linkedOutlet ? [
				"export type CompositionOutlets = {",
				`  ${JSON.stringify(linkedOutlet.id)}?: import("preact").ComponentChildren;`,
				"};",
				""
			] : [],
			`${exportPrefix}function ${componentName}${componentParameter} {`,
			"  return (",
			...body,
			"  );",
			"}",
			""
		].join("\n"),
		diagnostics,
		imports: uniqueImportPlans,
		emittedNodeOrder
	};
}
//#endregion
//#region src/composer/source/plan-linked-jsx.ts
function sameBinding(a, b) {
	return a.sourceRecordId === b.sourceRecordId && a.outletId === b.outletId;
}
function sameRecordSnapshot(a, b) {
	const canonicalize = (value) => {
		if (Array.isArray(value)) return value.map(canonicalize);
		if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([aKey], [bKey]) => aKey.localeCompare(bKey)).map(([key, child]) => [key, canonicalize(child)]));
		return value;
	};
	return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}
function dependency(code, message, extras = {}) {
	return {
		kind: "dependency",
		code,
		message,
		...extras
	};
}
function blocked$1(record, kind, diagnostic, moduleSpecifier) {
	return {
		status: "blocked",
		recordId: record.id,
		...moduleSpecifier === void 0 ? {} : { moduleSpecifier },
		kind,
		diagnostic
	};
}
function localComponentBlock(record, kind, generation, moduleSpecifier) {
	return blocked$1(record, kind, {
		kind: "local-components",
		generation
	}, moduleSpecifier);
}
function linkedResolutionMessage(status) {
	switch (status) {
		case "missing-template": return "The linked Global template is unavailable, so its consumer module cannot be generated.";
		case "missing-outlet": return "The linked Global template no longer exposes the selected outlet.";
		case "invalid-template": return "The linked Global template is invalid.";
		case "nested-template": return "Linked Global templates cannot be nested.";
		case "self-reference": return "A Composition cannot import itself as its Global template.";
		case "incompatible-local-root": return "The consumer local root does not fit the linked Global template outlet.";
	}
}
function moduleSpecifierFor(record, callback) {
	try {
		const value = callback(record.id);
		if (typeof value !== "string" || value.trim().length === 0) return {
			ok: false,
			diagnostic: dependency("invalid-module-specifier", `The module-specifier callback did not return a non-empty specifier for composition "${record.id}".`)
		};
		return {
			ok: true,
			value
		};
	} catch {
		return {
			ok: false,
			diagnostic: dependency("invalid-module-specifier", `The module-specifier callback failed for composition "${record.id}".`)
		};
	}
}
function standaloneModule(record, manifest, moduleSpecifier, allowUnresolvedAssetDownloads = false) {
	const generation = generateJsx(record.document, manifest, {
		componentName: "Composition",
		componentExport: "default",
		allowUnresolvedAssetDownloads
	});
	if (!generation.ok) return localComponentBlock(record, "standalone", generation, moduleSpecifier);
	return {
		status: "generated",
		recordId: record.id,
		moduleSpecifier,
		kind: "standalone",
		code: generation.code,
		generation
	};
}
function globalTemplateModule(record, manifest, moduleSpecifier, allowUnresolvedAssetDownloads = false) {
	const publication = record.document.publication;
	if (publication?.kind !== "global-template") return standaloneModule(record, manifest, moduleSpecifier, allowUnresolvedAssetDownloads);
	const generation = generateJsx(record.document, manifest, {
		componentName: "Composition",
		componentExport: "default",
		allowUnresolvedAssetDownloads,
		linkedOutlet: publication.outlet
	});
	if (!generation.ok) return localComponentBlock(record, "global-template", generation, moduleSpecifier);
	if (generation.diagnostics.hasReuseIssues) return blocked$1(record, "global-template", dependency("invalid-source-template", "The published Global template no longer has a valid empty outlet target.", { outletId: publication.outlet.id }), moduleSpecifier);
	return {
		status: "generated",
		recordId: record.id,
		moduleSpecifier,
		kind: "global-template",
		code: generation.code,
		generation
	};
}
function linkedConsumerModule(record, manifest, moduleSpecifier, recordsById, sourcePlans, resolutions, sourceOutcomes, allowUnresolvedAssetDownloads = false) {
	const binding = record.document.binding;
	const resolution = resolutions?.get(record.id) ?? (sourceOutcomes ? resolveGlobalTemplateLoad(record, sourceOutcomes.get(binding.sourceRecordId) ?? {
		status: "not-found",
		id: binding.sourceRecordId
	}, manifest) : void 0);
	const dependencyFields = {
		sourceRecordId: binding.sourceRecordId,
		outletId: binding.outletId
	};
	if (!resolution) return blocked$1(record, "linked-consumer", dependency("missing-resolution", "The linked Composition has not been resolved before module planning.", dependencyFields), moduleSpecifier);
	if (resolution.status === "unbound" || !sameBinding(binding, resolution.binding)) return blocked$1(record, "linked-consumer", dependency("resolution-mismatch", "The resolved binding does not match the consumer's current binding.", {
		...dependencyFields,
		resolutionStatus: resolution.status
	}), moduleSpecifier);
	if (resolution.status !== "resolved") return blocked$1(record, "linked-consumer", dependency("resolution-failed", linkedResolutionMessage(resolution.status), {
		...dependencyFields,
		resolutionStatus: resolution.status
	}), moduleSpecifier);
	const source = recordsById.get(binding.sourceRecordId);
	if (!source) return blocked$1(record, "linked-consumer", dependency("missing-source-record", "The resolved source record was not included in this module-planning batch.", dependencyFields), moduleSpecifier);
	if (!sameRecordSnapshot(source, resolution.source)) return blocked$1(record, "linked-consumer", dependency("source-record-mismatch", "The source record changed after its binding was resolved; resolve it again before generating modules.", dependencyFields), moduleSpecifier);
	const sourcePlan = sourcePlans.get(source.id);
	if (!sourcePlan || sourcePlan.status !== "generated" || sourcePlan.kind !== "global-template") return blocked$1(record, "linked-consumer", dependency("source-module-blocked", "The linked source module is blocked, so no misleading local-only consumer module was generated.", dependencyFields), moduleSpecifier);
	const localGeneration = generateJsx(record.document, manifest, {
		allowUnresolvedAssetDownloads,
		componentName: "LocalCompositionContent",
		componentExport: "none",
		reservedIdentifiers: [
			"Composition",
			"LinkedTemplate",
			"LocalCompositionContent"
		]
	});
	if (!localGeneration.ok) return localComponentBlock(record, "linked-consumer", localGeneration, moduleSpecifier);
	const sourceSpecifier = sourcePlan.moduleSpecifier;
	const code = [
		`import LinkedTemplate from ${JSON.stringify(sourceSpecifier)};`,
		"",
		localGeneration.code.trimEnd(),
		"",
		"export default function Composition() {",
		"  return (",
		"    <LinkedTemplate",
		"      outlets={{",
		`        ${JSON.stringify(resolution.outlet.id)}: <LocalCompositionContent />,`,
		"      }}",
		"    />",
		"  );",
		"}",
		""
	].join("\n");
	return {
		status: "generated",
		recordId: record.id,
		moduleSpecifier,
		kind: "linked-consumer",
		code,
		generation: localGeneration
	};
}
/**
* Produce a complete, provider-neutral module plan for an already-loaded
* closure. No record is loaded, saved, listed, or otherwise read through a
* provider here; callers own those operations before invoking this function.
*/
function planLinkedJsxModules(options) {
	const recordsById = /* @__PURE__ */ new Map();
	const duplicateIds = /* @__PURE__ */ new Set();
	for (const record of options.records) if (recordsById.has(record.id)) duplicateIds.add(record.id);
	else recordsById.set(record.id, record);
	const specifiers = /* @__PURE__ */ new Map();
	const preflight = /* @__PURE__ */ new Map();
	for (const record of options.records) {
		if (duplicateIds.has(record.id)) {
			preflight.set(record.id, blocked$1(record, record.document.binding ? "linked-consumer" : record.document.publication?.kind === "global-template" ? "global-template" : "standalone", dependency("duplicate-record-id", `Composition "${record.id}" appears more than once in this module-planning batch.`)));
			continue;
		}
		const specifier = moduleSpecifierFor(record, options.moduleSpecifier);
		if (!specifier.ok) preflight.set(record.id, blocked$1(record, record.document.binding ? "linked-consumer" : record.document.publication?.kind === "global-template" ? "global-template" : "standalone", specifier.diagnostic));
		else specifiers.set(record.id, specifier.value);
	}
	const sourcePlans = /* @__PURE__ */ new Map();
	for (const record of options.records) {
		const existing = preflight.get(record.id);
		if (existing) {
			sourcePlans.set(record.id, existing);
			continue;
		}
		if (record.document.binding) continue;
		sourcePlans.set(record.id, globalTemplateModule(record, options.manifest, specifiers.get(record.id), options.allowUnresolvedAssetDownloads));
	}
	const plans = new Map(sourcePlans);
	for (const record of options.records) {
		if (!record.document.binding) continue;
		const existing = preflight.get(record.id);
		plans.set(record.id, existing ?? linkedConsumerModule(record, options.manifest, specifiers.get(record.id), recordsById, sourcePlans, options.resolutions, options.sourceOutcomes, options.allowUnresolvedAssetDownloads));
	}
	return {
		records: options.records.map((record) => plans.get(record.id)),
		byRecordId: new Map(plans)
	};
}
//#endregion
//#region src/mapping/model/validate.ts
var RECORD_KEYS$1 = [
	"id",
	"createdAt",
	"updatedAt",
	"document"
];
var DOCUMENT_KEYS$1 = [
	"schemaVersion",
	"id",
	"name",
	"contentModel",
	"composition",
	"mode",
	"bindings"
];
var BINDING_KEYS = [
	"id",
	"sourceFieldId",
	"projection",
	"target",
	"transform"
];
function fail(code, message, path, foundSchemaVersion) {
	return {
		ok: false,
		issue: {
			code,
			message,
			...path ? { path } : {},
			...foundSchemaVersion === void 0 ? {} : { foundSchemaVersion }
		}
	};
}
function exact(value, keys) {
	return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function timestamp(value) {
	if (typeof value !== "string") return false;
	const date = new Date(value);
	return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
function providerId(value) {
	return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[a-z0-9][a-z0-9_-]*$/.test(value);
}
function ref(value) {
	return isPlainObject(value) && exact(value, ["providerId", "recordId"]) && providerId(value.providerId) && isSafeRecordId(value.recordId);
}
function mode(value) {
	if (!isPlainObject(value) || typeof value.kind !== "string") return false;
	if (value.kind === "single") return exact(value, ["kind"]);
	if (value.kind !== "collection" || !exact(value, ["kind", "query"]) || !isPlainObject(value.query)) return false;
	const query = value.query;
	if (!exact(query, [
		"publication",
		"conditions",
		"sort",
		"pins",
		"limit"
	]) || !["published-only", "include-drafts"].includes(String(query.publication)) || !Number.isInteger(query.limit) || Number(query.limit) < 1 || Number(query.limit) > 1e3) return false;
	if (!Array.isArray(query.conditions) || !query.conditions.every((item) => isPlainObject(item) && isSafeRecordId(item.fieldId) && [
		"equals",
		"not-equals",
		"contains",
		"exists"
	].includes(String(item.operator)) && (item.operator === "exists" ? exact(item, ["fieldId", "operator"]) : exact(item, [
		"fieldId",
		"operator",
		"value"
	])))) return false;
	if (!Array.isArray(query.sort) || !query.sort.every((item) => isPlainObject(item) && exact(item, ["fieldId", "direction"]) && isSafeRecordId(item.fieldId) && ["asc", "desc"].includes(String(item.direction)))) return false;
	if (!Array.isArray(query.pins) || !query.pins.every((item) => isPlainObject(item) && exact(item, [
		"providerId",
		"modelId",
		"recordId"
	]) && providerId(item.providerId) && isSafeRecordId(item.modelId) && isSafeRecordId(item.recordId))) return false;
	return true;
}
function validateMappingTransform(value) {
	if (!isPlainObject(value) || typeof value.kind !== "string") return false;
	if (value.kind === "prefix") return exact(value, ["kind", "prefix"]) && typeof value.prefix === "string" && Array.from(value.prefix).length <= 80;
	return (value.kind === "identity" || value.kind === "date-medium" || value.kind === "truncate-160") && exact(value, ["kind"]);
}
function validateMappingSourceProjection(value) {
	if (!isPlainObject(value) || typeof value.kind !== "string") return false;
	if ([
		"value",
		"asset-url",
		"asset-download",
		"reference-id",
		"route-link"
	].includes(value.kind)) return exact(value, ["kind"]);
	if (value.kind === "asset-text") return exact(value, ["kind", "field"]) && [
		"alt",
		"caption",
		"label",
		"title",
		"description"
	].includes(String(value.field));
	return value.kind === "object-field" && exact(value, ["kind", "fieldIds"]) && Array.isArray(value.fieldIds) && value.fieldIds.length > 0 && value.fieldIds.every(isSafeRecordId);
}
function validateMappingRecord(value) {
	if (!isPlainObject(value) || !exact(value, RECORD_KEYS$1)) return fail("invalid-record", "Mapping record must contain exactly its canonical envelope fields.");
	if (!isJsonSafe(value)) return fail("not-json-safe", "Mapping record must be JSON-safe.");
	if (!isSafeRecordId(value.id)) return fail("unsafe-id", "Mapping id must be a safe record id.", "id");
	if (!timestamp(value.createdAt) || !timestamp(value.updatedAt)) return fail("invalid-timestamp", "Mapping timestamps must be canonical ISO timestamps.");
	if (value.updatedAt < value.createdAt) return fail("invalid-timestamp-order", "updatedAt cannot precede createdAt.");
	if (isPlainObject(value.document) && typeof value.document.schemaVersion === "number" && value.document.schemaVersion > 2) return fail("future-schema", "Mapping uses a newer schema version.", "document.schemaVersion", value.document.schemaVersion);
	if (!isPlainObject(value.document) || !exact(value.document, DOCUMENT_KEYS$1)) return fail("malformed-document", "Mapping document must contain exactly its canonical fields.");
	const document = value.document;
	if (document.schemaVersion !== 2) return fail("malformed-document", "Mapping schema version is invalid.");
	if (!isSafeRecordId(document.id) || document.id !== value.id) return fail("id-mismatch", "Record id must match its safe document id.");
	if (typeof document.name !== "string" || !document.name.trim()) return fail("malformed-document", "Mapping name must be non-empty.", "document.name");
	if (!ref(document.contentModel)) return fail("invalid-ref", "Content-model reference is malformed.", "document.contentModel");
	if (!ref(document.composition)) return fail("invalid-ref", "Composition reference is malformed.", "document.composition");
	if (!mode(document.mode)) return fail("malformed-document", "Mapping mode/query is malformed.", "document.mode");
	if (!Array.isArray(document.bindings)) return fail("malformed-document", "Bindings must be an array.", "document.bindings");
	const ids = /* @__PURE__ */ new Set();
	for (let index = 0; index < document.bindings.length; index += 1) {
		const binding = document.bindings[index];
		const path = `document.bindings[${index}]`;
		if (!isPlainObject(binding) || !exact(binding, BINDING_KEYS) || !isSafeRecordId(binding.id) || !isSafeRecordId(binding.sourceFieldId)) return fail("invalid-binding", "Binding identity is malformed.", path);
		if (ids.has(binding.id)) return fail("duplicate-binding-id", `Duplicate binding id "${binding.id}".`, `${path}.id`);
		ids.add(binding.id);
		if (!isPlainObject(binding.target) || !exact(binding.target, ["nodeId", "prop"]) || typeof binding.target.nodeId !== "string" || !binding.target.nodeId || typeof binding.target.prop !== "string" || !binding.target.prop) return fail("invalid-binding", "Binding target is malformed.", `${path}.target`);
		if (!validateMappingSourceProjection(binding.projection)) return fail("invalid-binding", "Binding source projection is malformed.", `${path}.projection`);
		if (!validateMappingTransform(binding.transform)) return fail("malformed-transform", "Binding transform is malformed.", `${path}.transform`);
	}
	return {
		ok: true,
		record: value
	};
}
//#endregion
//#region src/mapping/resolver/compatibility.ts
function assertNever(value, axis) {
	throw new TypeError(`Unhandled ${axis} kind: ${String(value)}`);
}
function isStringProducingSource(kind) {
	switch (kind) {
		case "text":
		case "long-text":
		case "markdown":
		case "date":
		case "slug":
		case "color":
		case "url": return true;
		case "number":
		case "boolean": return false;
		case "choice":
		case "reference":
		case "reference-list":
		case "object":
		case "list":
		case "asset-use": return false;
		default: return assertNever(kind, "Content field");
	}
}
function isIdentityCompatible(source, target) {
	switch (target) {
		case "text": return isStringProducingSource(source);
		case "select": switch (source) {
			case "text":
			case "slug":
			case "choice": return true;
			case "long-text":
			case "markdown":
			case "number":
			case "boolean":
			case "date":
			case "color":
			case "url": return false;
			case "reference":
			case "reference-list":
			case "object":
			case "list":
			case "asset-use": return false;
			default: return assertNever(source, "Content field");
		}
		case "color": switch (source) {
			case "color": return true;
			case "text":
			case "long-text":
			case "markdown":
			case "number":
			case "boolean":
			case "date":
			case "slug":
			case "url": return false;
			case "choice":
			case "reference":
			case "reference-list":
			case "object":
			case "list":
			case "asset-use": return false;
			default: return assertNever(source, "Content field");
		}
		case "number": switch (source) {
			case "number": return true;
			case "text":
			case "long-text":
			case "markdown":
			case "boolean":
			case "date":
			case "slug":
			case "color":
			case "url": return false;
			case "choice":
			case "reference":
			case "reference-list":
			case "object":
			case "list":
			case "asset-use": return false;
			default: return assertNever(source, "Content field");
		}
		case "boolean": switch (source) {
			case "boolean": return true;
			case "text":
			case "long-text":
			case "markdown":
			case "number":
			case "date":
			case "slug":
			case "color":
			case "url": return false;
			case "choice":
			case "reference":
			case "reference-list":
			case "object":
			case "list":
			case "asset-use": return false;
			default: return assertNever(source, "Content field");
		}
		default: return assertNever(target, "component target");
	}
}
function isMappingCompatible(source, target, transform) {
	switch (transform.kind) {
		case "identity": return isIdentityCompatible(source, target);
		case "date-medium": return source === "date" && target === "text";
		case "truncate-160": return isStringProducingSource(source) && target === "text";
		case "prefix": return isStringProducingSource(source) && target === "text" && Array.from(transform.prefix).length <= 80;
	}
}
function isCanonicalDate(value) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = /* @__PURE__ */ new Date(`${value}T00:00:00.000Z`);
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function applyMappingTransform(value, transform) {
	if (![
		"string",
		"number",
		"boolean"
	].includes(typeof value)) throw new TypeError("Scalar mapping transforms do not accept structured Content values.");
	switch (transform.kind) {
		case "identity": return value;
		case "prefix": return transform.prefix + String(value);
		case "truncate-160": {
			const points = Array.from(String(value));
			return points.length > 160 ? `${points.slice(0, 160).join("")}…` : String(value);
		}
		case "date-medium": {
			const source = String(value);
			if (!isCanonicalDate(source)) throw new RangeError("date-medium requires a canonical calendar date.");
			const [year, month, day] = source.split("-");
			return `${[
				"Jan",
				"Feb",
				"Mar",
				"Apr",
				"May",
				"Jun",
				"Jul",
				"Aug",
				"Sep",
				"Oct",
				"Nov",
				"Dec"
			][Number(month) - 1]} ${Number(day)}, ${Number(year)}`;
		}
	}
}
//#endregion
//#region src/mapping/resolver/projections.ts
function resolveMappingProjectionDefinition(field, projection) {
	if (!validateMappingSourceProjection(projection)) return {
		status: "invalid",
		message: "Source projection is malformed."
	};
	if (projection.kind === "value") return {
		status: "ready",
		kind: field.kind
	};
	if (projection.kind === "object-field") {
		let current = field;
		for (const fieldId of projection.fieldIds) current = current?.kind === "object" ? current.fields.find((candidate) => candidate.id === fieldId) : void 0;
		return current ? {
			status: "ready",
			kind: current.kind
		} : {
			status: "invalid",
			message: `Structured source projection ${JSON.stringify(projection.fieldIds)} is stale.`
		};
	}
	if (projection.kind === "asset-download") return field.kind === "asset-use" && field.use === "download" ? {
		status: "ready",
		kind: "markdown"
	} : {
		status: "invalid",
		message: "asset-download requires a download use."
	};
	if (projection.kind === "asset-url") return field.kind === "asset-use" ? {
		status: "ready",
		kind: "url"
	} : {
		status: "invalid",
		message: "asset-url requires an asset-use field."
	};
	if (projection.kind === "asset-text") return field.kind === "asset-use" && {
		image: ["alt", "caption"],
		link: ["label"],
		download: ["label"],
		card: ["title", "description"]
	}[field.use].includes(projection.field) ? {
		status: "ready",
		kind: "text"
	} : {
		status: "invalid",
		message: `asset-text ${projection.field} is unavailable for this field.`
	};
	return field.kind === "reference" ? {
		status: "ready",
		kind: "text"
	} : {
		status: "invalid",
		message: `${projection.kind} requires a reference field.`
	};
}
/** Projects typed Content values without stringifying structured data. */
function projectContentValue(options) {
	const value = options.entry.values[options.field.id];
	const projection = options.projection;
	if (!validateMappingSourceProjection(projection)) return {
		status: "invalid",
		message: "Source projection is malformed."
	};
	if (value === void 0) return {
		status: "invalid",
		message: `Source field "${options.field.id}" has no value.`
	};
	if (!isValueValidForField(options.field, value)) return {
		status: "invalid",
		message: `Source field "${options.field.id}" has an invalid value.`
	};
	if (projection.kind === "value") return {
		status: "projected",
		value
	};
	if (projection.kind === "asset-download") {
		const use = value;
		return options.field.kind === "asset-use" && use.kind === "download" ? {
			status: "projected",
			value: assetDownloadMarkdown(use)
		} : {
			status: "invalid",
			message: "asset-download requires a download use."
		};
	}
	if (projection.kind === "object-field") {
		let current = value;
		let fields = options.field.kind === "object" ? options.field.fields : void 0;
		for (const fieldId of projection.fieldIds) {
			const field = fields?.find((candidate) => candidate.id === fieldId);
			if (!field || current === null || Array.isArray(current) || typeof current !== "object") return {
				status: "invalid",
				message: `Structured field projection "${fieldId}" is stale.`
			};
			current = current[field.id];
			fields = field.kind === "object" ? field.fields : void 0;
		}
		return current === void 0 ? {
			status: "invalid",
			message: "Structured field projection has no value."
		} : {
			status: "projected",
			value: current
		};
	}
	if (projection.kind === "asset-url" || projection.kind === "asset-text") {
		if (options.field.kind !== "asset-use" || value === null || Array.isArray(value) || typeof value !== "object") return {
			status: "invalid",
			message: "Asset projection requires an asset-use value."
		};
		const asset = value;
		if (projection.kind === "asset-url") return {
			status: "projected",
			value: assetAuthoringUrl(asset.asset.assetId)
		};
		const text = projection.field in asset ? asset[projection.field] : void 0;
		return typeof text === "string" ? {
			status: "projected",
			value: text
		} : {
			status: "invalid",
			message: `Asset ${projection.field} is unavailable for this use.`
		};
	}
	if (options.field.kind !== "reference") return {
		status: "invalid",
		message: `${projection.kind} requires a reference field.`
	};
	const refs = Array.isArray(value) ? value : [value];
	const parsed = refs.filter((item) => item !== null && !Array.isArray(item) && typeof item === "object" && typeof item.providerId === "string" && typeof item.modelId === "string" && typeof item.recordId === "string");
	if (parsed.length !== refs.length) return {
		status: "invalid",
		message: "Reference projection requires provider-qualified reference values."
	};
	if (projection.kind === "reference-id") return parsed.length === 1 ? {
		status: "projected",
		value: parsed[0].recordId
	} : {
		status: "invalid",
		message: "reference-id requires one reference."
	};
	if (!options.routeResolver) return {
		status: "route-context-unavailable",
		message: "Route-link projection requires a route resolver."
	};
	if (parsed.length !== 1) return {
		status: "route-context-ambiguous",
		message: "Route-link projection requires exactly one reference."
	};
	const resolved = options.routeResolver.resolve(parsed[0]);
	return resolved.status === "resolved" ? {
		status: "projected",
		value: resolved.href
	} : {
		status: resolved.status === "ambiguous" ? "route-context-ambiguous" : "route-context-unavailable",
		message: `Route context is ${resolved.status}.`
	};
}
//#endregion
//#region src/mapping/resolver/targets.ts
function isStructuredField(field) {
	return "items" in field.schema || "fields" in field.schema;
}
function scalarTarget(node, component, field) {
	const base = {
		target: {
			nodeId: node.id,
			prop: field.prop
		},
		nodeLabel: `${component.title} (${node.id})`,
		componentId: component.id,
		componentVersion: component.schemaVersion,
		componentLabel: component.title,
		fieldLabel: field.label,
		required: field.required ?? false
	};
	if ("enum" in field.schema) return {
		...base,
		kind: field.editor.kind,
		options: field.schema.enum
	};
	return {
		...base,
		kind: field.editor.kind
	};
}
function discoverMappingTargets(document, manifest) {
	const targets = [];
	const unsupportedStructuredTargets = [];
	const diagnostics = [];
	const visit = (node) => {
		const component = manifest.get(node.componentId);
		if (!component) diagnostics.push({
			code: "component-missing",
			nodeId: node.id,
			message: `Component "${node.componentId}" is unavailable for node "${node.id}".`
		});
		else if (component.schemaVersion !== node.componentVersion) diagnostics.push({
			code: "component-version-mismatch",
			nodeId: node.id,
			message: `Node "${node.id}" uses ${node.componentId} v${node.componentVersion}, but the manifest provides v${component.schemaVersion}.`
		});
		else for (const field of component.fields) if (isStructuredField(field)) unsupportedStructuredTargets.push({
			target: {
				nodeId: node.id,
				prop: field.prop
			},
			nodeLabel: `${component.title} (${node.id})`,
			fieldLabel: field.label,
			message: `Structured component field "${node.id}.${field.prop}" cannot be used as a scalar mapping target.`
		});
		else targets.push(scalarTarget(node, component, field));
		for (const children of Object.values(node.slots)) for (const child of children) visit(child);
	};
	for (const node of document.root) visit(node);
	return {
		targets,
		unsupportedStructuredTargets,
		diagnostics
	};
}
//#endregion
//#region src/mapping/resolver/resolver.ts
function targetKey(target) {
	return `${target.nodeId}\u0000${target.prop}`;
}
async function resolveMappingDefinition(mapping, catalogs, manifest) {
	const diagnostics = [];
	const [content, composition] = await Promise.all([catalogs.content.resolveModel(mapping.document.contentModel), catalogs.compositions.resolve(mapping.document.composition)]);
	if (content.status !== "resolved") diagnostics.push({
		scope: "definition",
		severity: "blocking",
		code: content.status === "not-found" ? "content-model-not-found" : content.status === "provider-error" ? "content-provider-error" : "content-model-invalid",
		message: content.status === "not-found" ? "The referenced Content model was not found." : content.reason
	});
	if (composition.status !== "resolved") diagnostics.push({
		scope: "definition",
		severity: "blocking",
		code: composition.status === "not-found" ? "composition-not-found" : composition.status === "provider-error" ? "composition-provider-error" : "composition-invalid",
		message: composition.status === "not-found" ? "The referenced Composition was not found." : composition.reason
	});
	if (content.status !== "resolved" || composition.status !== "resolved") return {
		status: "blocked",
		mapping,
		targets: [],
		bindings: [],
		diagnostics,
		...content.status === "resolved" ? { contentModel: content.record } : {},
		...composition.status === "resolved" ? { composition: composition.record } : {}
	};
	const discovery = discoverMappingTargets(composition.record.document, manifest);
	for (const issue of discovery.diagnostics) diagnostics.push({
		scope: "definition",
		severity: "blocking",
		code: issue.code,
		message: issue.message,
		target: {
			nodeId: issue.nodeId,
			prop: ""
		}
	});
	const sourceById = new Map(content.record.document.fields.map((field) => [field.id, field]));
	const targetByKey = new Map(discovery.targets.map((target) => [targetKey(target.target), target]));
	const structuredTargetByKey = new Map(discovery.unsupportedStructuredTargets.map((target) => [targetKey(target.target), target]));
	const seenTargets = /* @__PURE__ */ new Set();
	const bindings = [];
	for (const binding of mapping.document.bindings) {
		const source = sourceById.get(binding.sourceFieldId);
		const key = targetKey(binding.target);
		const target = targetByKey.get(key);
		if (!source) diagnostics.push({
			scope: "definition",
			severity: "blocking",
			code: "source-field-missing",
			bindingId: binding.id,
			sourceFieldId: binding.sourceFieldId,
			message: `Source field "${binding.sourceFieldId}" no longer exists.`
		});
		if (seenTargets.has(key)) diagnostics.push({
			scope: "definition",
			severity: "blocking",
			code: "duplicate-target",
			bindingId: binding.id,
			target: binding.target,
			message: `Target "${binding.target.nodeId}.${binding.target.prop}" is bound more than once.`
		});
		else seenTargets.add(key);
		if (!target) {
			const nodeExists = findNode(composition.record.document.root, binding.target.nodeId);
			const structuredTarget = structuredTargetByKey.get(key);
			diagnostics.push({
				scope: "definition",
				severity: "blocking",
				code: structuredTarget ? "structured-target-unsupported" : nodeExists ? "target-field-missing" : "target-node-missing",
				bindingId: binding.id,
				target: binding.target,
				message: structuredTarget?.message ?? (nodeExists ? `Target field "${binding.target.prop}" no longer exists on node "${binding.target.nodeId}".` : `Target node "${binding.target.nodeId}" no longer exists.`)
			});
		}
		const projection = source ? resolveMappingProjectionDefinition(source, binding.projection) : void 0;
		if (projection?.status === "invalid") diagnostics.push({
			scope: "definition",
			severity: "blocking",
			code: "source-projection-invalid",
			bindingId: binding.id,
			sourceFieldId: source?.id,
			message: projection.message
		});
		if (!validateMappingTransform(binding.transform)) diagnostics.push({
			scope: "definition",
			severity: "blocking",
			code: "invalid-transform-config",
			bindingId: binding.id,
			message: `Binding "${binding.id}" has an invalid transform configuration.`
		});
		else if (projection?.status === "ready" && target && !isMappingCompatible(projection.kind, target.kind, binding.transform)) diagnostics.push({
			scope: "definition",
			severity: "blocking",
			code: "incompatible-binding",
			bindingId: binding.id,
			sourceFieldId: source?.id,
			target: binding.target,
			message: `${projection.kind} cannot map to ${target.kind} with ${binding.transform.kind}.`
		});
		else if (source && target && projection?.status === "ready" && !seenTargets.has(`accepted:${key}`)) {
			bindings.push({
				binding,
				source,
				target
			});
			seenTargets.add(`accepted:${key}`);
		}
	}
	return {
		status: diagnostics.length ? "blocked" : "ready",
		mapping,
		contentModel: content.record,
		composition: composition.record,
		targets: discovery.targets,
		bindings,
		diagnostics
	};
}
function findNode(nodes, id) {
	for (const node of nodes) {
		if (node.id === id) return node;
		for (const children of Object.values(node.slots)) {
			const found = findNode(children, id);
			if (found) return found;
		}
	}
}
/**
* Evaluates transient Entry data against an already-resolved Mapping.
*
* Resolution may involve provider I/O, while evaluation is deliberately pure
* and synchronous so authoring surfaces can render every current draft
* revision without rereading either Content or Mapping storage.
*/
function evaluateResolvedMapping(definition, entry, options = {}) {
	const mapping = definition.mapping;
	const document = definition.composition ? cloneJson(definition.composition.document) : void 0;
	if (definition.status === "blocked" || !document) return {
		status: "blocked",
		...document ? { document } : {},
		definitionDiagnostics: definition.diagnostics,
		entryDiagnostics: [],
		appliedBindings: [],
		appliedBindingCount: 0,
		unchangedStaticCount: mapping.document.bindings.length
	};
	const entryDiagnostics = [];
	const appliedBindings = [];
	if (!definition.contentModel || entry.modelId !== definition.contentModel.id) return {
		status: "blocked",
		document,
		definitionDiagnostics: definition.diagnostics,
		entryDiagnostics: [{
			scope: "entry",
			severity: "blocking",
			code: "entry-model-mismatch",
			entryId: entry.id,
			message: `Entry "${entry.id}" belongs to Content model "${entry.modelId}", not "${definition.contentModel?.id ?? "unresolved"}".`
		}],
		appliedBindings,
		appliedBindingCount: 0,
		unchangedStaticCount: mapping.document.bindings.length
	};
	for (const resolved of definition.bindings) {
		const { binding, source, target } = resolved;
		const value = entry.values[source.id];
		if (value === void 0 || typeof value === "string" && value.trim().length === 0) {
			const blocking = source.required;
			entryDiagnostics.push({
				scope: "entry",
				severity: blocking ? "blocking" : "nonblocking",
				code: blocking ? "required-value-missing" : "optional-value-missing",
				entryId: entry.id,
				bindingId: binding.id,
				sourceFieldId: source.id,
				target: binding.target,
				message: `${blocking ? "Required" : "Optional"} source field "${source.label}" has no value; the static target value is unchanged.`
			});
			continue;
		}
		if (source.kind === "date" && typeof value === "string" && !isCanonicalDate(value)) {
			entryDiagnostics.push({
				scope: "entry",
				severity: "blocking",
				code: "invalid-canonical-date",
				entryId: entry.id,
				bindingId: binding.id,
				sourceFieldId: source.id,
				target: binding.target,
				message: `Source date for "${source.label}" is not canonical YYYY-MM-DD.`
			});
			continue;
		}
		if (!isValueValidForField(source, value)) {
			entryDiagnostics.push({
				scope: "entry",
				severity: "blocking",
				code: "invalid-source-value",
				entryId: entry.id,
				bindingId: binding.id,
				sourceFieldId: source.id,
				target: binding.target,
				message: `Source value for "${source.label}" does not match ${source.kind}.`
			});
			continue;
		}
		const projected = projectContentValue({
			field: source,
			entry,
			projection: binding.projection,
			providerId: mapping.document.contentModel.providerId,
			...options.routeResolver ? { routeResolver: options.routeResolver } : {}
		});
		if (projected.status !== "projected") {
			entryDiagnostics.push({
				scope: "entry",
				severity: "blocking",
				code: projected.status === "invalid" ? "source-projection-invalid" : projected.status,
				entryId: entry.id,
				bindingId: binding.id,
				sourceFieldId: source.id,
				target: binding.target,
				message: projected.message
			});
			continue;
		}
		const projection = resolveMappingProjectionDefinition(source, binding.projection);
		if (projection.status === "ready" && projection.kind === "date" && typeof projected.value === "string" && !isCanonicalDate(projected.value)) {
			entryDiagnostics.push({
				scope: "entry",
				severity: "blocking",
				code: "invalid-canonical-date",
				entryId: entry.id,
				bindingId: binding.id,
				sourceFieldId: source.id,
				target: binding.target,
				message: `Source date for "${source.label}" is not canonical YYYY-MM-DD.`
			});
			continue;
		}
		const transformed = applyMappingTransform(projected.value, binding.transform);
		if (target.kind === "select" && !target.options?.includes(transformed)) {
			entryDiagnostics.push({
				scope: "entry",
				severity: "blocking",
				code: "select-option-invalid",
				entryId: entry.id,
				bindingId: binding.id,
				sourceFieldId: source.id,
				target: binding.target,
				message: `Value "${String(transformed)}" is not a current option for "${target.fieldLabel}".`
			});
			continue;
		}
		const node = findNode(document.root, target.target.nodeId);
		if (node) {
			node.props[target.target.prop] = transformed;
			appliedBindings.push({
				bindingId: binding.id,
				sourceFieldId: source.id,
				target: { ...target.target },
				value: transformed
			});
		}
	}
	return {
		status: entryDiagnostics.some((item) => item.severity === "blocking") ? "blocked" : "ready",
		document,
		definitionDiagnostics: definition.diagnostics,
		entryDiagnostics,
		appliedBindings,
		appliedBindingCount: appliedBindings.length,
		unchangedStaticCount: mapping.document.bindings.length - appliedBindings.length
	};
}
//#endregion
//#region src/site-project/model/canonical.ts
/** Locale-independent lexicographic comparison by Unicode code point. */
function compareUnicodeCodePoints(left, right) {
	const leftPoints = Array.from(left, (character) => character.codePointAt(0));
	const rightPoints = Array.from(right, (character) => character.codePointAt(0));
	const length = Math.min(leftPoints.length, rightPoints.length);
	for (let index = 0; index < length; index += 1) if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] < rightPoints[index] ? -1 : 1;
	return leftPoints.length === rightPoints.length ? 0 : leftPoints.length < rightPoints.length ? -1 : 1;
}
function compareById(left, right) {
	return compareUnicodeCodePoints(left.id, right.id);
}
/** Sort only set-like provider/record collections; authored tree/field order remains semantic. */
function canonicalizeSiteProject(project) {
	const copy = structuredClone(project);
	copy.providers.compositions.sort(compareById);
	for (const provider of copy.providers.compositions) provider.records.sort(compareById);
	copy.providers.content.sort(compareById);
	for (const provider of copy.providers.content) {
		provider.models.sort(compareById);
		provider.entries.sort(compareById);
	}
	copy.providers.mappings.sort(compareById);
	for (const provider of copy.providers.mappings) provider.records.sort(compareById);
	copy.providers.sitemaps.sort(compareById);
	for (const provider of copy.providers.sitemaps) provider.records.sort(compareById);
	copy.collectionAttachments.sort((left, right) => left.order - right.order || compareUnicodeCodePoints(left.id, right.id));
	return copy;
}
//#endregion
//#region src/mapping/resolver/collection.ts
function scalar(value) {
	return value === null || [
		"string",
		"number",
		"boolean",
		"undefined"
	].includes(typeof value) ? value : void 0;
}
function compareValues(left, right) {
	const a = scalar(left);
	const b = scalar(right);
	if (a === b) return 0;
	if (a === void 0) return 1;
	if (b === void 0) return -1;
	if (typeof a === "number" && typeof b === "number") return a < b ? -1 : 1;
	if (typeof a === "boolean" && typeof b === "boolean") return a ? 1 : -1;
	return compareUnicodeCodePoints(String(a), String(b));
}
function canonicalJson(value) {
	if (value === void 0) return "undefined";
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	const object = value;
	return `{${Object.keys(object).sort(compareUnicodeCodePoints).map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}
function conditionMatches(value, condition) {
	if (condition.operator === "exists") return value !== void 0 && value !== null && !(typeof value === "string" && value.trim() === "");
	if (condition.operator === "contains") {
		if (typeof value === "string" && typeof condition.value === "string") return value.includes(condition.value);
		if (Array.isArray(value)) return value.some((item) => canonicalJson(item) === canonicalJson(condition.value));
		return false;
	}
	const equal = canonicalJson(value) === canonicalJson(condition.value);
	return condition.operator === "equals" ? equal : !equal;
}
function eligible(entry, query) {
	return query.publication === "include-drafts" || entry.lifecycle === "published";
}
/** Pure deterministic query evaluation; provider reads belong to the caller. */
function evaluateCollectionQuery(options) {
	const { model, providerId, query } = options;
	const diagnostics = [];
	if (model.document.kind !== "collection") diagnostics.push({
		code: "collection-required",
		severity: "blocking",
		message: `Content model "${model.id}" is not a collection.`
	});
	const fields = new Map(model.document.fields.map((field) => [field.id, field]));
	for (const item of [...query.conditions, ...query.sort]) if (!fields.has(item.fieldId)) diagnostics.push({
		code: "stale-query-field",
		severity: "blocking",
		fieldId: item.fieldId,
		message: `Query field "${item.fieldId}" no longer exists.`
	});
	for (const sort of query.sort) {
		const field = fields.get(sort.fieldId);
		if (field && !isScalarQueryField(field)) diagnostics.push({
			code: "unsupported-query-field",
			severity: "blocking",
			fieldId: field.id,
			message: `Field "${field.label}" cannot be used for deterministic sorting.`
		});
	}
	for (const condition of query.conditions) {
		const field = fields.get(condition.fieldId);
		const conditionField = field && condition.operator === "contains" && field.kind === "list" ? field.item : field;
		const supported = !field || condition.operator !== "contains" || field.kind === "list" || [
			"text",
			"long-text",
			"markdown",
			"slug",
			"url"
		].includes(field.kind);
		if (field && !supported) diagnostics.push({
			code: "unsupported-query-field",
			severity: "blocking",
			fieldId: field.id,
			message: `Field "${field.label}" does not support the contains operator.`
		});
		else if (field && conditionField && condition.operator !== "exists" && !isValueValidForField(conditionField, condition.value)) diagnostics.push({
			code: "invalid-condition-value",
			severity: "blocking",
			fieldId: field.id,
			message: `Condition value does not match field "${field.label}".`
		});
	}
	if (diagnostics.some((item) => item.severity === "blocking")) return {
		status: "blocked",
		entries: [],
		diagnostics
	};
	const allEntriesById = new Map(options.entries.map((entry) => [entry.id, entry]));
	const all = options.entries.filter((entry) => entry.modelId === model.id);
	const byId = new Map(all.map((entry) => [entry.id, entry]));
	const pinned = [];
	const seen = /* @__PURE__ */ new Set();
	for (const pin of query.pins) {
		if (pin.providerId !== providerId) {
			diagnostics.push({
				code: "pin-provider-mismatch",
				severity: "nonblocking",
				entryId: pin.recordId,
				message: `Pinned Entry "${pin.recordId}" belongs to another provider.`
			});
			continue;
		}
		if (pin.modelId !== model.id) {
			diagnostics.push({
				code: "pin-model-mismatch",
				severity: "nonblocking",
				entryId: pin.recordId,
				message: `Pinned Entry "${pin.recordId}" belongs to another model.`
			});
			continue;
		}
		const entry = byId.get(pin.recordId);
		if (!entry) {
			const existing = allEntriesById.get(pin.recordId);
			diagnostics.push({
				code: existing ? "pin-model-mismatch" : "pin-not-found",
				severity: "nonblocking",
				entryId: pin.recordId,
				message: existing ? `Pinned Entry "${pin.recordId}" belongs to another model.` : `Pinned Entry "${pin.recordId}" was not found.`
			});
			continue;
		}
		if (!eligible(entry, query)) {
			diagnostics.push({
				code: "pin-ineligible",
				severity: "nonblocking",
				entryId: entry.id,
				message: `Pinned Entry "${entry.id}" is not eligible for the publication policy.`
			});
			continue;
		}
		if (!seen.has(entry.id)) {
			seen.add(entry.id);
			pinned.push(entry);
		}
	}
	const matched = all.filter((entry) => eligible(entry, query) && !seen.has(entry.id) && query.conditions.every((condition) => conditionMatches(entry.values[condition.fieldId], condition))).sort((left, right) => {
		for (const sort of query.sort) {
			const compared = compareValues(left.values[sort.fieldId], right.values[sort.fieldId]);
			if (compared) return sort.direction === "asc" ? compared : -compared;
		}
		return compareUnicodeCodePoints(left.id, right.id);
	});
	const entries = [...pinned, ...matched].slice(0, query.limit);
	if (entries.length === 0) diagnostics.push({
		code: "empty-source",
		severity: "nonblocking",
		message: "The collection query produced no Entries."
	});
	return {
		status: "ready",
		entries,
		diagnostics
	};
}
function isScalarQueryField(field) {
	return ![
		"object",
		"list",
		"asset-use",
		"reference",
		"reference-list"
	].includes(field.kind);
}
//#endregion
//#region src/sitemapper/model/types.ts
/** Content field kinds that can be presented verbatim as a plain route title. */
var SITEMAP_DISPLAY_TITLE_FIELD_KINDS = [
	"text",
	"long-text",
	"slug"
];
function isSitemapDisplayTitleFieldKind(kind) {
	return SITEMAP_DISPLAY_TITLE_FIELD_KINDS.includes(kind);
}
//#endregion
//#region src/sitemapper/model/validate.ts
var DOCUMENT_KEYS = [
	"schemaVersion",
	"id",
	"name",
	"root",
	"navigation"
];
var NODE_REQUIRED_KEYS = [
	"id",
	"title",
	"source",
	"children"
];
var NODE_OPTIONAL_KEYS = ["slug", "notes"];
var REF_KEYS$1 = ["providerId", "recordId"];
function hasExactKeys(value, required, optional = []) {
	const allowed = /* @__PURE__ */ new Set([...required, ...optional]);
	return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}
function failure(code, path) {
	return {
		ok: false,
		code,
		path
	};
}
function validRef(value) {
	return isPlainObject(value) && hasExactKeys(value, REF_KEYS$1) && typeof value.providerId === "string" && value.providerId.length > 0 && isSafeRecordId(value.recordId);
}
function validSitemapEntryRef(value) {
	return isPlainObject(value) && hasExactKeys(value, [
		"providerId",
		"modelId",
		"recordId"
	]) && typeof value.providerId === "string" && value.providerId.length > 0 && isSafeRecordId(value.modelId) && isSafeRecordId(value.recordId);
}
function safeNavigationUrl(value) {
	if (typeof value !== "string" || !value || value.trim() !== value || value.includes("\\") || Array.from(value).some((point) => point.charCodeAt(0) <= 32 || point.charCodeAt(0) === 127)) return false;
	try {
		const url = new URL(value);
		return (url.protocol === "https:" || url.protocol === "http:") && !!url.hostname && !url.username && !url.password;
	} catch {
		return false;
	}
}
function validSitemapNavigation(value) {
	if (!isPlainObject(value) || !hasExactKeys(value, ["primary", "footer"])) return false;
	return [value.primary, value.footer].every((menu) => {
		if (!Array.isArray(menu) || menu.length > 1e4) return false;
		const ids = /* @__PURE__ */ new Set();
		return menu.every((item) => {
			if (!isPlainObject(item) || !hasExactKeys(item, [
				"id",
				"label",
				"visible",
				"destination"
			]) || !isSafeRecordId(item.id) || ids.has(item.id) || typeof item.label !== "string" || !item.label.trim() || typeof item.visible !== "boolean") return false;
			ids.add(item.id);
			const target = item.destination;
			if (!isPlainObject(target)) return false;
			if (target.kind === "external") return hasExactKeys(target, ["kind", "url"]) && safeNavigationUrl(target.url);
			if (target.kind !== "route" || !hasExactKeys(target, ["kind", "nodeId"], ["entry", "ancestors"]) || typeof target.nodeId !== "string" || !target.nodeId) return false;
			if (Object.hasOwn(target, "entry") && !validSitemapEntryRef(target.entry)) return false;
			if (!Object.hasOwn(target, "ancestors")) return true;
			if (!Array.isArray(target.ancestors) || target.ancestors.length > 128) return false;
			const ancestors = /* @__PURE__ */ new Set();
			return target.ancestors.every((ancestor) => {
				if (!isPlainObject(ancestor) || !hasExactKeys(ancestor, ["nodeId", "entry"]) || typeof ancestor.nodeId !== "string" || !ancestor.nodeId || ancestors.has(ancestor.nodeId) || !validSitemapEntryRef(ancestor.entry)) return false;
				ancestors.add(ancestor.nodeId);
				return true;
			});
		});
	});
}
function validSitemapSource(value) {
	if (!isPlainObject(value) || typeof value.kind !== "string") return false;
	if (value.kind === "unassigned") return hasExactKeys(value, ["kind"]);
	if (value.kind === "composition") return hasExactKeys(value, ["kind", "ref"]) && validRef(value.ref);
	if (value.kind !== "mapping" || !hasExactKeys(value, [
		"kind",
		"ref",
		"route"
	]) || !validRef(value.ref)) return false;
	const route = value.route;
	if (!isPlainObject(route) || typeof route.kind !== "string") return false;
	if (route.kind === "selected-entry") return hasExactKeys(route, ["kind", "entry"]) && validSitemapEntryRef(route.entry);
	return route.kind === "single" ? hasExactKeys(route, ["kind"]) : route.kind === "entry-field" && hasExactKeys(route, ["kind", "fieldId"], ["titleFieldId"]) && isSafeRecordId(route.fieldId) && (!Object.hasOwn(route, "titleFieldId") || isSafeRecordId(route.titleFieldId));
}
function validateNode(value, path, seenIds, ancestors) {
	if (ancestors.size > 128 || seenIds.size >= 1e4) return failure("tree-limit", path);
	if (!isPlainObject(value)) return failure("invalid-node-keys", path);
	if (ancestors.has(value)) return failure("cycle", path);
	ancestors.add(value);
	try {
		if (!hasExactKeys(value, NODE_REQUIRED_KEYS, NODE_OPTIONAL_KEYS)) return failure("invalid-node-keys", path);
		if (typeof value.id !== "string" || value.id.length === 0) return failure("invalid-node-id", `${path}.id`);
		if (seenIds.has(value.id)) return failure("duplicate-node-id", `${path}.id`);
		seenIds.add(value.id);
		if (typeof value.title !== "string") return failure("invalid-node-title", `${path}.title`);
		if (Object.hasOwn(value, "slug") && typeof value.slug !== "string") return failure("invalid-node-slug", `${path}.slug`);
		if (Object.hasOwn(value, "notes") && typeof value.notes !== "string") return failure("invalid-node-notes", `${path}.notes`);
		if (!validSitemapSource(value.source)) return failure("invalid-source", `${path}.source`);
		if (!Array.isArray(value.children)) return failure("invalid-children", `${path}.children`);
		for (let index = 0; index < value.children.length; index += 1) {
			const childFailure = validateNode(value.children[index], `${path}.children[${index}]`, seenIds, ancestors);
			if (childFailure) return childFailure;
		}
		return;
	} finally {
		ancestors.delete(value);
	}
}
/** Validate one untrusted value and return either the typed document or a code. */
function isStructurallyValidDocument(value) {
	if (!isPlainObject(value)) return failure("not-an-object", "$");
	if (!hasExactKeys(value, DOCUMENT_KEYS)) return failure("invalid-document-keys", "$");
	if (value.schemaVersion !== 3) return failure("unsupported-schema-version", "$.schemaVersion");
	if (typeof value.id !== "string" || value.id.length === 0) return failure("invalid-document-id", "$.id");
	if (typeof value.name !== "string") return failure("invalid-document-name", "$.name");
	if (!validSitemapNavigation(value.navigation)) return failure("invalid-navigation", "$.navigation");
	if (!Array.isArray(value.root) || value.root.length !== 1) return failure("root-cardinality", "$.root");
	const seenIds = /* @__PURE__ */ new Set();
	const ancestors = /* @__PURE__ */ new Set([value]);
	for (let index = 0; index < value.root.length; index += 1) {
		const nodeFailure = validateNode(value.root[index], `$.root[${index}]`, seenIds, ancestors);
		if (nodeFailure) return nodeFailure;
	}
	if (!isJsonSafe(value)) return failure("not-json-safe", "$");
	return {
		ok: true,
		document: value
	};
}
//#endregion
//#region src/sitemapper/model/codec.ts
/** Dispatch an untrusted value by integer schemaVersion only. */
function decodeSitemapDocument(value) {
	if (!isPlainObject(value)) return { status: "malformed" };
	const schemaVersion = value.schemaVersion;
	if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) return { status: "malformed" };
	if (schemaVersion === 3) return {
		status: "current",
		document: value
	};
	if (schemaVersion > 3) return {
		status: "future-schema",
		foundSchemaVersion: schemaVersion
	};
	return { status: "malformed" };
}
//#endregion
//#region src/sitemapper/routes/expand.ts
function isDotPathAlias(part) {
	let decoded = part.normalize("NFC");
	for (let pass = 0; pass < 32; pass += 1) {
		let next;
		try {
			next = decodeURIComponent(decoded);
		} catch {
			return false;
		}
		if (next === decoded) return decoded.split("/").some((candidate) => candidate === "." || candidate === "..");
		decoded = next.normalize("NFC");
	}
	return true;
}
function encodedParts(fragment) {
	try {
		const rawParts = fragment.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
		if (rawParts.some(isDotPathAlias)) return { ok: false };
		return {
			ok: true,
			parts: rawParts.map((part) => encodeURIComponent(part.normalize("NFC")))
		};
	} catch (error) {
		if (error instanceof URIError) return { ok: false };
		throw error;
	}
}
function authoredPath(fragments) {
	const parts = fragments.flatMap((fragment) => {
		const encoded = encodedParts(fragment);
		return encoded.ok ? encoded.parts : [encodeURIComponent("�")];
	});
	return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}
function entrySegment(value) {
	if (typeof value !== "string") return {
		ok: false,
		missing: value === void 0 || value === null
	};
	const normalized = value.trim().normalize("NFC");
	if (!normalized) return {
		ok: false,
		missing: true
	};
	if (normalized.includes("/") || normalized.includes("?") || normalized.includes("#") || isDotPathAlias(normalized)) return {
		ok: false,
		missing: false
	};
	try {
		return {
			ok: true,
			segment: encodeURIComponent(normalized)
		};
	} catch (error) {
		if (error instanceof URIError) return {
			ok: false,
			missing: false
		};
		throw error;
	}
}
function append(base, segment) {
	return base === "/" ? `/${segment}` : `${base}/${segment}`;
}
async function expandSitemapRoutes({ document, catalog, policy = "release" }) {
	const diagnostics = [];
	const metadata = /* @__PURE__ */ new Map();
	const cap = 1e4;
	const diagnose = (node, code, message, extra = {}) => {
		diagnostics.push({
			code,
			nodeId: node.id,
			message,
			...extra
		});
	};
	const authored = [], seenNodes = /* @__PURE__ */ new Set(), ids = /* @__PURE__ */ new Set();
	const pending = document.root.map((node) => ({
		node,
		depth: 1
	}));
	while (pending.length) {
		const { node, depth } = pending.pop();
		if (depth > 128 || authored.length >= cap || seenNodes.has(node) || ids.has(node.id)) {
			diagnostics.push({
				code: "invalid-tree",
				nodeId: node.id,
				message: "Sitemap tree exceeds its bounds or repeats a node identity."
			});
			return {
				routes: [],
				derivedRouteCount: 0,
				diagnostics,
				nodes: /* @__PURE__ */ new Map()
			};
		}
		seenNodes.add(node);
		ids.add(node.id);
		authored.push(node);
		if (pending.length + node.children.length + authored.length > cap) {
			diagnostics.push({
				code: "invalid-tree",
				nodeId: node.id,
				message: "Sitemap authored tree exceeds 10,000 nodes."
			});
			return {
				routes: [],
				derivedRouteCount: 0,
				diagnostics,
				nodes: /* @__PURE__ */ new Map()
			};
		}
		for (const child of node.children) pending.push({
			node: child,
			depth: depth + 1
		});
	}
	const prepare = async (node, externalAncestor = false) => {
		const variants = [];
		const fragment = node.slug ?? "";
		const encoded = encodedParts(fragment);
		if (!encoded.ok) diagnose(node, "route-fragment-invalid", "A route fragment is malformed or contains a forbidden dot-path segment.");
		else if (node.source.kind !== "mapping") variants.push({
			suffix: encoded.parts.join("/"),
			displayTitle: node.title
		});
		else if (externalAncestor || /^https?:\/\//i.test(fragment.trim())) diagnose(node, "unsupported-external-base", "HTTP(S) Mapping route bases are unsupported.");
		else {
			const source = node.source;
			let resolved;
			try {
				resolved = await catalog.resolveMapping(source.ref);
			} catch (error) {
				resolved = {
					status: "provider-error",
					reason: error instanceof Error ? error.message : "Mapping provider failed."
				};
			}
			if (resolved.status !== "resolved") diagnose(node, resolved.status === "not-found" ? "mapping-not-found" : resolved.status === "invalid" ? "mapping-invalid" : "mapping-provider-failure", resolved.status === "not-found" ? "The assigned Mapping was not found." : resolved.reason);
			else {
				const mapping = resolved.record;
				let readiness;
				try {
					readiness = await catalog.resolveDefinitionReadiness(mapping);
				} catch (error) {
					readiness = {
						status: "blocked",
						diagnostics: [{
							code: "readiness-provider-error",
							message: String(error)
						}]
					};
				}
				if (readiness.status !== "ready") diagnose(node, "incompatible-mapping", readiness.diagnostics.map((item) => item.message).join(" "));
				let content;
				try {
					content = await catalog.resolveContentSnapshot(mapping);
				} catch (error) {
					content = {
						status: "provider-error",
						reason: String(error)
					};
				}
				if (content.status !== "resolved") diagnose(node, content.status === "not-found" ? "content-model-not-found" : content.status === "invalid" ? "content-model-invalid" : "content-provider-failure", content.status === "not-found" ? "The Mapping Content model was not found." : content.reason);
				else {
					const { model, snapshot } = content;
					const providerId = mapping.document.contentModel.providerId;
					const owned = snapshot.entries.filter((entry) => entry.modelId === model.id);
					const eligible = (entry) => policy === "authoring-preview" || entry.lifecycle === "published";
					let entries = [];
					let blocked = readiness.status !== "ready";
					if (model.id !== mapping.document.contentModel.recordId || snapshot.diagnostics.length) {
						diagnose(node, "content-model-invalid", "The Content snapshot is incomplete or belongs to another model.");
						blocked = true;
					}
					if (source.route.kind === "selected-entry") {
						const ref = source.route.entry;
						const entry = owned.find(({ id }) => id === ref.recordId);
						if (model.document.kind !== "collection" || mapping.document.mode.kind !== "collection" || ref.providerId !== providerId || ref.modelId !== model.id || !entry) {
							diagnose(node, "selected-entry-invalid", "The selected collection Entry is missing or does not belong to this Mapping model/provider.");
							blocked = true;
						} else if (!eligible(entry)) {
							diagnose(node, "entry-ineligible", "The selected Entry is excluded by release publication policy.", { entryId: entry.id });
							blocked = true;
						} else entries = [entry];
					} else if (source.route.kind === "single") {
						if (mapping.document.mode.kind !== "single" || model.document.kind !== "single") {
							diagnose(node, "wrong-route-mode", "Single routes require a singleton Mapping/model; select a collection Entry explicitly.");
							blocked = true;
						} else if (owned.length !== 1) {
							diagnose(node, "single-entry-count", "A singleton route requires exactly one Entry.");
							blocked = true;
						} else if (!eligible(owned[0])) {
							diagnose(node, "entry-ineligible", "The singleton Entry is excluded by release publication policy.");
							blocked = true;
						} else entries = owned;
					} else if (mapping.document.mode.kind !== "collection" || model.document.kind !== "collection") {
						diagnose(node, "wrong-route-mode", "Entry-field routes require a collection Mapping/model.");
						blocked = true;
					} else {
						const query = evaluateCollectionQuery({
							model,
							providerId,
							entries: snapshot.entries,
							query: {
								...mapping.document.mode.query,
								publication: policy === "release" ? "published-only" : mapping.document.mode.query.publication
							}
						});
						entries = query.entries;
						blocked ||= query.status === "blocked";
						for (const item of query.diagnostics) diagnose(node, `collection-query-${item.code}`, item.message, {
							severity: item.severity,
							...item.entryId ? { entryId: item.entryId } : {}
						});
					}
					metadata.set(node.id, {
						name: mapping.document.name,
						model: model.document.name,
						kind: model.document.kind,
						entryCount: entries.length,
						slugFields: model.document.fields.filter((field) => field.kind === "slug").map(({ id, label }) => ({
							id,
							label
						})),
						titleFields: model.document.fields.filter((field) => isSitemapDisplayTitleFieldKind(field.kind)).map(({ id, label }) => ({
							id,
							label
						}))
					});
					const fieldId = source.route.kind === "entry-field" ? source.route.fieldId : void 0;
					const field = model.document.fields.find(({ id }) => id === fieldId);
					const titleId = source.route.kind === "entry-field" ? source.route.titleFieldId : void 0;
					const titleField = model.document.fields.find(({ id }) => id === titleId);
					if (source.route.kind === "entry-field") {
						if (!field || field.kind !== "slug") {
							diagnose(node, field ? "route-field-not-slug" : "route-field-missing", "The selected Entry route field must be an existing slug field.");
							blocked = true;
						}
						if (titleId !== void 0 && (!titleField || !isSitemapDisplayTitleFieldKind(titleField.kind))) {
							diagnose(node, titleField ? "title-field-not-textual" : "title-field-missing", "The selected Entry title field must be an existing textual field.");
							blocked = true;
						}
					}
					if (!blocked) for (const entry of entries) {
						const segment = field ? entrySegment(entry.values[field.id]) : void 0;
						if (segment && !segment.ok) diagnose(node, segment.missing ? "entry-slug-missing" : "entry-slug-invalid", "Entry slug is missing or contains a forbidden route delimiter.", { entryId: entry.id });
						else {
							const value = titleId ? entry.values[titleId] : void 0;
							variants.push({
								suffix: [...encoded.parts, ...segment?.ok ? [segment.segment] : []].join("/"),
								displayTitle: typeof value === "string" && value.trim() ? value : node.title,
								selectedEntry: {
									providerId,
									modelId: model.id,
									recordId: entry.id
								}
							});
						}
					}
				}
			}
		}
		const children = [];
		for (const child of node.children) children.push(await prepare(child, externalAncestor || /^https?:\/\//i.test(fragment.trim())));
		const descendants = children.reduce((sum, child) => Math.min(10001, sum + child.count), 0);
		return {
			node,
			variants,
			children,
			count: Math.min(10001, variants.length * (1 + descendants))
		};
	};
	const plans = [];
	for (const root of document.root) plans.push(await prepare(root));
	const total = plans.reduce((sum, plan) => Math.min(10001, sum + plan.count), 0);
	const routes = [];
	if (total > cap) diagnostics.push({
		code: "route-limit",
		nodeId: document.root[0]?.id ?? "",
		message: "Sitemap expansion exceeds the 10,000-route limit; no route families were materialized."
	});
	else {
		const emit = (plan, base, ancestors) => {
			for (const variant of plan.variants) {
				const pathname = variant.suffix ? append(base, variant.suffix) : base;
				const route = {
					pathname,
					nodeId: plan.node.id,
					sourceKind: plan.node.source.kind,
					displayTitle: variant.displayTitle,
					ancestors,
					...variant.selectedEntry ? {
						selectedEntry: variant.selectedEntry,
						entryId: variant.selectedEntry.recordId
					} : {}
				};
				routes.push(route);
				const chain = [...ancestors, {
					nodeId: route.nodeId,
					pathname,
					displayTitle: route.displayTitle,
					...route.selectedEntry ? { selectedEntry: route.selectedEntry } : {}
				}];
				for (const child of plan.children) emit(child, pathname, chain);
			}
		};
		for (const plan of plans) emit(plan, "/", []);
	}
	const paths = /* @__PURE__ */ new Map();
	for (const route of routes) {
		const matches = paths.get(route.pathname) ?? [];
		matches.push(route);
		paths.set(route.pathname, matches);
	}
	for (const [path, matches] of paths) if (matches.length > 1) for (const route of matches) diagnostics.push({
		code: "route-collision",
		nodeId: route.nodeId,
		entryId: route.entryId,
		path,
		message: `Route ${path} has ${matches.length} concrete destinations.`
	});
	const nodes = /* @__PURE__ */ new Map();
	for (const node of authored) {
		const localRoutes = routes.filter((route) => route.nodeId === node.id), localDiagnostics = diagnostics.filter((item) => item.nodeId === node.id);
		nodes.set(node.id, {
			derivedRouteCount: localRoutes.length,
			...localRoutes[0] ? { samplePath: localRoutes[0].pathname } : {},
			status: localDiagnostics.some((item) => item.severity !== "nonblocking") ? "blocked" : "ready",
			diagnostics: localDiagnostics,
			...metadata.has(node.id) ? { mapping: metadata.get(node.id) } : {}
		});
	}
	return {
		routes,
		derivedRouteCount: routes.length,
		samplePath: routes[0]?.pathname,
		diagnostics,
		nodes
	};
}
//#endregion
//#region src/sitemapper/routes/navigation.ts
function indexRoutes(routes) {
	const byNode = /* @__PURE__ */ new Map(), paths = /* @__PURE__ */ new Map();
	for (const route of routes) {
		const siblings = byNode.get(route.nodeId) ?? [];
		siblings.push(route);
		byNode.set(route.nodeId, siblings);
		paths.set(route.pathname, (paths.get(route.pathname) ?? 0) + 1);
	}
	return {
		byNode,
		paths
	};
}
function sameSitemapEntry(a, b) {
	return a === void 0 ? b === void 0 : b !== void 0 && a.providerId === b.providerId && a.modelId === b.modelId && a.recordId === b.recordId;
}
function resolveDestination(destination, index) {
	if (destination.kind === "external") return safeNavigationUrl(destination.url) ? {
		status: "resolved",
		href: destination.url,
		external: true
	} : { status: "unsafe" };
	const matches = (index.byNode.get(destination.nodeId) ?? []).filter((route) => (destination.entry === void 0 || sameSitemapEntry(route.selectedEntry, destination.entry)) && (destination.ancestors === void 0 || (() => {
		const ancestors = route.ancestors.filter((ancestor) => ancestor.selectedEntry);
		return ancestors.length === destination.ancestors.length && ancestors.every((ancestor, index) => ancestor.nodeId === destination.ancestors[index].nodeId && sameSitemapEntry(ancestor.selectedEntry, destination.ancestors[index].entry));
	})()));
	if (!matches.length) return { status: "stale" };
	if (matches.length !== 1 || index.paths.get(matches[0].pathname) !== 1) return { status: "ambiguous" };
	return {
		status: "resolved",
		href: matches[0].pathname,
		external: false,
		nodeId: matches[0].nodeId
	};
}
function resolveSitemapNavigation(navigation, routes) {
	const output = {
		primary: [],
		footer: [],
		diagnostics: []
	};
	const index = indexRoutes(routes);
	for (const menu of ["primary", "footer"]) for (const item of navigation[menu]) {
		if (!item.visible) continue;
		const target = resolveDestination(item.destination, index);
		if (target.status !== "resolved") output.diagnostics.push({
			code: `navigation-${target.status}`,
			menu,
			itemId: item.id,
			message: `Navigation item "${item.label}" has a ${target.status} destination.`
		});
		else output[menu].push({
			id: item.id,
			label: item.label,
			href: target.href,
			external: target.external,
			...target.nodeId ? { nodeId: target.nodeId } : {}
		});
	}
	return output;
}
//#endregion
//#region src/assets/references/resolver.ts
function pinValue(pin) {
	return {
		providerId: pin.providerId,
		assetId: pin.assetId,
		versionId: pin.versionId,
		checksum: pin.checksum,
		mimeType: pin.mimeType,
		byteLength: pin.byteLength,
		url: pin.url
	};
}
function parseManagedAssetUrl(value, providerId = "asset-files") {
	if (!value.startsWith("/uploaded-assets/asset-")) return void 0;
	const ref = {
		providerId,
		assetId: value.slice(23)
	};
	return validateAssetAssetRef(ref) && value === assetAuthoringUrl(ref.assetId) ? ref : void 0;
}
function isImmutableAssetUrl(value) {
	return ASSET_CHECKSUM_URL_PATTERN.test(value);
}
function validateAssetReferenceLock(value) {
	if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== "mutationToken,pins,providerId,schemaVersion") return false;
	const lock = value;
	if (lock.schemaVersion !== 1 || !validateAssetAssetRef({
		providerId: lock.providerId,
		assetId: "check"
	}) || !isValidAssetChecksum(lock.mutationToken) || !Array.isArray(lock.pins)) return false;
	const heads = /* @__PURE__ */ new Map();
	return lock.pins.every((entry, index) => {
		if (!entry || !["assetId,byteLength,checksum,headVersionId,metadataRevision,mimeType,providerId,url,versionId", "assetId,byteLength,checksum,fileName,headVersionId,metadataRevision,mimeType,providerId,url,versionId"].includes(Object.keys(entry).sort().join(","))) return false;
		const { metadataRevision, headVersionId, fileName, ...pin } = entry;
		if (Object.hasOwn(entry, "fileName") && !isValidAssetFileName(fileName)) return false;
		const prior = heads.get(entry.assetId);
		if (prior && (prior.revision !== metadataRevision || prior.version !== headVersionId)) return false;
		heads.set(entry.assetId, {
			revision: metadataRevision,
			version: headVersionId
		});
		return validateAssetVersionPin(pin) && isValidAssetChecksum(headVersionId) && entry.providerId === lock.providerId && Number.isSafeInteger(metadataRevision) && metadataRevision > 0 && (index === 0 || assetPinKey(lock.pins[index - 1]) < assetPinKey(pin));
	});
}
function resolvePinnedAsset(ref, lock) {
	if (!validateAssetAssetRef(ref) && !validateAssetVersionRef(ref) || !validateAssetReferenceLock(lock)) return void 0;
	const matches = lock.pins.filter((pin) => pin.providerId === ref.providerId && pin.assetId === ref.assetId && ("versionId" in ref ? pin.versionId === ref.versionId : pin.versionId === pin.headVersionId));
	if (matches.length !== 1) return void 0;
	return pinValue(matches[0]);
}
//#endregion
//#region src/site-project/assets/markdown.ts
var label = (value) => value.replace(/\s+/g, " ").trim().toUpperCase();
function decodeDestination(value) {
	return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, "$1").replace(/&(?:#(\d+)|#x([a-f\d]+)|(amp|lt|gt|quot|apos|sol|colon|lowbar|period));/gi, (source, decimal, hex, named) => {
		if (named) return {
			amp: "&",
			lt: "<",
			gt: ">",
			quot: "\"",
			apos: "'",
			sol: "/",
			colon: ":",
			lowbar: "_",
			period: "."
		}[named.toLowerCase()] ?? source;
		const point = Number.parseInt(decimal || hex, decimal ? 10 : 16);
		return point > 0 && point <= 1114111 && !(point >= 55296 && point <= 57343) ? String.fromCodePoint(point) : "�";
	});
}
/** Only AST link/image destinations are eligible for rewriting. Titles, code,
* raw HTML, surrounding prose, and unused reference definitions are untouched. */
function markdownAssetDestinations(source) {
	const tree = parser.parse(source), definitions = /* @__PURE__ */ new Map();
	const uses = [];
	tree.iterate({ enter(node) {
		if (node.name === "LinkReference") {
			const id = node.node.getChild("LinkLabel"), url = node.node.getChild("URL");
			if (id && url) {
				const key = label(source.slice(id.from + 1, id.to - 1));
				if (!definitions.has(key)) definitions.set(key, url);
			}
		} else if (node.name === "Link" || node.name === "Image" || node.name === "Autolink") uses.push(node.node);
	} });
	return uses.flatMap((use) => {
		let url = use.getChild("URL");
		if (!url) {
			const reference = use.getChild("LinkLabel"), raw = reference ? source.slice(reference.from + 1, reference.to - 1) : "";
			const closing = use.getChildren("LinkMark").find((mark) => source.slice(mark.from, mark.to) === "]");
			const key = label(raw || source.slice(use.from + (use.name === "Image" ? 2 : 1), closing?.from ?? use.to - 1));
			url = definitions.get(key) ?? null;
		}
		if (!url) return [];
		let from = url.from, to = url.to;
		if (source[from] === "<" && source[to - 1] === ">") {
			from++;
			to--;
		}
		return [{
			from,
			to,
			useFrom: use.from,
			useTo: use.to,
			value: decodeDestination(source.slice(from, to)),
			kind: use.name === "Image" ? "image" : "link"
		}];
	});
}
function rewriteMarkdownDestinations(source, resolve) {
	const edits = /* @__PURE__ */ new Map();
	for (const destination of markdownAssetDestinations(source)) {
		const value = resolve(destination);
		if (value !== void 0 && value !== destination.value) edits.set(`${destination.from}:${destination.to}`, {
			...destination,
			value
		});
	}
	let output = source;
	for (const edit of [...edits.values()].sort((a, b) => b.from - a.from)) output = output.slice(0, edit.from) + edit.value + output.slice(edit.to);
	return output;
}
//#endregion
//#region src/site-project/assets/impact.ts
var URL_PROPERTIES = /* @__PURE__ */ new Set([
	"src",
	"href",
	"poster",
	"url"
]);
var managedHint = (value) => value.includes("/uploaded-assets/asset-") || value.includes("/uploaded-assets/sha256-");
function collector(options = {}) {
	const index = {
		complete: true,
		references: [],
		advisory: []
	};
	const advisory = (location, reason, value, unknown = false) => {
		index.advisory.push({
			location,
			reason,
			value
		});
		if (unknown) index.complete = false;
	};
	const url = (value, location) => {
		if (options.preservePinnedUrls && isImmutableAssetUrl(value)) return value;
		const providerId = options.providerId ?? options.lock?.providerId;
		if (!providerId && managedHint(value)) {
			advisory(location, "Managed URL requires an available Assets provider identity.", value, true);
			return value;
		}
		const ref = providerId ? parseManagedAssetUrl(value, providerId) : void 0;
		if (ref) {
			index.references.push({
				ref,
				location
			});
			return options.lock ? resolvePinnedAsset(ref, options.lock)?.url ?? value : value;
		}
		if (isImmutableAssetUrl(value)) {
			const matches = options.lock?.pins.filter((pin) => pin.url === value).map(({ providerId, assetId, versionId }) => ({
				providerId,
				assetId,
				versionId
			})) ?? options.snapshot?.records.flatMap((record) => record.document.versions.filter((version) => version.url === value).map((version) => ({
				providerId,
				assetId: record.id,
				versionId: version.id
			})));
			if (matches?.length) for (const exact of matches) index.references.push({
				ref: exact,
				location
			});
			else advisory(location, "Immutable Assets URL has no known asset/version association.", value, true);
			return value;
		}
		advisory(location, managedHint(value) ? "Unrecognized managed URL; it was not rewritten." : "External or unmanaged URL preserved verbatim.", value, managedHint(value));
		return value;
	};
	const markdown = (value, location) => {
		const downloads = assetDownloadBlocks(value);
		for (const item of downloads) {
			if (!item.block) {
				advisory(location, "Malformed managed download block.", value.slice(item.from, item.to), true);
				continue;
			}
			if (options.preservePinnedUrls && item.block.resolved) continue;
			const ref = item.block.use.asset;
			index.references.push({
				ref,
				location: {
					...location,
					markdown: {
						from: item.from,
						to: item.to,
						useFrom: item.from,
						useTo: item.to
					}
				}
			});
			if (options.lock) {
				const pin = resolvePinnedAsset(ref, options.lock);
				const metadata = options.lock.pins.find((candidate) => candidate.providerId === pin?.providerId && candidate.assetId === pin?.assetId && candidate.versionId === pin?.versionId);
				if (!pin || !metadata?.fileName) advisory(location, "Download display metadata is absent from the captured Assets lock.", value.slice(item.from, item.to), true);
			}
		}
		const destinations = markdownAssetDestinations(value);
		for (const destination of destinations) url(destination.value, {
			...location,
			markdown: {
				from: destination.from,
				to: destination.to,
				useFrom: destination.useFrom,
				useTo: destination.useTo
			}
		});
		let offset = value.indexOf("/uploaded-assets/");
		while (offset >= 0) {
			if (!destinations.some(({ from, to }) => offset >= from && offset < to)) advisory(location, "Managed-looking text outside a parsed Markdown destination is advisory only.", value.slice(offset, offset + 120), true);
			offset = value.indexOf("/uploaded-assets/", offset + 1);
		}
		if (options.lock && downloads.length) for (const item of [...downloads].reverse()) {
			if (!item.block) continue;
			const pin = resolvePinnedAsset(item.block.use.asset, options.lock);
			const metadata = options.lock.pins.find((candidate) => candidate.providerId === pin?.providerId && candidate.assetId === pin?.assetId && candidate.versionId === pin?.versionId);
			if (!pin || !metadata?.fileName) continue;
			const resolved = {
				url: pin.url,
				fileName: assetDownloadFileName(metadata.fileName, pin.mimeType),
				mimeType: pin.mimeType,
				byteLength: pin.byteLength
			};
			value = value.slice(0, item.from) + assetDownloadMarkdown(item.block.use, resolved) + value.slice(item.to);
		}
		return options.lock ? rewriteMarkdownDestinations(value, (destination) => {
			const ref = parseManagedAssetUrl(destination.value, options.providerId ?? options.lock.providerId);
			return ref ? resolvePinnedAsset(ref, options.lock)?.url : void 0;
		}) : value;
	};
	const arbitrary = (value, location) => {
		if (typeof value === "string" && managedHint(value)) advisory(location, "Managed-looking value has no supported URL/Markdown declaration.", value, true);
		else if (validateAssetAssetRef(value)) index.references.push({
			ref: value,
			location
		});
		else if (Array.isArray(value)) value.forEach((item, i) => arbitrary(item, {
			...location,
			valuePath: [...location.valuePath, i]
		}));
		else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) arbitrary(item, {
			...location,
			valuePath: [...location.valuePath, key]
		});
	};
	const content = (schema, value, location) => {
		if (value === void 0) return value;
		if (schema.kind === "asset-use" && value && typeof value === "object" && !Array.isArray(value) && validateAssetAssetRef(value.asset)) {
			index.references.push({
				ref: value.asset,
				location: {
					...location,
					selectionPath: location.valuePath,
					valuePath: [...location.valuePath, "asset"]
				}
			});
			return value;
		}
		if (schema.kind === "url" && typeof value === "string") return url(value, location);
		if (schema.kind === "markdown" && typeof value === "string") return markdown(value, location);
		if (schema.kind === "object" && value && typeof value === "object" && !Array.isArray(value)) for (const field of schema.fields) {
			const next = content(field, value[field.id], {
				...location,
				valuePath: [...location.valuePath, field.id]
			});
			if (next !== void 0) value[field.id] = next;
		}
		else if (schema.kind === "list" && Array.isArray(value)) value.forEach((item, i) => {
			value[i] = content(schema.item, item, {
				...location,
				valuePath: [...location.valuePath, i]
			});
		});
		else arbitrary(value, location);
		return value;
	};
	const property = (schema, value, location, key) => {
		if (typeof value === "string" && schema.schema.type === "string") {
			if (schema.editor.kind === "text" && schema.editor.mode === "markdown-source") return markdown(value, location);
			if (URL_PROPERTIES.has(key) || "format" in schema.schema && schema.schema.format === "url") return url(value, location);
		}
		if (schema.schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
			if (validateAssetAssetRef(value)) index.references.push({
				ref: value,
				location
			});
			else for (const field of schema.schema.fields) {
				const next = property(field, value[field.key], {
					...location,
					valuePath: [...location.valuePath, field.key]
				}, field.key);
				if (next !== void 0) value[field.key] = next;
			}
		} else if (schema.schema.type === "array" && Array.isArray(value)) value.forEach((item, i) => {
			value[i] = property(schema.schema.type === "array" ? schema.schema.items : schema, item, {
				...location,
				valuePath: [...location.valuePath, i]
			}, key);
		});
		else if (schema.schema.type === "tuple" && Array.isArray(value)) schema.schema.items.forEach((field, i) => {
			if (value[i] !== void 0) value[i] = property(field, value[i], {
				...location,
				valuePath: [...location.valuePath, i]
			}, key);
		});
		else arbitrary(value, location);
		return value;
	};
	const composition = (document, catalog, location) => {
		const walk = (nodes) => {
			for (const node of nodes) {
				const component = catalog.get(node.componentId);
				if (component) node.props = {
					...structuredClone(component.defaults),
					...node.props
				};
				if (!component) {
					index.complete = false;
					index.advisory.push({
						location: {
							...location,
							nodeId: node.id,
							valuePath: []
						},
						reason: "Component declaration is unavailable; usage cannot be proven complete."
					});
				}
				for (const [key, value] of Object.entries(node.props)) {
					const at = {
						...location,
						nodeId: node.id,
						property: key,
						valuePath: [key]
					};
					const field = component?.fields.find((field) => field.prop === key);
					if (field && typeof value === "string" && field.editor.kind === "text" && field.editor.mode === "markdown-source" && assetDownloadBlocks(value).length && downloadMarkdownProperty(component, node.props) !== key) advisory(at, "Download blocks require a component with one Markdown field and no slots.", value, true);
					if (field) node.props[key] = property(field, value, at, key);
					else arbitrary(value, at);
				}
				for (const children of Object.values(node.slots)) walk(children);
			}
		};
		walk(document.root);
	};
	return {
		index,
		content,
		composition
	};
}
function resolveCompositionAsset(document, catalog, options = {}) {
	const output = structuredClone(document), scan = collector(options);
	scan.composition(output, catalog, {
		domain: "compositions",
		providerId: "preview",
		recordId: document.id
	});
	return {
		document: output,
		index: scan.index
	};
}
function resolveSiteProjectAsset(project, catalog, options = {}) {
	const output = structuredClone(project), scan = collector(options);
	for (const provider of output.providers.content) for (const entry of provider.entries) {
		const model = provider.models.find(({ id }) => id === entry.modelId);
		if (!model) {
			scan.index.complete = false;
			continue;
		}
		for (const field of model.document.fields) {
			const value = scan.content(field, entry.values[field.id], {
				domain: "content",
				providerId: provider.id,
				modelId: model.id,
				recordId: entry.id,
				fieldId: field.id,
				valuePath: []
			});
			if (value !== void 0) entry.values[field.id] = value;
		}
	}
	for (const provider of output.providers.compositions) for (const record of provider.records) scan.composition(record.document, catalog, {
		domain: "compositions",
		providerId: provider.id,
		recordId: record.id
	});
	for (const route of options.routes ?? []) {
		const start = scan.index.references.length;
		const document = structuredClone(route.composition.document);
		scan.composition(document, catalog, {
			domain: "materialization",
			providerId: route.composition.local.providerId,
			recordId: route.composition.local.recordId,
			sourceRecordId: route.composition.local.recordId,
			pathname: route.pathname
		});
		if (route.composition.linkedSource) scan.composition(structuredClone(route.composition.linkedSource.document), catalog, {
			domain: "materialization",
			providerId: route.composition.linkedSource.ref.providerId,
			recordId: route.composition.linkedSource.ref.recordId,
			sourceRecordId: route.composition.linkedSource.ref.recordId,
			pathname: route.pathname
		});
		for (const impact of scan.index.references.slice(start)) {
			const source = route.materializationSources?.find((source) => source.renderedNodeId === impact.location.nodeId);
			if (source) impact.location = {
				...impact.location,
				providerId: source.providerId,
				recordId: source.recordId,
				sourceRecordId: source.recordId,
				nodeId: source.nodeId,
				attachmentId: source.attachmentId,
				entries: source.entries
			};
		}
	}
	scan.index.references.sort((a, b) => compareUnicodeCodePoints(JSON.stringify([a.ref, a.location]), JSON.stringify([b.ref, b.location])));
	return {
		project: output,
		index: scan.index
	};
}
//#endregion
//#region src/site-project/model/provider-registry.ts
/**
* Stable SiteProject provider ids and their current browser-provider ids.
*
* Authoring persists to the host project's files, so every domain names its
* filesystem provider. Keeping the mapping explicit prevents adapters from
* accepting arbitrary provider strings and leaves the portable contract
* independent of browser provider construction; the two identities happen to
* match again today.
*/
var SITE_PROJECT_PROVIDER_REGISTRY = Object.freeze({
	compositions: Object.freeze({ files: Object.freeze({
		logicalId: "files",
		browserProviderId: "files"
	}) }),
	content: Object.freeze({ "content-filesystem": Object.freeze({
		logicalId: "content-filesystem",
		browserProviderId: "content-filesystem"
	}) }),
	mappings: Object.freeze({ "mapping-filesystem": Object.freeze({
		logicalId: "mapping-filesystem",
		browserProviderId: "mapping-filesystem"
	}) }),
	sitemaps: Object.freeze({ "sitemap-filesystem": Object.freeze({
		logicalId: "sitemap-filesystem",
		browserProviderId: "sitemap-filesystem"
	}) })
});
function isSiteProjectProviderId(domain, value) {
	return typeof value === "string" && Object.hasOwn(SITE_PROJECT_PROVIDER_REGISTRY[domain], value);
}
function browserProviderIdFor(domain, logicalId) {
	return SITE_PROJECT_PROVIDER_REGISTRY[domain][logicalId].browserProviderId;
}
//#endregion
//#region src/site-project/model/memory.ts
function deepFreeze(value) {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
function readonlyMap(source) {
	const facade = Object.freeze({
		get size() {
			return source.size;
		},
		get: (key) => source.get(key),
		has: (key) => source.has(key),
		entries: () => source.entries(),
		keys: () => source.keys(),
		values: () => source.values(),
		forEach: (callback, thisArg) => {
			source.forEach((value, key) => callback.call(thisArg, value, key, facade));
		},
		[Symbol.iterator]: () => source[Symbol.iterator]()
	});
	return facade;
}
function createDomainAdapters(domain, collections) {
	const providers = collections.map((collection) => {
		const records = collection.records;
		const byId = new Map(records.map((record) => [record.id, record]));
		const store = Object.freeze({
			providerId: collection.id,
			list: () => records,
			get: (recordId) => byId.get(recordId)
		});
		return Object.freeze({
			descriptor: Object.freeze({
				id: collection.id,
				browserProviderId: browserProviderIdFor(domain, collection.id)
			}),
			store
		});
	});
	const storeIndex = new Map(providers.map((provider) => [provider.descriptor.id, provider.store]));
	const stores = readonlyMap(storeIndex);
	const entries = providers.flatMap((provider) => provider.store.list().map((record) => Object.freeze({
		ref: Object.freeze({
			providerId: provider.descriptor.id,
			recordId: record.id
		}),
		record
	})));
	const catalog = Object.freeze({
		list: () => entries,
		resolve: (ref) => storeIndex.get(ref.providerId)?.get(ref.recordId)
	});
	return Object.freeze({
		providers: Object.freeze(providers),
		stores,
		catalog
	});
}
function createContentAdapters(collections) {
	const providers = collections.map((collection) => {
		const models = collection.models;
		const entries = collection.entries;
		const modelsById = new Map(models.map((record) => [record.id, record]));
		const entriesById = new Map(entries.map((record) => [record.id, record]));
		const store = Object.freeze({
			providerId: collection.id,
			listModels: () => models,
			getModel: (recordId) => modelsById.get(recordId),
			listEntries: (modelId) => modelId === void 0 ? entries : entries.filter((entry) => entry.modelId === modelId),
			getEntry: (recordId) => entriesById.get(recordId)
		});
		return Object.freeze({
			descriptor: Object.freeze({
				id: collection.id,
				browserProviderId: browserProviderIdFor("content", collection.id)
			}),
			store
		});
	});
	const storeIndex = new Map(providers.map((provider) => [provider.descriptor.id, provider.store]));
	const stores = readonlyMap(storeIndex);
	const modelEntries = providers.flatMap((provider) => provider.store.listModels().map((record) => Object.freeze({
		ref: Object.freeze({
			providerId: provider.descriptor.id,
			recordId: record.id
		}),
		record
	})));
	const contentEntries = providers.flatMap((provider) => provider.store.listEntries().map((record) => Object.freeze({
		ref: Object.freeze({
			providerId: provider.descriptor.id,
			recordId: record.id
		}),
		record
	})));
	const catalog = Object.freeze({
		listModels: () => modelEntries,
		resolveModel: (ref) => storeIndex.get(ref.providerId)?.getModel(ref.recordId),
		listEntries: (modelRef) => modelRef === void 0 ? contentEntries : contentEntries.filter((entry) => entry.ref.providerId === modelRef.providerId && entry.record.modelId === modelRef.recordId),
		resolveEntry: (ref) => storeIndex.get(ref.providerId)?.getEntry(ref.recordId)
	});
	return Object.freeze({
		providers: Object.freeze(providers),
		stores,
		catalog
	});
}
/** Builds immutable, read-only provider/store/catalog views over a detached snapshot. */
function createInMemorySiteProjectAdapters(project) {
	const snapshot = deepFreeze(canonicalizeSiteProject(project));
	const compositions = createDomainAdapters("compositions", snapshot.providers.compositions);
	const content = createContentAdapters(snapshot.providers.content);
	const mappings = createDomainAdapters("mappings", snapshot.providers.mappings);
	const sitemaps = createDomainAdapters("sitemaps", snapshot.providers.sitemaps);
	const activeSitemap = sitemaps.catalog.resolve(snapshot.activeSitemap);
	if (!activeSitemap) throw new TypeError("SiteProject active Sitemap is missing; validate the project before creating adapters.");
	return Object.freeze({
		project: snapshot,
		compositions,
		content,
		mappings,
		sitemaps,
		activeSitemap
	});
}
//#endregion
//#region src/site-project/compiler/compiler.ts
function selector(domain, providerId, collection, recordId) {
	return `$["providers"][${JSON.stringify(domain)}][?(@.id==${JSON.stringify(providerId)})][${JSON.stringify(collection)}][?(@.id==${JSON.stringify(recordId)})]`;
}
function nodeSelector(active, nodeId) {
	return `${selector("sitemaps", active.providerId, "records", active.recordId)}["document"]["root"]..[?(@.id==${JSON.stringify(nodeId)})]`;
}
function entrySelector(ref) {
	return selector("content", ref.providerId, "entries", ref.recordId);
}
function mappingSelector(ref) {
	return selector("mappings", ref.providerId, "records", ref.recordId);
}
function compositionSelector(ref) {
	return selector("compositions", ref.providerId, "records", ref.recordId);
}
function refKey(ref) {
	return `${ref.providerId}\u0000${ref.recordId}`;
}
function findCompositionNode(nodes, id) {
	for (const node of nodes) {
		if (node.id === id) return node;
		for (const children of Object.values(node.slots)) {
			const found = findCompositionNode(children, id);
			if (found) return found;
		}
	}
}
function repeatIdentityPart(value) {
	return `${value.length.toString(36)}_${value}`;
}
function repeatedNodeId(attachmentId, entryId, nodeId) {
	return `__zudo_collection_${repeatIdentityPart(attachmentId)}_${repeatIdentityPart(entryId)}_${repeatIdentityPart(nodeId)}`;
}
function cloneRepeatedNodes(nodes, attachmentId, entryId) {
	return nodes.map((node) => ({
		...structuredClone(node),
		id: repeatedNodeId(attachmentId, entryId, node.id),
		slots: Object.fromEntries(Object.entries(node.slots).map(([slotId, children]) => [slotId, cloneRepeatedNodes(children, attachmentId, entryId)]))
	}));
}
function countNodes(nodes) {
	return nodes.reduce((count, node) => count + 1 + Object.values(node.slots).reduce((sum, children) => sum + countNodes(children), 0), 0);
}
function nodeIds(nodes) {
	return nodes.flatMap((node) => [node.id, ...Object.values(node.slots).flatMap(nodeIds)]);
}
var MAX_MATERIALIZED_NODES = 1e4;
function compareOptional(left, right) {
	return compareUnicodeCodePoints(left ?? "", right ?? "");
}
function compareDiagnostics$1(left, right) {
	return compareUnicodeCodePoints(left.path, right.path) || compareOptional(left.pathname, right.pathname) || compareOptional(left.nodeId, right.nodeId) || compareOptional(left.entry?.providerId, right.entry?.providerId) || compareOptional(left.entry?.recordId, right.entry?.recordId) || compareUnicodeCodePoints(left.code, right.code) || compareUnicodeCodePoints(left.message, right.message);
}
function compareRoutes(left, right) {
	return compareUnicodeCodePoints(left.pathname, right.pathname) || compareUnicodeCodePoints(left.sitemapNode.id, right.sitemapNode.id) || compareOptional(left.selectedEntry?.providerId, right.selectedEntry?.providerId) || compareOptional(left.selectedEntry?.recordId, right.selectedEntry?.recordId);
}
function compareModules(left, right) {
	return compareUnicodeCodePoints(left.moduleSpecifier, right.moduleSpecifier) || compareUnicodeCodePoints(left.recordId, right.recordId) || compareUnicodeCodePoints(left.kind, right.kind) || compareUnicodeCodePoints(left.code, right.code);
}
function indexNodes(nodes, active, target, ancestors = []) {
	for (const node of nodes) {
		const fragments = [...ancestors, node.slug ?? ""];
		target.set(node.id, {
			node,
			path: nodeSelector(active, node.id),
			pathname: authoredPath(fragments)
		});
		indexNodes(node.children, active, target, fragments);
	}
}
function escapedIdentityPart(value) {
	let output = "";
	for (const point of value) output += `${point.codePointAt(0).toString(16).padStart(6, "0")}-`;
	return output || "empty-";
}
function stableHash(value, seed) {
	let hash = seed;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= BigInt(value.charCodeAt(index));
		hash = BigInt.asUintN(64, hash * 1099511628211n);
	}
	return hash.toString(16).padStart(16, "0");
}
function routeIdentity(project, route, active, occupied) {
	const values = [
		project.id,
		active.providerId,
		active.recordId,
		route.nodeId,
		route.selectedEntry,
		route.ancestors.map(({ nodeId, selectedEntry }) => ({
			nodeId,
			selectedEntry
		})),
		route.pathname
	];
	const input = JSON.stringify(values);
	const base = `site-route-${stableHash(input, 14695981039346656037n)}${stableHash(input, 9521211207457086692n)}`;
	let id = base;
	let collision = 0;
	while (occupied.has(id)) {
		collision += 1;
		id = `${base}-${collision}`;
	}
	occupied.add(id);
	return id;
}
function cloneDocument(document) {
	return structuredClone(document);
}
function projectRouteDiagnostic(diagnostic, indexed, entryProviderId) {
	return {
		severity: "blocking",
		code: diagnostic.code,
		message: diagnostic.message,
		path: indexed.path,
		nodeId: diagnostic.nodeId,
		pathname: diagnostic.path ?? indexed.pathname,
		...diagnostic.entryId ? { entry: {
			providerId: entryProviderId ?? "unknown",
			recordId: diagnostic.entryId
		} } : {}
	};
}
function resolutionMessage(resolution) {
	switch (resolution.status) {
		case "unbound": return "The linked Composition unexpectedly resolved as unbound.";
		case "missing-template": return "The linked Global template could not be resolved.";
		case "missing-outlet": return "The linked Global template outlet is missing.";
		case "invalid-template": return "The linked source is not a valid Global template.";
		case "nested-template": return "A linked Global template cannot itself be linked.";
		case "self-reference": return "The Composition links to itself as a Global template.";
		case "incompatible-local-root": return resolution.message;
	}
}
function bindingCycle(providerId, localId, local, resolve) {
	const visited = /* @__PURE__ */ new Map();
	const chain = [];
	let currentId = localId;
	let current = local;
	while (current) {
		const seenAt = visited.get(currentId);
		if (seenAt !== void 0) return [...chain.slice(seenAt), currentId];
		visited.set(currentId, chain.length);
		chain.push(currentId);
		const next = current.document.binding?.sourceRecordId;
		if (!next) return void 0;
		currentId = next;
		current = resolve({
			providerId,
			recordId: next
		});
	}
}
function dependencyClosure(providerId, local, resolve) {
	const records = [];
	const seen = /* @__PURE__ */ new Set();
	let next = local.document.binding?.sourceRecordId;
	while (next && !seen.has(next)) {
		seen.add(next);
		const record = resolve({
			providerId,
			recordId: next
		});
		if (!record) break;
		records.push(record);
		next = record.document.binding?.sourceRecordId;
	}
	return records.sort((left, right) => compareUnicodeCodePoints(left.id, right.id));
}
function moduleSpecifier(providerId, routeRecordId, recordId) {
	return recordId === routeRecordId ? `@site-project/routes/${routeRecordId}` : `@site-project/compositions/${escapedIdentityPart(providerId)}${escapedIdentityPart(recordId)}`;
}
function asModule(plan) {
	return {
		recordId: plan.recordId,
		moduleSpecifier: plan.moduleSpecifier,
		kind: plan.kind,
		code: plan.code
	};
}
/**
* Compile a validated, portable SiteProject snapshot into deterministic route
* and linked-JSX manifests. All reads are completed from one detached in-memory
* snapshot; no provider, runtime component, or platform API is imported.
*/
async function compileSiteProject(project, options) {
	if (options.assetLock && !validateAssetReferenceLock(options.assetLock)) return {
		status: "blocked",
		routes: [],
		diagnostics: [{
			severity: "blocking",
			code: "asset-lock-invalid",
			message: "The exact-version Assets lock is invalid.",
			path: "$.assetLock"
		}]
	};
	const assets = resolveSiteProjectAsset(project, options.componentCatalog, { lock: options.assetLock });
	const assetMissing = assets.index.references.filter(({ ref }) => !options.assetLock || !resolvePinnedAsset(ref, options.assetLock));
	if ((options.policy ?? "release") === "release" && !assets.index.complete) return {
		status: "blocked",
		routes: [],
		diagnostics: [{
			severity: "blocking",
			code: "asset-impact-incomplete",
			message: "Managed Assets inspection is incomplete. " + assets.index.advisory.map(({ reason }) => reason).join(" "),
			path: "$.assetLock"
		}]
	};
	if ((options.policy ?? "release") === "release" && assets.index.advisory.some(({ value }) => value && isImmutableAssetUrl(value))) return {
		status: "blocked",
		routes: [],
		diagnostics: [{
			severity: "blocking",
			code: "asset-lock-required",
			message: "An immutable Assets URL has no verified lock association.",
			path: "$.assetLock"
		}]
	};
	if ((options.policy ?? "release") === "release" && assetMissing.length) return {
		status: "blocked",
		routes: [],
		diagnostics: assetMissing.map(({ location }) => ({
			severity: "blocking",
			code: "asset-lock-required",
			message: "Required managed Assets must be captured in an exact-version lock before release compilation.",
			path: JSON.stringify(location)
		}))
	};
	project = assets.project;
	const adapters = createInMemorySiteProjectAdapters(project);
	const snapshot = adapters.project;
	const active = snapshot.activeSitemap;
	const diagnostics = [];
	const indexedNodes = /* @__PURE__ */ new Map();
	indexNodes(adapters.activeSitemap.document.root, active, indexedNodes);
	const mappingRefs = /* @__PURE__ */ new Map();
	for (const item of adapters.mappings.catalog.list()) mappingRefs.set(item.record, item.ref);
	const preparedByRecord = /* @__PURE__ */ new Map();
	const mappingCompositionCatalog = {
		async resolve(ref) {
			const record = adapters.compositions.catalog.resolve(ref);
			return record ? {
				status: "resolved",
				record
			} : { status: "not-found" };
		},
		async list() {
			return {
				status: "listed",
				entries: [],
				failures: []
			};
		}
	};
	const mappingContentCatalog = {
		async resolveModel(ref) {
			const record = adapters.content.catalog.resolveModel(ref);
			return record ? {
				status: "resolved",
				record
			} : { status: "not-found" };
		},
		async listModels() {
			return {
				status: "listed",
				entries: [],
				failures: []
			};
		}
	};
	const prepareMapping = (mapping) => {
		const cached = preparedByRecord.get(mapping);
		if (cached) return cached;
		const promise = (async () => {
			const ref = mappingRefs.get(mapping) ?? {
				providerId: "",
				recordId: mapping.id
			};
			const modelRef = mapping.document.contentModel;
			const model = adapters.content.catalog.resolveModel(modelRef);
			const entries = model ? adapters.content.catalog.listEntries(modelRef).map((item) => item.record) : [];
			const content = model ? {
				status: "resolved",
				model,
				snapshot: {
					model,
					entries,
					count: entries.length,
					diagnostics: []
				}
			} : { status: "not-found" };
			return {
				ref,
				mapping,
				definition: await resolveMappingDefinition(mapping, {
					content: mappingContentCatalog,
					compositions: mappingCompositionCatalog
				}, options.componentCatalog),
				content
			};
		})();
		preparedByRecord.set(mapping, promise);
		return promise;
	};
	const materializationSources = /* @__PURE__ */ new Map();
	const materializeCollectionAttachments = async (ownerRef, sourceDocument, routeContext, stack = [], nodeBudget = MAX_MATERIALIZED_NODES) => {
		const ownerKey = refKey(ownerRef);
		if (stack.includes(ownerKey)) {
			diagnostics.push({
				severity: "blocking",
				code: "attachment-cycle",
				message: `Collection attachment cycle: ${[...stack, ownerKey].join(" -> ")}.`,
				path: "$.collectionAttachments",
				...routeContext
			});
			return;
		}
		const sourceNodeCount = countNodes(sourceDocument.root);
		if (sourceNodeCount > nodeBudget) {
			diagnostics.push({
				severity: "blocking",
				code: "attachment-materialization-limit",
				message: `Collection attachment materialization exceeds the ${MAX_MATERIALIZED_NODES.toLocaleString("en-US")} component-node limit.`,
				path: "$.collectionAttachments",
				...routeContext
			});
			return;
		}
		const document = cloneDocument(sourceDocument);
		const attachments = snapshot.collectionAttachments.filter((item) => refKey(item.composition) === ownerKey).sort((left, right) => left.order - right.order || compareUnicodeCodePoints(left.id, right.id));
		const occupied = /* @__PURE__ */ new Set();
		const occupiedNodeIds = new Set(nodeIds(document.root));
		let total = sourceNodeCount;
		for (const attachment of attachments) {
			const attachmentPath = `$.collectionAttachments[?(@.id==${JSON.stringify(attachment.id)})]`;
			const slotKey = `${attachment.target.nodeId}\u0000${attachment.target.slotId}`;
			if (occupied.has(slotKey)) {
				diagnostics.push({
					severity: "blocking",
					code: "attachment-slot-conflict",
					message: "Multiple collection attachments target the same named slot.",
					path: attachmentPath,
					...routeContext
				});
				return;
			}
			occupied.add(slotKey);
			const targetNode = findCompositionNode(document.root, attachment.target.nodeId);
			const slot = (targetNode ? options.componentCatalog.get(targetNode.componentId) : void 0)?.slots.find((candidate) => candidate.id === attachment.target.slotId);
			if (!targetNode || !slot) {
				diagnostics.push({
					severity: "blocking",
					code: "attachment-target-invalid",
					message: "Collection attachment target node/named slot is unavailable.",
					path: attachmentPath,
					...routeContext
				});
				return;
			}
			const mapping = adapters.mappings.catalog.resolve(attachment.mapping);
			if (!mapping) {
				diagnostics.push({
					severity: "blocking",
					code: "attachment-mapping-not-found",
					message: "Collection attachment Mapping was not found.",
					path: attachmentPath,
					...routeContext
				});
				return;
			}
			if (mapping.document.mode.kind !== "collection") {
				diagnostics.push({
					severity: "blocking",
					code: "attachment-mapping-not-collection",
					message: "Collection attachment Mapping is not in collection mode.",
					path: attachmentPath,
					...routeContext
				});
				return;
			}
			const prepared = await prepareMapping(mapping);
			if (prepared.definition.status !== "ready" || !prepared.definition.composition || prepared.content.status !== "resolved") {
				diagnostics.push({
					severity: "blocking",
					code: "attachment-mapping-blocked",
					message: "Collection attachment Mapping definition could not be resolved.",
					path: attachmentPath,
					...routeContext
				});
				return;
			}
			if (prepared.definition.composition.document.binding) {
				diagnostics.push({
					severity: "blocking",
					code: "attachment-linked-source-unsupported",
					message: "Collection attachments require a detached Mapping Composition.",
					path: attachmentPath,
					...routeContext
				});
				return;
			}
			const query = evaluateCollectionQuery({
				model: prepared.content.model,
				providerId: mapping.document.contentModel.providerId,
				entries: prepared.content.snapshot.entries,
				query: {
					...mapping.document.mode.query,
					publication: options.policy === "authoring-preview" ? mapping.document.mode.query.publication : "published-only"
				}
			});
			for (const item of query.diagnostics) if (item.severity === "blocking") diagnostics.push({
				severity: "blocking",
				code: `attachment-${item.code}`,
				message: item.message,
				path: attachmentPath,
				...routeContext,
				...item.entryId ? { entry: {
					providerId: mapping.document.contentModel.providerId,
					recordId: item.entryId
				} } : {}
			});
			if (query.status === "blocked") return void 0;
			const roots = [];
			for (const entry of query.entries) {
				const remaining = nodeBudget - total;
				if (countNodes(prepared.definition.composition.document.root) > remaining) {
					diagnostics.push({
						severity: "blocking",
						code: "attachment-materialization-limit",
						message: `Collection attachment materialization exceeds the ${MAX_MATERIALIZED_NODES.toLocaleString("en-US")} component-node limit.`,
						path: attachmentPath,
						...routeContext
					});
					return;
				}
				const evaluation = evaluateResolvedMapping(prepared.definition, entry, { routeResolver: routeProjectionResolver(routeContext.pathname) });
				if (evaluation.status !== "ready" || !evaluation.document) {
					diagnostics.push({
						severity: "blocking",
						code: "attachment-entry-mapping-blocked",
						message: `Collection Entry "${entry.id}" could not be mapped.`,
						path: attachmentPath,
						...routeContext,
						entry: {
							providerId: mapping.document.contentModel.providerId,
							recordId: entry.id
						}
					});
					return;
				}
				const nested = await materializeCollectionAttachments(mapping.document.composition, evaluation.document, routeContext, [...stack, ownerKey], remaining);
				if (!nested) return void 0;
				const repeatedCount = countNodes(nested.root);
				if (repeatedCount > remaining) {
					diagnostics.push({
						severity: "blocking",
						code: "attachment-materialization-limit",
						message: `Collection attachment materialization exceeds the ${MAX_MATERIALIZED_NODES.toLocaleString("en-US")} component-node limit.`,
						path: attachmentPath,
						...routeContext
					});
					return;
				}
				const repeatedIds = nodeIds(nested.root).map((id) => repeatedNodeId(attachment.id, entry.id, id));
				if (new Set(repeatedIds).size !== repeatedIds.length || repeatedIds.some((id) => occupiedNodeIds.has(id))) {
					diagnostics.push({
						severity: "blocking",
						code: "attachment-node-id-conflict",
						message: `Stable repeated node identity for Entry "${entry.id}" conflicts with an authored or generated node.`,
						path: attachmentPath,
						...routeContext,
						entry: {
							providerId: mapping.document.contentModel.providerId,
							recordId: entry.id
						}
					});
					return;
				}
				for (const id of repeatedIds) occupiedNodeIds.add(id);
				const sources = materializationSources.get(routeContext.pathname) ?? [];
				for (const originalNodeId of nodeIds(nested.root)) {
					const prior = sources.find((source) => source.renderedNodeId === originalNodeId);
					sources.push({
						renderedNodeId: repeatedNodeId(attachment.id, entry.id, originalNodeId),
						providerId: prior?.providerId ?? mapping.document.composition.providerId,
						recordId: prior?.recordId ?? mapping.document.composition.recordId,
						nodeId: prior?.nodeId ?? originalNodeId,
						attachmentId: prior?.attachmentId ?? attachment.id,
						entries: [{
							providerId: mapping.document.contentModel.providerId,
							modelId: entry.modelId,
							recordId: entry.id
						}, ...prior?.entries ?? []]
					});
				}
				materializationSources.set(routeContext.pathname, sources);
				const repeated = cloneRepeatedNodes(nested.root, attachment.id, entry.id);
				if (slot.accepts && repeated.some((node) => !slot.accepts.includes(node.componentId))) {
					diagnostics.push({
						severity: "blocking",
						code: "attachment-slot-incompatible",
						message: `Mapped roots for Entry "${entry.id}" are not accepted by the target slot.`,
						path: attachmentPath,
						...routeContext
					});
					return;
				}
				roots.push(...repeated);
				total += repeatedCount;
			}
			const existing = targetNode.slots[attachment.target.slotId] ?? [];
			if (slot.cardinality === "single" && existing.length + roots.length > 1) {
				diagnostics.push({
					severity: "blocking",
					code: "attachment-slot-cardinality",
					message: "Collection output exceeds the target slot's single cardinality.",
					path: attachmentPath,
					...routeContext
				});
				return;
			}
			if (slot.max !== void 0 && existing.length + roots.length > slot.max) {
				diagnostics.push({
					severity: "blocking",
					code: "attachment-slot-cardinality",
					message: `Collection output exceeds the target slot's maximum of ${slot.max} ${slot.max === 1 ? "child" : "children"}.`,
					path: attachmentPath,
					...routeContext
				});
				return;
			}
			targetNode.slots[attachment.target.slotId] = [...existing, ...roots];
		}
		return document;
	};
	const expansion = await expandSitemapRoutes({
		policy: options.policy ?? "release",
		document: adapters.activeSitemap.document,
		catalog: {
			async resolveMapping(ref) {
				const record = adapters.mappings.catalog.resolve(ref);
				return record ? {
					status: "resolved",
					record
				} : { status: "not-found" };
			},
			async resolveDefinitionReadiness(mapping) {
				const prepared = await prepareMapping(mapping);
				return prepared.definition.status === "ready" ? { status: "ready" } : {
					status: "blocked",
					diagnostics: prepared.definition.diagnostics
				};
			},
			async resolveContentSnapshot(mapping) {
				return (await prepareMapping(mapping)).content;
			}
		}
	});
	const routeProjectionResolver = (pathname) => ({ resolve(ref) {
		const current = expansion.routes.find((route) => route.pathname === pathname);
		const context = current ? [...current.ancestors, {
			nodeId: current.nodeId,
			selectedEntry: current.selectedEntry
		}] : [];
		const candidates = expansion.routes.filter((route) => sameSitemapEntry(route.selectedEntry, ref) && route.ancestors.every((part) => {
			const existing = context.find((item) => item.nodeId === part.nodeId);
			return !existing || sameSitemapEntry(existing.selectedEntry, part.selectedEntry);
		}));
		if (!candidates.length) return { status: "unavailable" };
		if (candidates.length !== 1) return { status: "ambiguous" };
		return {
			status: "resolved",
			href: candidates[0].pathname
		};
	} });
	for (const item of expansion.diagnostics) {
		if (item.severity === "nonblocking") continue;
		const indexed = indexedNodes.get(item.nodeId);
		if (!indexed) continue;
		const source = indexed.node.source;
		const mapping = source.kind === "mapping" ? adapters.mappings.catalog.resolve(source.ref) : void 0;
		diagnostics.push(projectRouteDiagnostic(item, indexed, mapping?.document.contentModel.providerId));
	}
	for (const indexed of indexedNodes.values()) {
		if (indexed.node.source.kind !== "mapping") continue;
		const mapping = adapters.mappings.catalog.resolve(indexed.node.source.ref);
		if (!mapping) continue;
		const prepared = await prepareMapping(mapping);
		for (const item of prepared.definition.diagnostics) diagnostics.push({
			severity: "blocking",
			code: `mapping-${item.code}`,
			message: item.message,
			path: `${mappingSelector(prepared.ref)}["document"]["bindings"]${item.bindingId ? `..[?(@.id==${JSON.stringify(item.bindingId)})]` : ""}`,
			pathname: indexed.pathname,
			nodeId: indexed.node.id
		});
	}
	const occupiedIdsByProvider = /* @__PURE__ */ new Map();
	for (const provider of snapshot.providers.compositions) occupiedIdsByProvider.set(provider.id, new Set(provider.records.map((record) => record.id)));
	const routes = [];
	for (const expanded of expansion.routes) {
		const indexed = indexedNodes.get(expanded.nodeId);
		if (!indexed) continue;
		const { node } = indexed;
		if (node.source.kind === "unassigned") {
			diagnostics.push({
				severity: "blocking",
				code: "unassigned-page",
				message: "The Sitemap page has no assigned source.",
				path: indexed.path,
				pathname: expanded.pathname,
				nodeId: node.id
			});
			continue;
		}
		let source;
		let localRef;
		let localRecord;
		let localDocument;
		let selectedEntry = expanded.selectedEntry;
		const displayTitle = expanded.displayTitle;
		if (node.source.kind === "composition") {
			source = {
				kind: "composition",
				ref: { ...node.source.ref }
			};
			localRef = { ...node.source.ref };
			localRecord = adapters.compositions.catalog.resolve(localRef);
			localDocument = localRecord ? cloneDocument(localRecord.document) : void 0;
			if (!localRecord) diagnostics.push({
				severity: "blocking",
				code: "composition-not-found",
				message: "The assigned Composition was not found.",
				path: `${indexed.path}["source"]["ref"]`,
				pathname: expanded.pathname,
				nodeId: node.id
			});
		} else {
			source = {
				kind: "mapping",
				ref: { ...node.source.ref }
			};
			const mapping = adapters.mappings.catalog.resolve(node.source.ref);
			if (!mapping) continue;
			const prepared = await prepareMapping(mapping);
			const definition = prepared.definition;
			if (definition.status !== "ready" || !definition.composition || prepared.content.status !== "resolved") continue;
			localRef = { ...mapping.document.composition };
			localRecord = definition.composition;
			let entry;
			if (node.source.route.kind === "single") {
				if (prepared.content.snapshot.entries.length !== 1) {
					diagnostics.push({
						severity: "blocking",
						code: "single-entry-count",
						message: `Single route Mapping requires exactly one Entry; found ${prepared.content.snapshot.entries.length}.`,
						path: mappingSelector(prepared.ref),
						pathname: expanded.pathname,
						nodeId: node.id
					});
					continue;
				}
				entry = prepared.content.snapshot.entries[0];
			} else entry = prepared.content.snapshot.entries.find((candidate) => candidate.id === expanded.entryId);
			if (!entry) {
				const missingEntry = expanded.entryId ? {
					providerId: mapping.document.contentModel.providerId,
					recordId: expanded.entryId
				} : void 0;
				diagnostics.push({
					severity: "blocking",
					code: "entry-not-found",
					message: "The route Entry was not found in the prepared Content snapshot.",
					path: indexed.path,
					pathname: expanded.pathname,
					nodeId: node.id,
					...missingEntry ? { entry: missingEntry } : {}
				});
				continue;
			}
			selectedEntry = {
				providerId: mapping.document.contentModel.providerId,
				modelId: entry.modelId,
				recordId: entry.id
			};
			const evaluation = evaluateResolvedMapping(definition, entry, { routeResolver: routeProjectionResolver(expanded.pathname) });
			for (const item of evaluation.entryDiagnostics.filter((candidate) => candidate.severity === "blocking")) diagnostics.push({
				severity: "blocking",
				code: `mapping-${item.code}`,
				message: item.message,
				path: entrySelector(selectedEntry),
				pathname: expanded.pathname,
				nodeId: node.id,
				entry: selectedEntry
			});
			if (evaluation.status !== "ready" || !evaluation.document) continue;
			localDocument = evaluation.document;
		}
		if (!localRecord || !localDocument) continue;
		localDocument = await materializeCollectionAttachments(localRef, localDocument, {
			pathname: expanded.pathname,
			nodeId: node.id
		});
		if (!localDocument) continue;
		const resolvedAsset = resolveCompositionAsset(localDocument, options.componentCatalog, { lock: options.assetLock });
		const unresolvedAsset = resolvedAsset.index.references.filter(({ ref }) => !options.assetLock || !resolvePinnedAsset(ref, options.assetLock));
		if ((options.policy ?? "release") === "release" && (!resolvedAsset.index.complete || unresolvedAsset.length || resolvedAsset.index.advisory.some(({ value }) => value && isImmutableAssetUrl(value)))) {
			diagnostics.push({
				severity: "blocking",
				code: "asset-lock-required",
				message: "Materialized Assets is incomplete or absent from the exact-version lock.",
				path: indexed.path,
				pathname: expanded.pathname,
				nodeId: node.id
			});
			continue;
		}
		localDocument = resolvedAsset.document;
		const providerId = localRef.providerId;
		const cycle = bindingCycle(providerId, localRef.recordId, {
			...localRecord,
			document: localDocument
		}, (ref) => adapters.compositions.catalog.resolve(ref));
		if (cycle) {
			diagnostics.push({
				severity: "blocking",
				code: "template-binding-cycle",
				message: `Composition binding cycle: ${cycle.join(" -> ")}.`,
				path: `${compositionSelector(localRef)}["document"]["binding"]`,
				pathname: expanded.pathname,
				nodeId: node.id,
				...selectedEntry ? { entry: selectedEntry } : {}
			});
			continue;
		}
		const occupiedIds = occupiedIdsByProvider.get(providerId) ?? /* @__PURE__ */ new Set();
		occupiedIdsByProvider.set(providerId, occupiedIds);
		const routeRecordId = routeIdentity(snapshot, expanded, active, occupiedIds);
		const routeDocument = cloneDocument(localDocument);
		routeDocument.id = routeRecordId;
		const routeRecord = {
			...localRecord,
			id: routeRecordId,
			document: routeDocument
		};
		const dependencies = dependencyClosure(providerId, routeRecord, (ref) => adapters.compositions.catalog.resolve(ref));
		let resolution;
		let linkedSource;
		if (routeRecord.document.binding) {
			const direct = dependencies.find((record) => record.id === routeRecord.document.binding.sourceRecordId);
			if (!direct) {
				diagnostics.push({
					severity: "blocking",
					code: "template-source-not-found",
					message: "The linked Global template source was not found.",
					path: `${compositionSelector(localRef)}["document"]["binding"]`,
					pathname: expanded.pathname,
					nodeId: node.id,
					...selectedEntry ? { entry: selectedEntry } : {}
				});
				continue;
			}
			resolution = resolveGlobalTemplate({
				consumer: routeRecord,
				source: direct,
				manifest: options.componentCatalog
			});
			if (resolution.status !== "resolved") {
				diagnostics.push({
					severity: "blocking",
					code: `template-${resolution.status}`,
					message: resolutionMessage(resolution),
					path: `${compositionSelector(localRef)}["document"]["binding"]`,
					pathname: expanded.pathname,
					nodeId: node.id,
					...selectedEntry ? { entry: selectedEntry } : {}
				});
				continue;
			}
			const materialized = materializeGlobalTemplateView(routeRecord, resolution);
			if (materialized.status !== "resolved") {
				diagnostics.push({
					severity: "blocking",
					code: "template-materialization-failed",
					message: "The linked Global template could not be materialized.",
					path: `${compositionSelector(localRef)}["document"]["binding"]`,
					pathname: expanded.pathname,
					nodeId: node.id,
					...selectedEntry ? { entry: selectedEntry } : {}
				});
				continue;
			}
			linkedSource = {
				ref: {
					providerId,
					recordId: direct.id
				},
				outlet: {
					id: resolution.outlet.id,
					label: resolution.outlet.label,
					target: { ...resolution.outlet.target }
				},
				document: cloneDocument(materialized.sourceDocument)
			};
		}
		const resolutions = resolution ? /* @__PURE__ */ new Map([[routeRecordId, resolution]]) : void 0;
		const batch = planLinkedJsxModules({
			allowUnresolvedAssetDownloads: options.policy === "authoring-preview",
			manifest: options.componentCatalog,
			records: [...dependencies, routeRecord],
			...resolutions ? { resolutions } : {},
			moduleSpecifier: (recordId) => moduleSpecifier(providerId, routeRecordId, recordId)
		});
		const blocked = batch.records.find((plan) => plan.status === "blocked");
		if (blocked?.status === "blocked") {
			const code = blocked.diagnostic.kind === "dependency" ? blocked.diagnostic.code : "jsx-generation-failed";
			diagnostics.push({
				severity: "blocking",
				code,
				message: `JSX module generation failed for Composition "${blocked.recordId}".`,
				path: compositionSelector(blocked.recordId === routeRecordId ? localRef : {
					providerId,
					recordId: blocked.recordId
				}),
				pathname: expanded.pathname,
				nodeId: node.id,
				...selectedEntry ? { entry: selectedEntry } : {}
			});
			continue;
		}
		const modules = batch.records.filter((plan) => plan.status === "generated").map(asModule).sort(compareModules);
		routes.push({
			...materializationSources.has(expanded.pathname) ? { materializationSources: materializationSources.get(expanded.pathname) } : {},
			pathname: expanded.pathname,
			displayTitle,
			ancestors: expanded.ancestors,
			sitemapNode: {
				id: node.id,
				path: indexed.path
			},
			source,
			...selectedEntry ? { selectedEntry } : {},
			composition: {
				local: localRef,
				routeRecordId,
				document: cloneDocument(localDocument),
				...linkedSource ? { linkedSource } : {}
			},
			modules
		});
	}
	routes.sort(compareRoutes);
	const modulesBySpecifier = /* @__PURE__ */ new Map();
	for (const route of routes) for (const module of route.modules) {
		const previous = modulesBySpecifier.get(module.moduleSpecifier);
		if (!previous) modulesBySpecifier.set(module.moduleSpecifier, module);
		else if (previous.code !== module.code || previous.kind !== module.kind || previous.recordId !== module.recordId) diagnostics.push({
			severity: "blocking",
			code: "module-plan-conflict",
			message: `Module specifier ${JSON.stringify(module.moduleSpecifier)} was planned with different code.`,
			path: compositionSelector(route.composition.local),
			pathname: route.pathname,
			nodeId: route.sitemapNode.id,
			...route.selectedEntry ? { entry: route.selectedEntry } : {}
		});
	}
	diagnostics.sort(compareDiagnostics$1);
	const navigation = resolveSitemapNavigation(adapters.activeSitemap.document.navigation, expansion.routes.filter((expanded) => routes.some((route) => route.pathname === expanded.pathname && route.sitemapNode.id === expanded.nodeId)));
	for (const item of navigation.diagnostics) diagnostics.push({
		severity: "blocking",
		code: item.code,
		message: item.message,
		path: `${selector("sitemaps", active.providerId, "records", active.recordId)}["document"]["navigation"][${JSON.stringify(item.menu)}][?(@.id==${JSON.stringify(item.itemId)})]`
	});
	diagnostics.sort(compareDiagnostics$1);
	if (diagnostics.length > 0) return {
		status: "blocked",
		routes,
		diagnostics
	};
	return {
		status: "ready",
		build: {
			projectId: snapshot.id,
			navigation,
			activeSitemap: { ...active },
			routes,
			modules: [...modulesBySpecifier.values()].sort(compareModules)
		},
		diagnostics: []
	};
}
({ files: "files" }).files;
//#endregion
//#region src/composer/model/codec.ts
/**
* Classify one untrusted persisted value without mutating or upgrading it.
* Only the current schema is accepted; older prototypes are malformed.
*/
function decodeCompositionDocument(value) {
	if (!isPlainObject(value)) return { status: "malformed" };
	const schemaVersion = value.schemaVersion;
	if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) return { status: "malformed" };
	if (schemaVersion === 2) return {
		status: "current",
		document: value
	};
	if (schemaVersion > 2) return {
		status: "future-schema",
		foundSchemaVersion: schemaVersion
	};
	return { status: "malformed" };
}
//#endregion
//#region src/composer/library/validate.ts
/** Canonical UTC ISO instant emitted by `Date#toISOString`. */
function isValidCompositionTimestamp(value) {
	if (typeof value !== "string") return false;
	const parsed = new Date(value);
	return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
function issue$1(code, message, foundSchemaVersion) {
	return {
		ok: false,
		issue: {
			code,
			message,
			...foundSchemaVersion === void 0 ? {} : { foundSchemaVersion }
		}
	};
}
/** Strict provider-boundary validation over the shared document validator. */
function validateCompositionRecord(value) {
	if (!isPlainObject(value)) return issue$1("invalid-record", "Composition record must be a plain object.");
	if (!isJsonSafe(value)) return issue$1("not-json-safe", "Composition record contains data that is not JSON-safe.");
	const raw = value;
	const expectedKeys = [
		"id",
		"createdAt",
		"updatedAt",
		"document"
	];
	if (!expectedKeys.every((key) => Object.hasOwn(raw, key)) || Object.keys(raw).some((key) => !expectedKeys.includes(key))) return issue$1("invalid-record", "Composition record must contain exactly id, createdAt, updatedAt, and document.");
	if (!isSafeRecordId(raw.id)) return issue$1("unsafe-id", "Composition record id is not a stable path-safe id.");
	if (!isValidCompositionTimestamp(raw.createdAt)) return issue$1("invalid-created-at", "Composition record createdAt must be a canonical ISO timestamp.");
	if (!isValidCompositionTimestamp(raw.updatedAt)) return issue$1("invalid-updated-at", "Composition record updatedAt must be a canonical ISO timestamp.");
	if (raw.updatedAt < raw.createdAt) return issue$1("invalid-timestamp-order", "Composition record updatedAt cannot precede createdAt.");
	if (!isPlainObject(raw.document)) return issue$1("malformed-document", "Composition record document must be a plain object.");
	const decoded = decodeCompositionDocument(raw.document);
	if (decoded.status === "future-schema") return issue$1("future-schema", `Composition document schema ${decoded.foundSchemaVersion} is newer than the supported schema.`, decoded.foundSchemaVersion);
	if (decoded.status === "malformed" || !isStructurallyValidDocument$1(decoded.document)) return issue$1("malformed-document", "Composition document is malformed or uses an unsupported schema.");
	if (decoded.document.id !== raw.id) return issue$1("record-document-id-mismatch", "Composition record id must match its document id.");
	return {
		ok: true,
		record: {
			id: raw.id,
			createdAt: raw.createdAt,
			updatedAt: raw.updatedAt,
			document: decoded.document
		}
	};
}
//#endregion
//#region src/sitemapper/library/validate.ts
var RECORD_KEYS = [
	"id",
	"createdAt",
	"updatedAt",
	"document"
];
function isValidSitemapTimestamp(value) {
	if (typeof value !== "string") return false;
	const parsed = new Date(value);
	return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
function issue(code, message, foundSchemaVersion) {
	return {
		ok: false,
		issue: {
			code,
			message,
			...foundSchemaVersion === void 0 ? {} : { foundSchemaVersion }
		}
	};
}
/** Strict validation for values crossing a persistence boundary. */
function validateSitemapRecord(value) {
	if (!isPlainObject(value)) return issue("invalid-record", "Sitemap record must be a plain object.");
	if (Object.keys(value).length !== RECORD_KEYS.length || !RECORD_KEYS.every((key) => Object.hasOwn(value, key))) return issue("invalid-record-keys", "Sitemap record must contain exactly its canonical envelope fields.");
	if (!isJsonSafe(value)) return issue("not-json-safe", "Sitemap record contains data that is not JSON-safe.");
	if (!isSafeRecordId(value.id)) return issue("unsafe-id", "Sitemap record id is not a path-safe id.");
	if (!isValidSitemapTimestamp(value.createdAt)) return issue("invalid-created-at", "Sitemap record createdAt must be a canonical ISO timestamp.");
	if (!isValidSitemapTimestamp(value.updatedAt)) return issue("invalid-updated-at", "Sitemap record updatedAt must be a canonical ISO timestamp.");
	if (value.updatedAt < value.createdAt) return issue("invalid-timestamp-order", "Sitemap record updatedAt cannot precede createdAt.");
	const decoded = decodeSitemapDocument(value.document);
	if (decoded.status === "future-schema") return issue("future-schema", `Sitemap document schema ${decoded.foundSchemaVersion} is newer than the supported schema.`, decoded.foundSchemaVersion);
	if (decoded.status === "malformed") return issue("malformed-document", "Sitemap document is malformed or uses an unsupported schema.");
	const document = isStructurallyValidDocument(decoded.document);
	if (!document.ok) return issue("malformed-document", `Sitemap document is malformed at ${document.path}.`);
	if (document.document.id !== value.id) return issue("record-document-id-mismatch", "Sitemap record id must match its document id.");
	return {
		ok: true,
		record: {
			...value,
			document: document.document
		}
	};
}
//#endregion
//#region src/site-project/model/validation.ts
var PROJECT_KEYS = [
	"schemaVersion",
	"id",
	"name",
	"componentPack",
	"providers",
	"activeSitemap",
	"collectionAttachments"
];
var PACK_KEYS = [
	"contractVersion",
	"packId",
	"packVersion"
];
var PROVIDERS_KEYS = [
	"compositions",
	"content",
	"mappings",
	"sitemaps"
];
var RECORD_PROVIDER_KEYS = ["id", "records"];
var CONTENT_PROVIDER_KEYS = [
	"id",
	"models",
	"entries"
];
var REF_KEYS = ["providerId", "recordId"];
function exactKeys(value, keys) {
	return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function diagnostic(diagnostics, code, path, message) {
	diagnostics.push({
		severity: "error",
		code,
		message,
		path
	});
}
function recordRefKey(providerId, recordId) {
	return `${providerId}\u0000${recordId}`;
}
function childPath(path, issuePath) {
	if (!issuePath) return path;
	return issuePath.startsWith("[") ? `${path}${issuePath}` : `${path}.${issuePath}`;
}
function validateProviderShell(value, path, domain, expectedKeys, diagnostics) {
	if (!isPlainObject(value) || !exactKeys(value, expectedKeys)) {
		diagnostic(diagnostics, "invalid-provider", path, `Provider must contain exactly ${expectedKeys.join(", ")}.`);
		return false;
	}
	if (!isSiteProjectProviderId(domain, value.id)) {
		diagnostic(diagnostics, "unknown-provider", `${path}.id`, `Provider id ${JSON.stringify(value.id)} is not registered for ${domain}.`);
		return false;
	}
	return true;
}
function validateRefShape(value) {
	return isPlainObject(value) && exactKeys(value, REF_KEYS) && typeof value.providerId === "string" && isSafeRecordId(value.recordId);
}
function compositionNodePaths(nodes, base, result = /* @__PURE__ */ new Map()) {
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		const path = `${base}[${index}]`;
		result.set(node.id, path);
		for (const slotId of Object.keys(node.slots).sort(compareUnicodeCodePoints)) compositionNodePaths(node.slots[slotId], `${path}.slots[${JSON.stringify(slotId)}]`, result);
	}
	return result;
}
function sitemapNodes(nodes, base, visit) {
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		const path = `${base}[${index}]`;
		visit(node.source, `${path}.source`);
		sitemapNodes(node.children, `${path}.children`, visit);
	}
}
function recordExistsElsewhere(providers, expectedProviderId, recordId) {
	for (const [providerId, records] of providers) if (providerId !== expectedProviderId && records.some((record) => record.id === recordId)) return true;
	return false;
}
/** Strictly validates a SiteProject and every cross-domain graph edge. */
function validateSiteProject(value, context) {
	const diagnostics = [];
	if (!isPlainObject(value)) return {
		ok: false,
		diagnostics: [{
			severity: "error",
			code: "invalid-project",
			path: "$",
			message: "SiteProject must be a plain object."
		}]
	};
	if (!isJsonSafe(value)) return {
		ok: false,
		diagnostics: [{
			severity: "error",
			code: "not-json-safe",
			path: "$",
			message: "SiteProject must contain only JSON-safe values."
		}]
	};
	if (!exactKeys(value, PROJECT_KEYS)) {
		diagnostic(diagnostics, "invalid-keys", "$", "SiteProject must contain exactly schemaVersion, id, name, componentPack, providers, activeSitemap, and collectionAttachments.");
		return {
			ok: false,
			diagnostics
		};
	}
	if (typeof value.schemaVersion === "number" && value.schemaVersion > 2) diagnostic(diagnostics, "future-schema", "$.schemaVersion", `SiteProject schema ${value.schemaVersion} is newer than supported schema 2.`);
	else if (value.schemaVersion !== 2) diagnostic(diagnostics, "invalid-schema-version", "$.schemaVersion", `SiteProject schemaVersion must be 2.`);
	if (!isSafeRecordId(value.id)) diagnostic(diagnostics, "unsafe-id", "$.id", "SiteProject id must be a stable path-safe id.");
	if (typeof value.name !== "string" || value.name.trim().length === 0) diagnostic(diagnostics, "invalid-name", "$.name", "SiteProject name must be non-empty.");
	let packCompatible = false;
	if (!isPlainObject(value.componentPack) || !exactKeys(value.componentPack, PACK_KEYS) || !Number.isSafeInteger(value.componentPack.contractVersion) || value.componentPack.contractVersion < 1 || typeof value.componentPack.packId !== "string" || value.componentPack.packId.length === 0 || typeof value.componentPack.packVersion !== "string" || value.componentPack.packVersion.length === 0) diagnostic(diagnostics, "invalid-component-pack", "$.componentPack", "componentPack must contain a positive contractVersion and non-empty packId and packVersion.");
	else {
		const expected = context.componentPack;
		packCompatible = value.componentPack.contractVersion === expected.contractVersion && value.componentPack.packId === expected.packId && value.componentPack.packVersion === expected.packVersion;
		if (!packCompatible) diagnostic(diagnostics, "component-pack-mismatch", "$.componentPack", `SiteProject requires ${value.componentPack.packId}@${value.componentPack.packVersion} contract ${value.componentPack.contractVersion}, but ${expected.packId}@${expected.packVersion} contract ${expected.contractVersion} is active.`);
	}
	if (!isPlainObject(value.providers) || !exactKeys(value.providers, PROVIDERS_KEYS)) {
		diagnostic(diagnostics, "invalid-keys", "$.providers", "providers must contain exactly compositions, content, mappings, and sitemaps.");
		return {
			ok: false,
			diagnostics: diagnostics.sort(compareDiagnostics)
		};
	}
	const compositions = /* @__PURE__ */ new Map();
	const contentModels = /* @__PURE__ */ new Map();
	const contentEntries = /* @__PURE__ */ new Map();
	const mappings = /* @__PURE__ */ new Map();
	const sitemaps = /* @__PURE__ */ new Map();
	const recordPaths = /* @__PURE__ */ new Map();
	const validateRecordProviders = (domain, rawProviders, target, validator) => {
		const base = `$.providers.${domain}`;
		if (!Array.isArray(rawProviders)) {
			diagnostic(diagnostics, "invalid-provider", base, `${domain} must be an array of provider collections.`);
			return;
		}
		const providerIds = /* @__PURE__ */ new Set();
		rawProviders.forEach((provider, providerIndex) => {
			const providerPath = `${base}[${providerIndex}]`;
			if (!validateProviderShell(provider, providerPath, domain, RECORD_PROVIDER_KEYS, diagnostics)) return;
			const providerId = provider.id;
			if (providerIds.has(providerId)) diagnostic(diagnostics, "duplicate-provider", `${providerPath}.id`, `Duplicate ${domain} provider ${JSON.stringify(providerId)}.`);
			providerIds.add(providerId);
			if (!Array.isArray(provider.records)) {
				diagnostic(diagnostics, "invalid-provider", `${providerPath}.records`, "Provider records must be an array.");
				return;
			}
			const records = [];
			const recordIds = /* @__PURE__ */ new Set();
			provider.records.forEach((record, recordIndex) => {
				const path = `${providerPath}.records[${recordIndex}]`;
				const result = validator(record);
				if (!result.ok) {
					diagnostic(diagnostics, "malformed-record", childPath(path, result.issue.path), `${domain} record is invalid (${result.issue.code}): ${result.issue.message}`);
					return;
				}
				if (recordIds.has(result.record.id)) diagnostic(diagnostics, "duplicate-record", `${path}.id`, `Duplicate record id ${JSON.stringify(result.record.id)} in provider ${JSON.stringify(providerId)}.`);
				recordIds.add(result.record.id);
				records.push(result.record);
				recordPaths.set(result.record, path);
			});
			if (!target.has(providerId)) target.set(providerId, records);
		});
	};
	validateRecordProviders("compositions", value.providers.compositions, compositions, validateCompositionRecord);
	validateRecordProviders("mappings", value.providers.mappings, mappings, validateMappingRecord);
	validateRecordProviders("sitemaps", value.providers.sitemaps, sitemaps, validateSitemapRecord);
	if (!Array.isArray(value.collectionAttachments)) diagnostic(diagnostics, "invalid-project", "$.collectionAttachments", "collectionAttachments must be an array.");
	if (!Array.isArray(value.providers.content)) diagnostic(diagnostics, "invalid-provider", "$.providers.content", "content must be an array of provider collections.");
	else {
		const providerIds = /* @__PURE__ */ new Set();
		value.providers.content.forEach((provider, providerIndex) => {
			const providerPath = `$.providers.content[${providerIndex}]`;
			if (!validateProviderShell(provider, providerPath, "content", CONTENT_PROVIDER_KEYS, diagnostics)) return;
			const providerId = provider.id;
			if (providerIds.has(providerId)) diagnostic(diagnostics, "duplicate-provider", `${providerPath}.id`, `Duplicate content provider ${JSON.stringify(providerId)}.`);
			providerIds.add(providerId);
			const validModels = [];
			const validEntries = [];
			for (const [collectionName, records, validator] of [[
				"models",
				provider.models,
				validateContentModelRecord
			], [
				"entries",
				provider.entries,
				validateContentEntryRecord
			]]) {
				if (!Array.isArray(records)) {
					diagnostic(diagnostics, "invalid-provider", `${providerPath}.${collectionName}`, `Content ${collectionName} must be an array.`);
					continue;
				}
				const recordIds = /* @__PURE__ */ new Set();
				records.forEach((record, recordIndex) => {
					const path = `${providerPath}.${collectionName}[${recordIndex}]`;
					const result = validator(record);
					if (!result.ok) {
						diagnostic(diagnostics, "malformed-record", childPath(path, result.issue.path), `Content ${collectionName.slice(0, -1)} is invalid (${result.issue.code}): ${result.issue.message}`);
						return;
					}
					if (recordIds.has(result.value.id)) diagnostic(diagnostics, "duplicate-record", `${path}.id`, `Duplicate content ${collectionName.slice(0, -1)} id ${JSON.stringify(result.value.id)} in provider ${JSON.stringify(providerId)}.`);
					recordIds.add(result.value.id);
					recordPaths.set(result.value, path);
					if (collectionName === "models") validModels.push(result.value);
					else validEntries.push(result.value);
				});
			}
			if (!contentModels.has(providerId)) contentModels.set(providerId, validModels);
			if (!contentEntries.has(providerId)) contentEntries.set(providerId, validEntries);
		});
	}
	const componentCatalog = packCompatible ? createComponentCatalog(context.componentPack) : void 0;
	for (const [providerId, records] of compositions) for (const record of records) {
		const path = recordPaths.get(record) ?? "$.providers.compositions";
		if (componentCatalog) {
			const packDiagnostics = diagnoseDocument(record.document, componentCatalog, { containingRecordId: record.id });
			const nodePaths = compositionNodePaths(record.document.root, `${path}.document.root`);
			for (const node of packDiagnostics.byId.values()) for (const reason of node.reasons) diagnostic(diagnostics, "component-pack-incompatible", nodePaths.get(node.nodeId) ?? `${path}.document`, reason.message);
			for (const reason of packDiagnostics.reuseReasons) diagnostic(diagnostics, "component-pack-incompatible", `${path}.document`, reason.message);
		}
		const binding = record.document.binding;
		if (binding) {
			const source = records.find((candidate) => candidate.id === binding.sourceRecordId);
			if (!source) diagnostic(diagnostics, "dangling-composition-binding", `${path}.document.binding.sourceRecordId`, `Composition binding target ${JSON.stringify(recordRefKey(providerId, binding.sourceRecordId))} does not exist in the same provider.`);
			else if (source.document.publication?.kind !== "global-template" || source.document.publication.outlet.id !== binding.outletId) diagnostic(diagnostics, "invalid-composition-binding", `${path}.document.binding`, `Composition binding target does not expose Global-template outlet ${JSON.stringify(binding.outletId)}.`);
		}
	}
	for (const [providerId, entries] of contentEntries) {
		const models = contentModels.get(providerId) ?? [];
		const singleEntryCounts = /* @__PURE__ */ new Map();
		entries.forEach((entry) => {
			const entryPath = recordPaths.get(entry) ?? "$.providers.content";
			const path = `${entryPath}.modelId`;
			const model = models.find((candidate) => candidate.id === entry.modelId);
			if (!model) {
				const elsewhere = recordExistsElsewhere(contentModels, providerId, entry.modelId);
				diagnostic(diagnostics, elsewhere ? "wrong-content-provider" : "dangling-content-model", path, elsewhere ? `Content Entry model ${JSON.stringify(entry.modelId)} belongs to another provider.` : `Content Entry model ${JSON.stringify(entry.modelId)} does not exist in provider ${JSON.stringify(providerId)}.`);
				return;
			}
			if (model.document.kind === "single") {
				const count = (singleEntryCounts.get(model.id) ?? 0) + 1;
				singleEntryCounts.set(model.id, count);
				if (count > 1) diagnostic(diagnostics, "single-content-cardinality", path, `Single Content model ${JSON.stringify(model.id)} permits at most one Entry in provider ${JSON.stringify(providerId)}.`);
			}
			for (const [fieldId, fieldValue] of Object.entries(entry.values)) {
				const field = model.document.fields.find((candidate) => candidate.id === fieldId);
				if (!field) diagnostic(diagnostics, "dangling-entry-field", `${entryPath}.values[${JSON.stringify(fieldId)}]`, `Content Entry value refers to unknown field ${JSON.stringify(fieldId)}.`);
				else if (!isValueValidForField(field, fieldValue)) diagnostic(diagnostics, "invalid-entry-value", `${entryPath}.values[${JSON.stringify(fieldId)}]`, `Content Entry value for field ${JSON.stringify(fieldId)} does not match ${field.kind}.`);
			}
		});
	}
	const contentGraph = buildContentGraphIndex([...contentModels].map(([providerId, models]) => ({
		providerId,
		mutationToken: 0,
		models,
		entries: contentEntries.get(providerId) ?? []
	})));
	for (const issue of contentGraph.diagnostics) {
		if (![
			"missing-provider",
			"missing-entry",
			"invalid-inverse",
			"missing-model"
		].includes(issue.code)) continue;
		const record = contentEntries.get(issue.providerId)?.find((entry) => entry.id === issue.recordId) ?? contentModels.get(issue.providerId)?.find((model) => model.id === issue.recordId);
		diagnostic(diagnostics, "invalid-entry-value", record ? recordPaths.get(record) ?? "$.providers.content" : "$.providers.content", issue.message);
	}
	for (const records of mappings.values()) records.forEach((mapping) => {
		const path = `${recordPaths.get(mapping) ?? "$.providers.mappings"}.document`;
		const contentRef = mapping.document.contentModel;
		const knownContentProvider = isSiteProjectProviderId("content", contentRef.providerId);
		if (!knownContentProvider) diagnostic(diagnostics, "unknown-provider", `${path}.contentModel.providerId`, `Provider id ${JSON.stringify(contentRef.providerId)} is not registered for content.`);
		const model = (knownContentProvider ? contentModels.get(contentRef.providerId) : void 0)?.find((candidate) => candidate.id === contentRef.recordId);
		if (knownContentProvider && !model) {
			const elsewhere = recordExistsElsewhere(contentModels, contentRef.providerId, contentRef.recordId);
			diagnostic(diagnostics, elsewhere ? "wrong-mapping-provider" : "dangling-mapping-reference", `${path}.contentModel`, elsewhere ? `Mapping Content model ${JSON.stringify(contentRef.recordId)} belongs to another provider.` : `Mapping Content model ${JSON.stringify(recordRefKey(contentRef.providerId, contentRef.recordId))} does not exist.`);
		}
		const compositionRef = mapping.document.composition;
		const knownCompositionProvider = isSiteProjectProviderId("compositions", compositionRef.providerId);
		if (!knownCompositionProvider) diagnostic(diagnostics, "unknown-provider", `${path}.composition.providerId`, `Provider id ${JSON.stringify(compositionRef.providerId)} is not registered for compositions.`);
		const composition = (knownCompositionProvider ? compositions.get(compositionRef.providerId) : void 0)?.find((candidate) => candidate.id === compositionRef.recordId);
		if (knownCompositionProvider && !composition) {
			const elsewhere = recordExistsElsewhere(compositions, compositionRef.providerId, compositionRef.recordId);
			diagnostic(diagnostics, elsewhere ? "wrong-mapping-provider" : "dangling-mapping-reference", `${path}.composition`, elsewhere ? `Mapping Composition ${JSON.stringify(compositionRef.recordId)} belongs to another provider.` : `Mapping Composition ${JSON.stringify(recordRefKey(compositionRef.providerId, compositionRef.recordId))} does not exist.`);
		}
		const mappingTargets = composition && componentCatalog ? new Set(discoverMappingTargets(composition.document, componentCatalog).targets.map((target) => recordRefKey(target.target.nodeId, target.target.prop))) : void 0;
		const nodeIds = composition ? new Set(compositionNodePaths(composition.document.root, "").keys()) : void 0;
		mapping.document.bindings.forEach((binding, bindingIndex) => {
			const bindingPath = `${path}.bindings[${bindingIndex}]`;
			if (model && !model.document.fields.some((field) => field.id === binding.sourceFieldId)) diagnostic(diagnostics, "dangling-mapping-field", `${bindingPath}.sourceFieldId`, `Mapping source field ${JSON.stringify(binding.sourceFieldId)} does not exist in Content model ${JSON.stringify(model.id)}.`);
			if (nodeIds && !nodeIds.has(binding.target.nodeId)) diagnostic(diagnostics, "dangling-mapping-target", `${bindingPath}.target.nodeId`, `Mapping target node ${JSON.stringify(binding.target.nodeId)} does not exist in Composition ${JSON.stringify(composition.id)}.`);
			else if (mappingTargets && !mappingTargets.has(recordRefKey(binding.target.nodeId, binding.target.prop))) diagnostic(diagnostics, "dangling-mapping-target", `${bindingPath}.target.prop`, `Mapping target field ${JSON.stringify(binding.target.prop)} is not an available scalar field on node ${JSON.stringify(binding.target.nodeId)}.`);
		});
	});
	if (Array.isArray(value.collectionAttachments)) {
		const ids = /* @__PURE__ */ new Set();
		const targets = /* @__PURE__ */ new Set();
		value.collectionAttachments.forEach((raw, index) => {
			const path = `$.collectionAttachments[${index}]`;
			if (!isPlainObject(raw) || !exactKeys(raw, [
				"id",
				"order",
				"composition",
				"target",
				"mapping"
			]) || !isSafeRecordId(raw.id) || !Number.isSafeInteger(raw.order) || Number(raw.order) < 0 || !validateRefShape(raw.composition) || !validateRefShape(raw.mapping) || !isPlainObject(raw.target) || !exactKeys(raw.target, ["nodeId", "slotId"]) || typeof raw.target.nodeId !== "string" || !raw.target.nodeId || typeof raw.target.slotId !== "string" || !raw.target.slotId) {
				diagnostic(diagnostics, "invalid-collection-attachment", path, "Collection attachment shape is invalid.");
				return;
			}
			if (ids.has(raw.id)) diagnostic(diagnostics, "duplicate-collection-attachment", `${path}.id`, `Duplicate collection attachment ${JSON.stringify(raw.id)}.`);
			ids.add(raw.id);
			const compositionRef = raw.composition;
			const mappingRef = raw.mapping;
			const attachmentTarget = raw.target;
			const targetKey = `${compositionRef.providerId}\u0000${compositionRef.recordId}\u0000${attachmentTarget.nodeId}\u0000${attachmentTarget.slotId}`;
			if (targets.has(targetKey)) diagnostic(diagnostics, "attachment-slot-conflict", `${path}.target`, "Only one collection attachment may own a named slot.");
			targets.add(targetKey);
			const composition = compositions.get(compositionRef.providerId)?.find((record) => record.id === compositionRef.recordId);
			if (!composition) {
				diagnostic(diagnostics, "attachment-composition-not-found", `${path}.composition`, "Attachment owner Composition was not found in its provider.");
				return;
			}
			const mapping = mappings.get(mappingRef.providerId)?.find((record) => record.id === mappingRef.recordId);
			if (!mapping) {
				diagnostic(diagnostics, "attachment-mapping-not-found", `${path}.mapping`, "Attachment collection Mapping was not found in its provider.");
				return;
			}
			if (mapping.document.mode.kind !== "collection") diagnostic(diagnostics, "attachment-mapping-not-collection", `${path}.mapping`, "Attachment Mapping must use collection mode.");
			const node = (() => {
				const visit = (nodes) => {
					for (const candidate of nodes) {
						if (candidate.id === attachmentTarget.nodeId) return candidate;
						for (const children of Object.values(candidate.slots)) {
							const found = visit(children);
							if (found) return found;
						}
					}
				};
				return visit(composition.document.root);
			})();
			if (!node) {
				diagnostic(diagnostics, "attachment-target-not-found", `${path}.target.nodeId`, "Attachment target node was not found in the owner Composition.");
				return;
			}
			const component = componentCatalog?.get(node.componentId);
			if (component && !component.slots.some((slot) => slot.id === attachmentTarget.slotId)) diagnostic(diagnostics, "attachment-slot-not-found", `${path}.target.slotId`, "Attachment target is not a current named component slot.");
		});
	}
	const activeSitemap = value.activeSitemap;
	if (!validateRefShape(activeSitemap)) diagnostic(diagnostics, "invalid-active-sitemap", "$.activeSitemap", "activeSitemap must contain exactly a registered providerId and safe recordId.");
	else if (!isSiteProjectProviderId("sitemaps", activeSitemap.providerId)) diagnostic(diagnostics, "unknown-provider", "$.activeSitemap.providerId", `Provider id ${JSON.stringify(activeSitemap.providerId)} is not registered for sitemaps.`);
	else if (!sitemaps.get(activeSitemap.providerId)?.some((record) => record.id === activeSitemap.recordId)) diagnostic(diagnostics, "invalid-active-sitemap", "$.activeSitemap", `Active Sitemap ${JSON.stringify(recordRefKey(activeSitemap.providerId, activeSitemap.recordId))} does not exist.`);
	for (const records of sitemaps.values()) records.forEach((sitemap) => {
		const base = `${recordPaths.get(sitemap) ?? "$.providers.sitemaps"}.document.root`;
		sitemapNodes(sitemap.document.root, base, (source, sourcePath) => {
			if (!isPlainObject(source) || source.kind === "unassigned") return;
			const domain = source.kind === "composition" ? compositions : mappings;
			const ref = source.ref;
			const registryDomain = source.kind === "composition" ? "compositions" : "mappings";
			if (!isSiteProjectProviderId(registryDomain, ref.providerId)) {
				diagnostic(diagnostics, "unknown-provider", `${sourcePath}.ref.providerId`, `Provider id ${JSON.stringify(ref.providerId)} is not registered for ${registryDomain}.`);
				return;
			}
			const target = domain.get(ref.providerId)?.find((candidate) => candidate.id === ref.recordId);
			if (!target) {
				const elsewhere = recordExistsElsewhere(domain, ref.providerId, ref.recordId);
				diagnostic(diagnostics, elsewhere ? "wrong-sitemap-provider" : "dangling-sitemap-reference", `${sourcePath}.ref`, elsewhere ? `Sitemap ${source.kind} target ${JSON.stringify(ref.recordId)} belongs to another provider.` : `Sitemap ${source.kind} target ${JSON.stringify(recordRefKey(ref.providerId, ref.recordId))} does not exist.`);
				return;
			}
			if (source.kind === "mapping" && isPlainObject(source.route) && source.route.kind === "selected-entry") {
				const mapping = target;
				const ref = source.route.entry;
				const modelRef = mapping.document.contentModel;
				const model = contentModels.get(modelRef.providerId)?.find((candidate) => candidate.id === modelRef.recordId);
				const entry = contentEntries.get(ref.providerId)?.find((candidate) => candidate.id === ref.recordId);
				if (model?.document.kind !== "collection" || mapping.document.mode.kind !== "collection" || ref.providerId !== modelRef.providerId || ref.modelId !== modelRef.recordId || entry?.modelId !== ref.modelId) diagnostic(diagnostics, "invalid-sitemap-selected-entry", `${sourcePath}.route.entry`, "Selected route Entry must belong to this collection Mapping's provider and model.");
			}
			if (source.kind === "mapping" && isPlainObject(source.route) && source.route.kind === "entry-field") {
				const modelRef = target.document.contentModel;
				const model = contentModels.get(modelRef.providerId)?.find((candidate) => candidate.id === modelRef.recordId);
				const route = source.route;
				if (model && !model.document.fields.some((field) => field.id === route.fieldId)) diagnostic(diagnostics, "dangling-sitemap-route-field", `${sourcePath}.route.fieldId`, `Sitemap route field ${JSON.stringify(route.fieldId)} does not exist in Content model ${JSON.stringify(model.id)}.`);
				if (model && route.titleFieldId !== void 0) {
					const titleField = model.document.fields.find((field) => field.id === route.titleFieldId);
					if (!titleField) diagnostic(diagnostics, "dangling-sitemap-title-field", `${sourcePath}.route.titleFieldId`, `Sitemap title field ${JSON.stringify(route.titleFieldId)} does not exist in Content model ${JSON.stringify(model.id)}.`);
					else if (!isSitemapDisplayTitleFieldKind(titleField.kind)) diagnostic(diagnostics, "invalid-sitemap-title-field", `${sourcePath}.route.titleFieldId`, `Sitemap title field ${JSON.stringify(route.titleFieldId)} must be text, long-text, or slug.`);
				}
			}
		});
	});
	diagnostics.sort(compareDiagnostics);
	return diagnostics.length === 0 ? {
		ok: true,
		project: value,
		diagnostics: []
	} : {
		ok: false,
		diagnostics
	};
}
function compareDiagnostics(left, right) {
	return compareUnicodeCodePoints(left.path, right.path) || compareUnicodeCodePoints(left.code, right.code) || compareUnicodeCodePoints(left.message, right.message);
}
//#endregion
//#region src/hosted-content/projection.ts
var blocked = (diagnostics) => ({
	status: "blocked",
	diagnostics: diagnostics.map(({ code, message, path, pathname }) => ({
		code,
		message,
		path,
		...pathname ? { pathname } : {}
	}))
});
/**
* Worker-safe route projection over one Content snapshot, using the same pure compiler as
* `compileStaticSite`. Release policy applies, so only published Entries participate; hosted
* delivery candidates already mark every permitted Entry published.
*/
async function projectHostedSite(plan, providers) {
	const project = structuredClone(plan.project);
	const diagnostics = [];
	for (const provider of providers) {
		const target = project.providers.content.find((item) => item.id === provider.providerId);
		if (!target) diagnostics.push({
			code: "provider-not-planned",
			message: `Content provider ${provider.providerId} is not part of the site plan.`,
			path: "$.providers.content"
		});
		else if (canonicalSerialize(target.models) !== canonicalSerialize(provider.models)) diagnostics.push({
			code: "definition-mismatch",
			message: `Content models of ${provider.providerId} differ from the site plan.`,
			path: "$.providers.content"
		});
		else target.entries = structuredClone(provider.entries);
	}
	if (diagnostics.length) return blocked(diagnostics);
	const validated = validateSiteProject(project, { componentPack: plan.componentPack });
	if (!validated.ok) return blocked(validated.diagnostics);
	const compilation = await compileSiteProject(validated.project, {
		componentCatalog: createComponentCatalog(plan.componentPack),
		policy: "release",
		...plan.assetLock ? { assetLock: plan.assetLock } : {}
	});
	if (compilation.status === "blocked") return blocked(compilation.diagnostics);
	return structuredClone({
		status: "ready",
		projectId: compilation.build.projectId,
		navigation: compilation.build.navigation,
		routes: compilation.build.routes.map((route) => {
			const { modules, ...neutral } = route;
			return neutral;
		})
	});
}
/** A `project` service callback whose render data is the JSON projection of the whole site. */
function createHostedSiteProjector(plan) {
	const fixed = structuredClone(plan);
	return async (providers) => JSON.parse(JSON.stringify(await projectHostedSite(fixed, providers)));
}
//#endregion
export { COMPOSER_PREVIEW_CHANNEL, COMPOSER_PREVIEW_PROTOCOL_VERSION, HostedContentError, canonicalSerialize, createHostedContentService, createHostedSiteProjector, hostedDocumentErrorMessage, hostedDocumentErrorSchema, hostedPreviewBindingSchema, hostedPreviewResponseSchema, hostedReadyMessage, hostedReadySchema, hostedRenderMessage, hostedRenderSchema, hostedRenderedMessage, hostedRenderedSchema, matchesHostedPreviewBinding, projectHostedSite, readHostedPreviewRequest, readHostedPreviewResponse };
