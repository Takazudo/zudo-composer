import { parser } from "@lezer/markdown";
import { z } from "zod";
//#region src/hosted-content/types.ts
var HostedContentError = class extends Error {
	code;
	diagnostics;
	restoreDiagnostics;
	constructor(code, message, diagnostics, restoreDiagnostics) {
		super(message);
		this.code = code;
		this.diagnostics = diagnostics;
		this.restoreDiagnostics = restoreDiagnostics;
		this.name = "HostedContentError";
	}
};
//#endregion
//#region src/content/model/types.ts
var CONTENT_FIELD_KINDS = [
	"text",
	"long-text",
	"markdown",
	"number",
	"boolean",
	"date",
	"slug",
	"color",
	"url",
	"choice",
	"reference",
	"reference-list",
	"object",
	"list",
	"asset-use"
];
//#endregion
//#region src/shared/json.ts
/**
* Recursively decides whether a value is JSON-safe: only strings, finite
* numbers, booleans, null, arrays, and plain objects — never functions,
* `undefined`, symbols, bigints, class instances, or circular references.
* `ancestors` tracks the CURRENT path only (backtracked after each branch) so
* a shared reference in a DAG is not mistaken for a cycle.
*/
function isJsonSafe(value, ancestors = /* @__PURE__ */ new Set()) {
	if (value === null) return true;
	const t = typeof value;
	if (t === "string" || t === "boolean") return true;
	if (t === "number") return Number.isFinite(value);
	if (t !== "object") return false;
	const obj = value;
	const proto = Object.getPrototypeOf(obj);
	if (!Array.isArray(obj) && proto !== Object.prototype && proto !== null) return false;
	if (ancestors.has(obj)) return false;
	ancestors.add(obj);
	let ok;
	if (Array.isArray(obj)) {
		const expectedNames = Array.from({ length: obj.length }, (_item, index) => String(index)).concat("length");
		ok = Object.getOwnPropertySymbols(obj).length === 0 && Object.getOwnPropertyNames(obj).every((name) => expectedNames.includes(name)) && Array.from({ length: obj.length }, (_item, index) => index).every((index) => Object.hasOwn(obj, index) && isJsonSafe(obj[index], ancestors));
	} else {
		const record = obj;
		ok = Object.getOwnPropertySymbols(record).length === 0 && Reflect.ownKeys(record).length === Object.keys(record).length && Object.values(record).every((child) => isJsonSafe(child, ancestors));
	}
	ancestors.delete(obj);
	return ok;
}
/** Narrowing guard: is `value` a plain (non-array) JSON object? */
function isPlainObject(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}
/**
* Structural deep clone of a JSON-safe value. Rejects anything that would not
* round-trip exactly, then uses JSON to produce a fresh, unshared tree.
*/
function cloneJson(value) {
	if (!isJsonSafe(value)) throw new TypeError("Cannot clone a value that does not round-trip through JSON exactly.");
	return JSON.parse(JSON.stringify(value));
}
//#endregion
//#region src/shared/id-factory.ts
/** Lower-cases a hint into an id-safe fragment (letters, digits, dashes). */
function slugHint(hint) {
	if (!hint) return "node";
	return hint.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "node";
}
/**
* A collision-resistant factory for production runtime use. Prefers
* `crypto.randomUUID` when present, falling back to a timestamp+counter id in
* environments without it.
*/
function createUuidIdFactory() {
	let counter = 0;
	return (hint) => {
		counter += 1;
		const cryptoObj = globalThis.crypto;
		const unique = cryptoObj?.randomUUID ? cryptoObj.randomUUID() : `${Date.now().toString(36)}-${counter.toString(36)}`;
		return hint ? `${slugHint(hint)}-${unique}` : unique;
	};
}
//#endregion
//#region src/shared/record-identity.ts
/**
* Lower-case, case-stable ids safe to embed in owned filenames and URL paths.
* Dots, separators, percent escapes, whitespace, and leading/trailing
* punctuation are deliberately excluded. IDs are capped to keep filenames
* portable across providers.
*/
var RECORD_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/;
function isSafeRecordId(value) {
	return typeof value === "string" && RECORD_ID_PATTERN.test(value);
}
//#endregion
//#region src/content/model/validate.ts
var MODEL_RECORD_KEYS = [
	"id",
	"createdAt",
	"updatedAt",
	"document"
];
var MODEL_DOCUMENT_KEYS = [
	"schemaVersion",
	"id",
	"name",
	"description",
	"kind",
	"fields"
];
var FIELD_KEYS = [
	"id",
	"key",
	"label",
	"required",
	"kind"
];
var ENTRY_KEYS = [
	"schemaVersion",
	"id",
	"modelId",
	"createdAt",
	"updatedAt",
	"values",
	"lifecycle",
	"generation"
];
var FIELD_KEY_PATTERN = /^[a-z][A-Za-z0-9]{0,63}$/;
function fail$1(code, message, path, foundSchemaVersion) {
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
function exactKeys(value, keys) {
	return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function isCanonicalContentTimestamp(value) {
	if (typeof value !== "string") return false;
	const date = new Date(value);
	return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
function isContentFieldKey(value) {
	return typeof value === "string" && FIELD_KEY_PATTERN.test(value);
}
function validateEnvelopeTimestamps(value) {
	if (!isCanonicalContentTimestamp(value.createdAt) || !isCanonicalContentTimestamp(value.updatedAt)) return fail$1("invalid-timestamp", "createdAt and updatedAt must be canonical ISO timestamps.");
	if (value.updatedAt < value.createdAt) return fail$1("invalid-timestamp-order", "updatedAt cannot precede createdAt.");
}
function validateField(value, index, depth = 0) {
	const path = `document.fields[${index}]`;
	if (!isPlainObject(value) || !validateSchema(value, FIELD_KEYS.filter((key) => key !== "kind"), depth)) return fail$1("invalid-field", "Field must contain exactly its canonical schema fields (maximum nesting 16).", path);
	if (!isSafeRecordId(value.id)) return fail$1("unsafe-id", "Field id must be a safe record id.", `${path}.id`);
	if (!isContentFieldKey(value.key)) return fail$1("invalid-field", "Field key must be lower-camel and 1-64 characters.", `${path}.key`);
	if (typeof value.label !== "string" || value.label.trim().length === 0) return fail$1("invalid-field", "Field label must be non-empty.", `${path}.label`);
	if (typeof value.required !== "boolean") return fail$1("invalid-field", "Field required must be boolean.", `${path}.required`);
	if (typeof value.kind !== "string" || !CONTENT_FIELD_KINDS.includes(value.kind)) return fail$1("invalid-field", "Field kind is unsupported.", `${path}.kind`);
	return {
		ok: true,
		value
	};
}
function validateContentModelRecord(value) {
	if (!isPlainObject(value) || !exactKeys(value, MODEL_RECORD_KEYS)) return fail$1("invalid-record", "Content model record must contain exactly its canonical envelope fields.");
	if (!isJsonSafe(value)) return fail$1("not-json-safe", "Content model record must be JSON-safe.");
	if (!isSafeRecordId(value.id)) return fail$1("unsafe-id", "Content model id must be a safe record id.", "id");
	const timestampFailure = validateEnvelopeTimestamps(value);
	if (timestampFailure) return timestampFailure;
	if (!isPlainObject(value.document) || !exactKeys(value.document, [...MODEL_DOCUMENT_KEYS, ...Object.hasOwn(value.document, "presentation") ? ["presentation"] : []])) return fail$1("malformed-document", "Content model document must contain exactly its canonical fields.");
	const document = value.document;
	if (typeof document.schemaVersion === "number" && document.schemaVersion > 1) return fail$1("future-schema", "Content model uses a newer schema version.", "document.schemaVersion", document.schemaVersion);
	if (document.schemaVersion !== 1) return fail$1("malformed-document", "Content model schema version is invalid.");
	if (!isSafeRecordId(document.id) || document.id !== value.id) return fail$1("id-mismatch", "Record id must match its safe document id.");
	if (typeof document.name !== "string" || document.name.trim().length === 0) return fail$1("malformed-document", "Content model name must be non-empty.", "document.name");
	if (typeof document.description !== "string") return fail$1("malformed-document", "Content model description must be a string.", "document.description");
	if (document.kind !== "collection" && document.kind !== "single") return fail$1("malformed-document", "Content model kind is invalid.", "document.kind");
	if (!Array.isArray(document.fields)) return fail$1("malformed-document", "Content model fields must be an array.", "document.fields");
	const ids = /* @__PURE__ */ new Set();
	const keys = /* @__PURE__ */ new Set();
	for (let index = 0; index < document.fields.length; index += 1) {
		const field = validateField(document.fields[index], index);
		if (!field.ok) return field;
		if (ids.has(field.value.id)) return fail$1("duplicate-field-id", `Duplicate field id "${field.value.id}".`);
		if (keys.has(field.value.key)) return fail$1("duplicate-field-key", `Duplicate field key "${field.value.key}".`);
		ids.add(field.value.id);
		keys.add(field.value.key);
	}
	if (document.presentation !== void 0 && !validatePresentation(document.presentation, ids)) return fail$1("malformed-document", "Presentation must use unique ids and existing field ids.", "document.presentation");
	return {
		ok: true,
		value
	};
}
function validateContentEntryRecord(value) {
	if (!isPlainObject(value) || !exactKeys(value, ENTRY_KEYS)) return fail$1("invalid-record", "Content Entry must contain exactly its canonical fields.");
	if (!isJsonSafe(value)) return fail$1("not-json-safe", "Content Entry must be JSON-safe.");
	if (typeof value.schemaVersion === "number" && value.schemaVersion > 1) return fail$1("future-schema", "Content Entry uses a newer schema version.", "schemaVersion", value.schemaVersion);
	if (value.schemaVersion !== 1) return fail$1("invalid-record", "Content Entry schema version is invalid.");
	if (!isSafeRecordId(value.id) || !isSafeRecordId(value.modelId)) return fail$1("unsafe-id", "Entry id and modelId must be safe record ids.");
	if (value.lifecycle !== "draft" && value.lifecycle !== "published") return fail$1("invalid-record", "Entry lifecycle must be draft or published.");
	if (!Number.isSafeInteger(value.generation) || value.generation < 0) return fail$1("invalid-record", "Entry generation must be a nonnegative safe integer.");
	const timestampFailure = validateEnvelopeTimestamps(value);
	if (timestampFailure) return timestampFailure;
	if (!isPlainObject(value.values)) return fail$1("invalid-value", "Entry values must be a plain object.", "values");
	for (const fieldId of Object.keys(value.values)) if (!isSafeRecordId(fieldId)) return fail$1("unsafe-id", "Entry value keys must be safe field ids.", `values.${fieldId}`);
	return {
		ok: true,
		value
	};
}
function isValueValidForField(field, value) {
	switch (field.kind) {
		case "number": return typeof value === "number" && Number.isFinite(value);
		case "boolean": return typeof value === "boolean";
		case "date": return typeof value === "string" && (value === "" || isCanonicalContentDate(value));
		case "url": return typeof value === "string" && (value === "" || isContentUrl(value));
		case "choice": return typeof value === "string" && (value === "" || field.options.some((option) => option.value === value));
		case "reference": return isEntryRef(value) && value.providerId === field.target.providerId && value.modelId === field.target.recordId;
		case "reference-list": return Array.isArray(value) && value.every((item) => isValueValidForField({
			kind: "reference",
			target: field.target
		}, item)) && new Set(value.map((item) => JSON.stringify([
			item.providerId,
			item.modelId,
			item.recordId
		]))).size === value.length;
		case "object": return isPlainObject(value) && Object.entries(value).every(([id, item]) => {
			const child = field.fields.find((candidate) => candidate.id === id);
			return !!child && isValueValidForField(child, item);
		});
		case "list": return Array.isArray(value) && value.every((item) => isValueValidForField(field.item, item));
		case "asset-use": return isContentAssetUse(value) && value.kind === field.use;
		default: return typeof value === "string";
	}
}
function isCanonicalContentDate(value) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = /* @__PURE__ */ new Date(`${value}T00:00:00.000Z`);
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
/** Authoring URLs may be same-site paths or explicit http(s)/mailto/tel URLs. */
function isContentUrl(value) {
	if (/[\s\\]/.test(value) || Array.from(value).some((character) => character.charCodeAt(0) < 32)) return false;
	if (/^\/(?!\/)/.test(value) || /^#[^\s]*$/.test(value)) return true;
	try {
		const url = new URL(value);
		return [
			"http:",
			"https:",
			"mailto:",
			"tel:"
		].includes(url.protocol);
	} catch {
		return false;
	}
}
function isRef(value) {
	return isPlainObject(value) && exactKeys(value, ["providerId", "recordId"]) && typeof value.providerId === "string" && value.providerId.trim().length > 0 && isSafeRecordId(value.recordId);
}
function isEntryRef(value) {
	return isPlainObject(value) && exactKeys(value, [
		"providerId",
		"modelId",
		"recordId"
	]) && typeof value.providerId === "string" && value.providerId.trim().length > 0 && isSafeRecordId(value.recordId) && isSafeRecordId(value.modelId);
}
function isContentAssetUse(value) {
	if (!isPlainObject(value) || !isPlainObject(value.asset) || !exactKeys(value.asset, ["providerId", "assetId"]) || !isSafeRecordId(value.asset.providerId) || !isSafeRecordId(value.asset.assetId)) return false;
	switch (value.kind) {
		case "image": return exactKeys(value, [
			"kind",
			"asset",
			"alt",
			"decorative",
			"caption"
		]) && typeof value.alt === "string" && typeof value.decorative === "boolean" && typeof value.caption === "string" && (!value.decorative || value.alt === "");
		case "download": return exactKeys(value, [
			"kind",
			"asset",
			"label",
			"showSize",
			"showType"
		]) && typeof value.label === "string" && typeof value.showSize === "boolean" && typeof value.showType === "boolean";
		case "link": return exactKeys(value, [
			"kind",
			"asset",
			"label"
		]) && typeof value.label === "string";
		case "card": return exactKeys(value, [
			"kind",
			"asset",
			"title",
			"description"
		]) && typeof value.title === "string" && typeof value.description === "string";
		default: return false;
	}
}
function validateSchema(value, extra = [], depth = 0) {
	if (depth > 16) return false;
	const keys = [...extra, "kind"];
	switch (value.kind) {
		case "choice": return exactKeys(value, [...keys, "options"]) && Array.isArray(value.options) && value.options.length > 0 && value.options.every((option) => isPlainObject(option) && exactKeys(option, ["value", "label"]) && typeof option.value === "string" && option.value.trim().length > 0 && typeof option.label === "string" && option.label.trim().length > 0) && new Set(value.options.map((option) => option.value)).size === value.options.length;
		case "reference": return exactKeys(value, [...keys, "target"]) && isRef(value.target);
		case "reference-list": return exactKeys(value, [
			...keys,
			"target",
			"ordered"
		]) && isRef(value.target) && typeof value.ordered === "boolean";
		case "object": return exactKeys(value, [...keys, "fields"]) && Array.isArray(value.fields) && value.fields.every((field, index) => validateField(field, index, depth + 1).ok) && new Set(value.fields.map((field) => field.id)).size === value.fields.length && new Set(value.fields.map((field) => field.key)).size === value.fields.length;
		case "list": return exactKeys(value, [...keys, "item"]) && isPlainObject(value.item) && validateSchema(value.item, [], depth + 1);
		case "asset-use": return exactKeys(value, [...keys, "use"]) && [
			"image",
			"link",
			"card",
			"download"
		].includes(value.use);
		default: return exactKeys(value, keys) && typeof value.kind === "string" && CONTENT_FIELD_KINDS.includes(value.kind);
	}
}
function validatePresentation(value, fields) {
	if (!isPlainObject(value) || !exactKeys(value, [
		"groups",
		"views",
		"inverses"
	])) return false;
	for (const key of ["groups", "views"]) {
		const items = value[key];
		if (!Array.isArray(items) || !items.every((item) => isPlainObject(item) && exactKeys(item, [
			"id",
			"label",
			"fieldIds"
		]) && isSafeRecordId(item.id) && typeof item.label === "string" && item.label.trim() && Array.isArray(item.fieldIds) && item.fieldIds.every((id) => fields.has(id)) && new Set(item.fieldIds).size === item.fieldIds.length) || new Set(items.map((item) => item.id)).size !== items.length) return false;
	}
	return Array.isArray(value.inverses) && value.inverses.every((item) => isPlainObject(item) && exactKeys(item, [
		"id",
		"label",
		"source",
		"fieldId"
	]) && isSafeRecordId(item.id) && typeof item.label === "string" && item.label.trim() && isRef(item.source) && isSafeRecordId(item.fieldId)) && new Set(value.inverses.map((item) => item.id)).size === value.inverses.length;
}
//#endregion
//#region src/content/model/values.ts
/** Visits structured containers and every populated nested value, in stored order. */
function traverseContentValues(model, entry) {
	const result = [];
	function visit(schema, value, field, path) {
		if (value === void 0) return;
		result.push({
			schema,
			value,
			field,
			path
		});
		if (schema.kind === "object" && value !== null && typeof value === "object" && !Array.isArray(value)) for (const child of schema.fields) visit(child, value[child.id], child, [...path, child.id]);
		if (schema.kind === "list" && Array.isArray(value)) value.forEach((item, index) => visit(schema.item, item, field, [...path, index]));
	}
	for (const field of model.document.fields) visit(field, entry.values[field.id], field, [field.id]);
	return result;
}
function traverseContentSchema(fields) {
	const result = [];
	function visit(schema, field, path) {
		result.push({
			schema,
			field,
			path
		});
		if (schema.kind === "object") for (const child of schema.fields) visit(child, child, [...path, child.id]);
		if (schema.kind === "list") visit(schema.item, field, [...path, "[]"]);
	}
	for (const field of fields) visit(field, field, [field.id]);
	return result;
}
//#endregion
//#region src/content/library/helpers.ts
var defaultContentIdFactory = createUuidIdFactory();
function createContentEntryRecord(modelId, values, options) {
	const id = options.id ?? (options.idFactory ?? defaultContentIdFactory)("content-entry");
	const timestamp = options.timestamp ?? options.now?.() ?? (/* @__PURE__ */ new Date()).toISOString();
	return {
		schemaVersion: 1,
		id,
		modelId,
		createdAt: timestamp,
		updatedAt: timestamp,
		values: structuredClone(values),
		lifecycle: "draft",
		generation: 0
	};
}
function empty(value) {
	return value === void 0 || value === null || typeof value === "string" && value.trim().length === 0 || Array.isArray(value) && value.length === 0;
}
function diagnoseContentEntryCompleteness(model, entry) {
	const diagnostics = [];
	function visit(schema, value, field, path, required) {
		const add = (code, message) => diagnostics.push({
			code,
			modelId: model.id,
			entryId: entry.id,
			fieldId: field.id,
			fieldKey: field.key,
			path,
			message
		});
		if (empty(value)) {
			if (required) add("required-value-missing", `Required field "${field.label}" is empty.`);
			return;
		}
		if (schema.kind === "object" && value && typeof value === "object" && !Array.isArray(value)) for (const child of schema.fields) visit(child, value[child.id], child, [...path, child.id], child.required);
		if (schema.kind === "list" && Array.isArray(value)) value.forEach((item, index) => visit(schema.item, item, field, [...path, index], true));
		if (schema.kind === "asset-use" && value && typeof value === "object") {
			const use = value;
			if (use.kind === "image" && !use.decorative && empty(use.alt) || (use.kind === "link" || use.kind === "download") && empty(use.label) || use.kind === "card" && empty(use.title)) add("semantic-value-incomplete", `Asset use in "${field.label}" needs its per-use accessible text.`);
		}
	}
	for (const field of model.document.fields) visit(field, entry.values[field.id], field, [field.id], field.required);
	return diagnostics;
}
//#endregion
//#region src/content/library/graph.ts
var contentRefKey = (ref) => JSON.stringify([ref.providerId, ref.recordId]);
var contentEntryRefKey = (ref) => JSON.stringify([
	ref.providerId,
	ref.modelId,
	ref.recordId
]);
/** Every supplied provider snapshot must come from readAll, never a loaded UI page. */
function buildContentGraphIndex(snapshots) {
	const diagnostics = [], relations = [];
	const assetUses = [], modelDependencies = [];
	const fieldDependencies = [];
	const providers = /* @__PURE__ */ new Map();
	const modelsByRef = /* @__PURE__ */ new Map(), entryRefs = /* @__PURE__ */ new Set();
	for (const snapshot of snapshots) {
		if (providers.has(snapshot.providerId)) diagnostics.push({
			code: "invalid-record",
			providerId: snapshot.providerId,
			recordId: "",
			message: "Duplicate provider snapshot."
		});
		providers.set(snapshot.providerId, snapshot);
		for (const model of snapshot.models) modelsByRef.set(contentRefKey({
			providerId: snapshot.providerId,
			recordId: model.id
		}), model);
		for (const entry of snapshot.entries) entryRefs.add(contentEntryRefKey({
			providerId: snapshot.providerId,
			modelId: entry.modelId,
			recordId: entry.id
		}));
	}
	const modelFor = (ref) => modelsByRef.get(contentRefKey(ref));
	for (const snapshot of snapshots) {
		const add = (code, recordId, message, path) => diagnostics.push({
			code,
			recordId,
			providerId: snapshot.providerId,
			message,
			...path ? { path } : {}
		});
		const ids = /* @__PURE__ */ new Set();
		const validModels = /* @__PURE__ */ new Set();
		for (const model of snapshot.models) {
			if (ids.has(model.id) || !validateContentModelRecord(model).ok) {
				add("invalid-record", model.id, "Duplicate or malformed model.");
				continue;
			}
			ids.add(model.id);
			validModels.add(model);
			for (const { schema, field, path } of traverseContentSchema(model.document.fields)) {
				if (schema.kind !== "reference" && schema.kind !== "reference-list") continue;
				modelDependencies.push({
					source: {
						providerId: snapshot.providerId,
						recordId: model.id
					},
					target: schema.target,
					fieldId: field.id,
					path
				});
				if (!modelFor(schema.target)) add(providers.has(schema.target.providerId) ? "missing-model" : "missing-provider", model.id, "Reference schema target cannot be resolved.", path);
			}
			for (const inverse of model.document.presentation?.inverses ?? []) {
				fieldDependencies.push({
					source: {
						providerId: snapshot.providerId,
						recordId: model.id
					},
					target: inverse.source,
					fieldId: inverse.fieldId,
					reason: `Inverse ${inverse.id}`
				});
				if (!providers.has(inverse.source.providerId)) {
					add("missing-provider", model.id, `Inverse ${inverse.id} provider is unavailable.`);
					continue;
				}
				const sourceModel = modelFor(inverse.source);
				const field = sourceModel && validateContentModelRecord(sourceModel).ok ? sourceModel.document.fields.find((field) => field.id === inverse.fieldId) : void 0;
				if (!field || field.kind !== "reference" && field.kind !== "reference-list" || field.target.providerId !== snapshot.providerId || field.target.recordId !== model.id) add("invalid-inverse", model.id, `Inverse ${inverse.id} must name an owning reference field targeting this model.`);
			}
			for (const item of [...model.document.presentation?.groups ?? [], ...model.document.presentation?.views ?? []]) for (const fieldId of item.fieldIds) fieldDependencies.push({
				source: {
					providerId: snapshot.providerId,
					recordId: model.id
				},
				target: {
					providerId: snapshot.providerId,
					recordId: model.id
				},
				fieldId,
				reason: `Presentation ${item.id}`
			});
		}
		const entryIds = /* @__PURE__ */ new Set(), counts = /* @__PURE__ */ new Map();
		for (const entry of snapshot.entries) {
			if (entryIds.has(entry.id) || !validateContentEntryRecord(entry).ok) {
				add("invalid-record", entry.id, "Duplicate or malformed entry.");
				continue;
			}
			entryIds.add(entry.id);
			const model = modelFor({
				providerId: snapshot.providerId,
				recordId: entry.modelId
			});
			if (!model) {
				add("missing-model", entry.id, "Entry model cannot be resolved.");
				continue;
			}
			if (!validModels.has(model)) continue;
			const count = (counts.get(model.id) ?? 0) + 1;
			counts.set(model.id, count);
			if (model.document.kind === "single" && count > 1) add("single-cardinality", entry.id, "Single model permits at most one entry.");
			for (const [id, value] of Object.entries(entry.values)) {
				const field = model.document.fields.find((field) => field.id === id);
				if (!field || !isValueValidForField(field, value)) add("invalid-value", entry.id, "Value does not match its field schema.", [id]);
			}
			for (const issue of diagnoseContentEntryCompleteness(model, entry)) add("incomplete", entry.id, issue.message, issue.path);
			for (const { schema, field, path, value } of traverseContentValues(model, entry)) {
				if (!isValueValidForField(schema, value)) continue;
				const location = {
					entry: {
						providerId: snapshot.providerId,
						modelId: entry.modelId,
						recordId: entry.id
					},
					fieldId: field.id,
					path
				};
				if (schema.kind === "asset-use") assetUses.push({
					location,
					use: value
				});
				if (schema.kind !== "reference" && schema.kind !== "reference-list") continue;
				(schema.kind === "reference" ? [value] : value).forEach((target, index) => {
					relations.push({
						owner: {
							...location,
							path: schema.kind === "reference-list" ? [...path, index] : path
						},
						target,
						ordered: schema.kind === "reference-list" && schema.ordered
					});
					if (!providers.get(target.providerId)) add("missing-provider", entry.id, "Reference target provider is unavailable.", path);
					else if (!entryRefs.has(contentEntryRefKey(target))) add("missing-entry", entry.id, "Reference target entry is missing or has the wrong model.", path);
				});
			}
		}
	}
	return {
		complete: diagnostics.every((issue) => issue.code === "incomplete"),
		diagnostics,
		relations,
		assetUses,
		modelDependencies,
		fieldDependencies,
		incoming: (ref) => relations.filter((edge) => contentEntryRefKey(edge.target) === contentEntryRefKey(ref))
	};
}
//#endregion
//#region src/hosted-content/canonical.ts
/** JSON canonicalization used for identities. Rejects values JSON would silently lose. */
function canonicalSerialize(value) {
	const ancestors = /* @__PURE__ */ new Set();
	function encode(item) {
		if (item === null || typeof item === "boolean" || typeof item === "string") return JSON.stringify(item);
		if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
		if (typeof item !== "object" || item === null || ancestors.has(item)) throw new TypeError("Expected finite, acyclic JSON.");
		const prototype = Object.getPrototypeOf(item);
		if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) throw new TypeError("Expected plain JSON objects.");
		ancestors.add(item);
		let result;
		if (Array.isArray(item)) {
			const values = [];
			for (let index = 0; index < item.length; index++) values.push(encode(item[index]));
			result = `[${values.join(",")}]`;
		} else result = `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${encode(item[key])}`).join(",")}}`;
		ancestors.delete(item);
		return result;
	}
	return encode(value);
}
//#endregion
//#region src/hosted-content/validation.ts
var token = z.string().min(1).max(256);
var ref$1 = z.object({
	providerId: token,
	modelId: token,
	recordId: token
}).strict();
var expected = z.object({
	draftRevision: token,
	baseline: z.object({
		gitSha: token,
		contentDigest: token
	}).strict(),
	definition: token
}).strict();
var json = z.lazy(() => z.union([
	z.null(),
	z.boolean(),
	z.number().finite(),
	z.string().max(1e5),
	z.array(json).max(1e3),
	z.record(z.string().min(1).max(256), json)
]));
var values = z.record(token, json);
var base = {
	operationKey: token,
	expected
};
var commandSchema = z.discriminatedUnion("kind", [
	z.object({
		...base,
		kind: z.literal("set-fields"),
		entry: ref$1,
		values,
		clear: z.array(token).max(200)
	}).strict(),
	z.object({
		...base,
		kind: z.literal("create-entry"),
		collectionId: token,
		values,
		before: ref$1.nullable()
	}).strict(),
	z.object({
		...base,
		kind: z.literal("add-entry"),
		collectionId: token,
		entry: ref$1,
		before: ref$1.nullable()
	}).strict(),
	z.object({
		...base,
		kind: z.literal("reorder"),
		collectionId: token,
		entries: z.array(ref$1).max(1e3)
	}).strict(),
	z.object({
		...base,
		kind: z.literal("capture-snapshot")
	}).strict(),
	z.object({
		...base,
		kind: z.literal("begin-publication"),
		snapshotId: token
	}).strict(),
	z.object({
		...base,
		kind: z.literal("restore-revision"),
		entry: ref$1,
		revisionId: token
	}).strict()
]);
var pageSchema = {
	cursor: token.optional(),
	limit: z.number().int().min(1).max(100).optional()
};
var perspective = z.enum(["working", "published"]);
var target = z.union([z.object({ revisionId: token }).strict(), z.object({ perspective }).strict()]);
var querySchemas = {
	entries: z.object({
		perspective,
		providerId: token,
		modelId: token,
		...pageSchema
	}).strict(),
	entry: z.object({
		perspective,
		entry: ref$1
	}).strict(),
	revisions: z.object({
		entry: ref$1,
		...pageSchema
	}).strict(),
	revision: token,
	compare: z.object({
		entry: ref$1,
		from: target,
		to: target
	}).strict()
};
/** Editorial reads are validated like commands, so every entry point shares one shape. */
function parseHostedQuery(kind, request) {
	const parsed = querySchemas[kind].safeParse(request);
	if (!parsed.success) throw new HostedContentError("invalid-request", "Malformed hosted query.");
	return parsed.data;
}
function parseHostedCommand(request) {
	let count = 0, bytes = 0;
	const stack = [{
		value: request,
		depth: 0
	}];
	while (stack.length) {
		const { value, depth } = stack.pop();
		if (++count > 2e4 || depth > 24) throw new HostedContentError("invalid-request", "Request exceeds structural limits.");
		if (typeof value === "string") bytes += value.length;
		if (bytes > 1e6) throw new HostedContentError("invalid-request", "Request exceeds size limit.");
		if (value && typeof value === "object") {
			if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new HostedContentError("invalid-request", "Request must contain plain JSON.");
			for (const [key, child] of Object.entries(value)) {
				if ([
					"__proto__",
					"constructor",
					"prototype"
				].includes(key)) throw new HostedContentError("invalid-request", "Unsafe value key.");
				stack.push({
					value: child,
					depth: depth + 1
				});
			}
		}
	}
	const parsed = commandSchema.safeParse(request);
	if (!parsed.success) throw new HostedContentError("invalid-request", "Malformed hosted command.");
	const command = parsed.data;
	if (command.kind === "set-fields" && (new Set(command.clear).size !== command.clear.length || command.clear.some((id) => Object.hasOwn(command.values, id)))) throw new HostedContentError("invalid-request", "Fields may be named only once.");
	return parsed.data;
}
var sameValue = (left, right) => left === void 0 || right === void 0 ? left === right : canonicalSerialize(left) === canonicalSerialize(right);
function forbidden(path) {
	throw new HostedContentError("forbidden", `Field ${path} is protected.`);
}
function invalid(path, message) {
	throw new HostedContentError("invalid-value", `${path}: ${message}`);
}
function assertSafeUrl(value) {
	if (value.length === 0 || value.charCodeAt(0) <= 32 || Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "\\") || value.startsWith("//") || !/^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(value)) throw new HostedContentError("invalid-value", "URL must use an approved non-executable scheme or a site-relative path.");
}
function decodeDestination(raw) {
	let decoded = raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
	decoded = decoded.replace(/&#(?:x([\da-f]+)|(\d+));?/gi, (_, hex, decimal) => String.fromCodePoint(Math.min(1114111, Number.parseInt(hex || decimal, hex ? 16 : 10))));
	decoded = decoded.replace(/&colon;/gi, ":").replace(/&(?:tab|newline);/gi, "").replace(/\\([\s\S])/g, "$1");
	try {
		decoded = decodeURIComponent(decoded);
	} catch {}
	return decoded;
}
var markupNodes = /* @__PURE__ */ new Set([
	"HTMLBlock",
	"HTMLTag",
	"CommentBlock",
	"Comment",
	"ProcessingInstructionBlock",
	"ProcessingInstruction",
	"Image"
]);
var unsafeMarkdown = () => {
	throw new HostedContentError("invalid-value", "Markdown contains source, HTML, an image or an unsafe URL; use approved asset fields.");
};
/** Hosted Markdown is CommonMark prose, never MDX: hosts must render it as Markdown text, so braces stay literal. */
function assertSafeMarkdown(value) {
	parser.parse(value).iterate({ enter(node) {
		if (markupNodes.has(node.name)) unsafeMarkdown();
		if (node.name === "URL") assertSafeUrl(decodeDestination(value.slice(node.from, node.to)));
		if (node.name === "Paragraph" && node.node.parent?.name === "Document" && /^(?:import|export)\s+(?:[\w$*{},\s]+\s+from\s+["']|["']|(?:const|let|var|function|class|default)\b)/.test(value.slice(node.from, node.to))) unsafeMarkdown();
	} });
}
/** Compare actual stored values, including protected descendants, before applying replacement. */
function assertFieldChange(schema, permission, previous, next, policy, path, validateMarkdown) {
	if (sameValue(previous, next)) return;
	if (!permission) forbidden(path);
	if (schema.kind === "slug" || schema.kind === "reference" || schema.kind === "reference-list") forbidden(path);
	if (next === void 0) {
		if (!permission.clear) forbidden(path);
		if (schema.kind === "object") for (const field of schema.fields) assertFieldChange(field, permission.children?.find((item) => item.fieldId === field.id), previous?.[field.id], void 0, policy, `${path}.${field.id}`, validateMarkdown);
		else if (schema.kind === "list" || schema.kind === "asset-use") forbidden(path);
		return;
	}
	if (!isValueValidForField(schema, next)) invalid(path, "Value does not match the Content schema.");
	if (typeof next === "string" && permission.maxLength !== void 0 && next.length > permission.maxLength) invalid(path, "Value exceeds the configured length.");
	if (schema.kind === "object") {
		const before = previous ?? {}, after = next;
		for (const field of schema.fields) assertFieldChange(field, permission.children?.find((item) => item.fieldId === field.id) ?? (permission.replace ? {
			fieldId: field.id,
			replace: true,
			clear: permission.clear
		} : void 0), before[field.id], after[field.id], policy, `${path}.${field.id}`, validateMarkdown);
		return;
	}
	if (schema.kind === "list") {
		const before = previous ?? [], after = next;
		if (after.length > before.length && !permission.listAdd || after.length < before.length && !permission.listRemove) forbidden(path);
		if (permission.maxLength !== void 0 && after.length > permission.maxLength) invalid(path, "List exceeds the configured length.");
		if (after.length !== before.length) {
			if (!permission.replace || containsProtected(schema.item)) forbidden(path);
		}
		if (sameValue(before.map(canonicalSerialize).sort(), after.map(canonicalSerialize).sort()) && !permission.listReorder) forbidden(path);
		for (let index = 0; index < Math.max(before.length, after.length); index++) assertFieldChange(schema.item, {
			...permission,
			maxLength: void 0,
			clear: permission.listRemove
		}, before[index], after[index], policy, `${path}[${index}]`, validateMarkdown);
		return;
	}
	if (schema.kind === "asset-use") {
		const before = previous, after = next;
		const asset = after.asset;
		if (!policy.assets.some((item) => item.providerId === asset.providerId && item.assetId === asset.assetId)) forbidden(path);
		if (!sameValue(before?.asset, after.asset) && !permission.assetSelect) forbidden(path);
		if (before && before.kind !== after.kind) forbidden(path);
		for (const key of Object.keys(after)) if (key !== "kind" && key !== "asset" && !sameValue(before?.[key], after[key]) && !permission.assetDescription?.includes(key)) forbidden(`${path}.${key}`);
		return;
	}
	if (!permission.replace) forbidden(path);
	if (schema.kind === "url" && next !== "") assertSafeUrl(next);
	if (schema.kind === "markdown") {
		assertSafeMarkdown(next);
		validateMarkdown?.(next);
	}
}
function containsProtected(schema) {
	return [
		"slug",
		"reference",
		"reference-list",
		"asset-use"
	].includes(schema.kind) || schema.kind === "object" && schema.fields.some(containsProtected) || schema.kind === "list" && containsProtected(schema.item);
}
//#endregion
//#region src/hosted-content/service.ts
var copy = (value) => structuredClone(value);
function fail(code, message) {
	throw new HostedContentError(code, message);
}
var identity = (state) => ({
	draftRevision: state.draftRevision,
	baseline: copy(state.baseline),
	definition: state.definition
});
var terminal = (publication) => [
	"integrated",
	"deployed",
	"failed",
	"conflict"
].includes(publication.status);
var rank = {
	submitted: 0,
	building: 1,
	verified: 2,
	integrated: 3,
	deployed: 4
};
var commitAttempts = 16;
var defaultPageSize = 50;
var ref = (providerId, entry) => ({
	providerId,
	modelId: entry.modelId,
	recordId: entry.id
});
function lookup(providers, target) {
	return providers.find((provider) => provider.providerId === target.providerId)?.entries.find((entry) => entry.id === target.recordId && entry.modelId === target.modelId);
}
/** Entries whose values differ, including created ones; lifecycle-only changes are not content changes. */
function changedEntries(before, after) {
	return after.flatMap((provider) => provider.entries.flatMap((next) => {
		const entry = ref(provider.providerId, next), previous = lookup(before, entry);
		return previous && sameValue(previous.values, next.values) ? [] : [{
			entry,
			previous,
			next
		}];
	}));
}
function editorialStatus(head, target) {
	const published = lookup(head.baselineProviders, target), working = lookup(head.state.providers, target);
	if (!published) return "new";
	return working && !sameValue(working.values, published.values) ? "changed" : "published";
}
function parseCursor(cursor) {
	if (cursor === void 0) return void 0;
	if (!/^[1-9]\d{0,15}$/.test(cursor)) fail("invalid-request", "Malformed cursor.");
	return Number(cursor);
}
/** Trusted, site-bound service. Host callbacks are privileged; never expose them as client verbs. */
function createHostedContentService(supplied) {
	const options = {
		...supplied,
		policy: copy(supplied.policy)
	};
	for (const asset of options.policy.assets) {
		assertSafeUrl(asset.url);
		if (!asset.versionId || !asset.checksum) fail("configuration-required", "Approved assets require exact versions and checksums.");
	}
	const authorize = async (actor) => {
		if (!actor || typeof actor.id !== "string" || !actor.id.trim()) fail("forbidden", "An authenticated actor is required.");
		await options.authorize(copy(actor));
	};
	function findEntry(providers, ref) {
		return providers.find((provider) => provider.providerId === ref.providerId)?.entries.find((entry) => entry.id === ref.recordId && entry.modelId === ref.modelId) ?? fail("not-found", "Entry is unavailable.");
	}
	function modelPermission(ref) {
		return options.policy.models.find((model) => model.providerId === ref.providerId && model.modelId === ref.modelId) ?? fail("forbidden", "Model is outside the hosted policy.");
	}
	function membership(providers, collection) {
		const owner = findEntry(providers, collection.owner);
		const field = providers.find((provider) => provider.providerId === collection.owner.providerId)?.models.find((model) => model.id === owner.modelId)?.document.fields.find((field) => field.id === collection.fieldId);
		if (!field || field.kind !== "reference-list" || !field.ordered || field.target.providerId !== collection.target.providerId || field.target.recordId !== collection.target.modelId) fail("configuration-required", "Collection must name a Content-owned ordered reference list.");
		const value = owner.values[collection.fieldId];
		if (value === void 0) return [];
		if (!Array.isArray(value)) fail("invalid-value", "Collection membership is malformed.");
		return value;
	}
	function ownerExists(providers, collection) {
		return !!providers.find((provider) => provider.providerId === collection.owner.providerId)?.entries.some((entry) => entry.id === collection.owner.recordId && entry.modelId === collection.owner.modelId);
	}
	function permitted(providers, ref) {
		const model = options.policy.models.find((item) => item.providerId === ref.providerId && item.modelId === ref.modelId);
		if (!model) return false;
		return model.entryIds.includes(ref.recordId) || options.policy.collections.some((collection) => collection.target.providerId === ref.providerId && collection.target.modelId === ref.modelId && ownerExists(providers, collection) && membership(providers, collection).some((item) => contentEntryRefKey(item) === contentEntryRefKey(ref)));
	}
	function visible(providers, ref) {
		return permitted(providers, ref) || options.policy.collections.some((collection) => contentEntryRefKey(collection.owner) === contentEntryRefKey(ref));
	}
	function publicProviders(providers) {
		return copy(providers.map((provider) => ({
			...provider,
			models: provider.models.filter((model) => options.policy.models.some((permission) => permission.providerId === provider.providerId && permission.modelId === model.id) || options.policy.collections.some((collection) => collection.owner.providerId === provider.providerId && collection.owner.modelId === model.id)),
			entries: provider.entries.filter((entry) => visible(providers, {
				providerId: provider.providerId,
				modelId: entry.modelId,
				recordId: entry.id
			}))
		})).filter((provider) => provider.models.length || provider.entries.length));
	}
	function publicState(state) {
		return copy({
			...state,
			providers: publicProviders(state.providers)
		});
	}
	/** Browser read projection only. The digest still binds the complete immutable stored candidate,
	* including protected baseline records; it is not a hash of these scoped providers. The trusted
	* host's approved renderData is shared unchanged with preview and delivery. */
	function publicSnapshot(snapshot) {
		const providers = publicProviders(snapshot.providers);
		const diagnostics = providers.flatMap((provider) => provider.entries.flatMap((entry) => diagnoseContentEntryCompleteness(provider.models.find((model) => model.id === entry.modelId), entry)));
		return copy({
			...snapshot,
			providers,
			diagnostics
		});
	}
	function checkExpected(state, expected) {
		if (state.definition !== options.definition) fail("configuration-required", "The hosted definition changed; the host must adopt the canonical baseline before edits continue.");
		if (expected.definition !== state.definition) fail("definition-conflict", "Hosted definition changed; reload and review the retained draft.");
		if (!sameValue(expected.baseline, state.baseline)) fail("baseline-conflict", "Canonical baseline changed; reload and review the retained draft.");
		if (expected.draftRevision !== state.draftRevision) fail("revision-conflict", "The draft changed; reload and review before reapplying.");
	}
	function checkGraph(providers) {
		const graph = buildContentGraphIndex(providers.map((provider) => ({
			...provider,
			mutationToken: 0
		})));
		if (!graph.complete) fail("invalid-value", graph.diagnostics.filter((issue) => issue.code !== "incomplete").map((issue) => `${issue.recordId}: ${issue.message}`).join(" "));
		for (const { use } of graph.assetUses) if (!options.policy.assets.some((asset) => asset.providerId === use.asset.providerId && asset.assetId === use.asset.assetId)) fail("forbidden", "Content references an unapproved asset.");
		for (const collection of options.policy.collections) {
			const entries = membership(providers, collection);
			if (entries.length > collection.maxItems || new Set(entries.map(contentEntryRefKey)).size !== entries.length) fail("invalid-value", "Collection cardinality or membership is invalid.");
		}
		return providers.flatMap((provider) => provider.entries.flatMap((entry) => diagnoseContentEntryCompleteness(provider.models.find((model) => model.id === entry.modelId), entry)));
	}
	function setFields(providers, ref, values, clear, creating = false) {
		const permission = modelPermission(ref);
		if (!creating && !permitted(providers, ref)) fail("forbidden", "Entry is outside the hosted policy.");
		const entry = findEntry(providers, ref), model = providers.find((provider) => provider.providerId === ref.providerId).models.find((model) => model.id === ref.modelId);
		if (!model) fail("not-found", "Entry model is unavailable.");
		for (const fieldId of [...Object.keys(values), ...clear]) {
			const field = model.document.fields.find((item) => item.id === fieldId);
			if (!field) fail("forbidden", `Unknown field ${fieldId}.`);
			if (options.policy.collections.some((collection) => contentEntryRefKey(collection.owner) === contentEntryRefKey(ref) && collection.fieldId === fieldId)) fail("forbidden", "Use the declared collection operation to change ordering.");
			const next = Object.hasOwn(values, fieldId) ? values[fieldId] : void 0;
			assertFieldChange(field, permission.fields.find((item) => item.fieldId === fieldId) ?? fail("forbidden", `Field ${fieldId} is outside the hosted policy.`), entry.values[fieldId], next, options.policy, fieldId, options.validateMarkdown);
			if (next === void 0) delete entry.values[fieldId];
			else entry.values[fieldId] = copy(next);
		}
		entry.generation += 1;
		entry.updatedAt = options.now();
	}
	function changeCollection(providers, command) {
		const collection = options.policy.collections.find((item) => item.id === command.collectionId) ?? fail("forbidden", "Collection is outside the hosted policy.");
		const refs = copy(membership(providers, collection));
		let created;
		if (command.kind === "reorder") {
			if (!collection.reorder) fail("forbidden", "Collection does not permit reorder.");
			const before = refs.map(contentEntryRefKey).sort(), after = command.entries.map(contentEntryRefKey).sort();
			if (!sameValue(before, after) || new Set(after).size !== after.length) fail("invalid-value", "Reorder must preserve exact collection membership.");
			refs.splice(0, refs.length, ...copy(command.entries));
		} else {
			if (command.kind === "create-entry" ? !collection.create : !collection.add) fail("forbidden", "Collection does not permit this operation.");
			if (refs.length >= collection.maxItems) fail("invalid-value", "Collection has reached its limit.");
			let ref;
			if (command.kind === "create-entry") {
				const provider = providers.find((item) => item.providerId === collection.target.providerId) ?? fail("not-found", "Collection provider is unavailable.");
				const model = provider.models.find((item) => item.id === collection.target.modelId);
				if (!model || model.document.kind !== "collection") fail("configuration-required", "Creation requires a collection Content model.");
				const id = options.createId();
				if (provider.entries.some((entry) => entry.id === id)) fail("configuration-required", "Host ID factory returned an existing entry identity.");
				ref = {
					...collection.target,
					recordId: id
				};
				provider.entries.push(createContentEntryRecord(ref.modelId, collection.initialValues, {
					id,
					timestamp: options.now()
				}));
				setFields(providers, ref, command.values, [], true);
				created = ref;
			} else {
				ref = command.entry;
				if (ref.providerId !== collection.target.providerId || ref.modelId !== collection.target.modelId || !permitted(providers, ref)) fail("forbidden", "Entry is outside the permitted collection target.");
				findEntry(providers, ref);
			}
			if (refs.some((item) => contentEntryRefKey(item) === contentEntryRefKey(ref))) fail("invalid-value", "Entry is already a collection member.");
			const index = command.before === null ? refs.length : refs.findIndex((item) => contentEntryRefKey(item) === contentEntryRefKey(command.before));
			if (index < 0) fail("invalid-value", "Placement must name an existing collection member.");
			refs.splice(index, 0, copy(ref));
		}
		const owner = findEntry(providers, collection.owner);
		owner.values[collection.fieldId] = refs;
		owner.generation += 1;
		owner.updatedAt = options.now();
		return created;
	}
	function assertDefinitions(head) {
		if (head.state.providers.length !== head.baselineProviders.length) fail("configuration-required", "Working providers differ from the canonical baseline.");
		for (const provider of head.state.providers) {
			const baseline = head.baselineProviders.find((item) => item.providerId === provider.providerId);
			if (!baseline || !sameValue(provider.models, baseline.models)) fail("configuration-required", "Working model definitions differ from the canonical baseline.");
		}
	}
	function deliveryProviders(head) {
		const providers = copy(head.baselineProviders);
		for (const current of head.state.providers) {
			const baseline = providers.find((provider) => provider.providerId === current.providerId);
			if (!baseline || !sameValue(baseline.models, current.models)) fail("configuration-required", "Working model definitions differ from the canonical baseline.");
			for (const entry of current.entries) {
				const ref = {
					providerId: current.providerId,
					modelId: entry.modelId,
					recordId: entry.id
				};
				if (!visible(head.state.providers, ref)) continue;
				const delivered = {
					...copy(entry),
					lifecycle: "published"
				};
				const index = baseline.entries.findIndex((item) => item.id === entry.id);
				if (index < 0) baseline.entries.push(delivered);
				else baseline.entries[index] = delivered;
			}
		}
		return providers;
	}
	function receipt(existing, fingerprint) {
		if (!existing) return;
		if (existing.fingerprint !== fingerprint) fail("operation-key-reuse", "Operation key is already bound to another immutable request.");
		return copy(existing.result);
	}
	/** Working fields that differ from the stored canonical baseline, i.e. the retained draft. */
	function authoredChanges(head) {
		return head.state.providers.flatMap((working) => working.entries.flatMap((entry) => {
			const ref = {
				providerId: working.providerId,
				modelId: entry.modelId,
				recordId: entry.id
			};
			const base = head.baselineProviders.find((provider) => provider.providerId === ref.providerId)?.entries.find((item) => item.id === entry.id && item.modelId === entry.modelId);
			const fieldIds = [.../* @__PURE__ */ new Set([...Object.keys(entry.values), ...Object.keys(base?.values ?? {})])].filter((fieldId) => !sameValue(entry.values[fieldId], base?.values[fieldId]));
			return fieldIds.length ? [{
				ref,
				entry,
				base,
				fieldIds
			}] : [];
		}));
	}
	/** Carry each retained change onto new canonical content only where it still validates; report every drop. */
	function rebaseDraft(head, canonical) {
		const providers = copy(canonical), carried = [], dropped = [], createdRefs = [];
		for (const { ref, entry, base, fieldIds } of authoredChanges(head)) {
			const drop = (reason, ids = fieldIds) => {
				for (const fieldId of ids) dropped.push({
					entry: ref,
					fieldId,
					reason
				});
			};
			const provider = providers.find((item) => item.providerId === ref.providerId);
			const model = provider?.models.find((item) => item.id === ref.modelId);
			let target = provider?.entries.find((item) => item.id === entry.id && item.modelId === entry.modelId);
			if (!provider || !model) {
				drop("model-removed");
				continue;
			}
			if (base && !target) {
				drop("entry-removed");
				continue;
			}
			if (!base && !target && !options.policy.collections.some((collection) => collection.target.providerId === ref.providerId && collection.target.modelId === ref.modelId)) {
				drop("forbidden");
				continue;
			}
			const created = !target;
			target ??= {
				...copy(entry),
				values: {}
			};
			let applied = false;
			for (const fieldId of fieldIds) {
				const field = model.document.fields.find((item) => item.id === fieldId), next = entry.values[fieldId];
				const owned = options.policy.collections.some((collection) => contentEntryRefKey(collection.owner) === contentEntryRefKey(ref) && collection.fieldId === fieldId);
				if (!field) drop("field-removed", [fieldId]);
				else if (base ? !sameValue(target.values[fieldId], base.values[fieldId]) : !created && !sameValue(target.values[fieldId], next)) drop("canonical-changed", [fieldId]);
				else if (!owned && !options.policy.models.some((allowed) => allowed.providerId === ref.providerId && allowed.modelId === ref.modelId && allowed.fields.some((permission) => permission.fieldId === fieldId))) drop("forbidden", [fieldId]);
				else if (next !== void 0 && !isValueValidForField(field, next)) drop("invalid-value", [fieldId]);
				else {
					if (next === void 0) delete target.values[fieldId];
					else target.values[fieldId] = copy(next);
					carried.push({
						entry: ref,
						fieldId
					});
					applied = true;
				}
			}
			if (!applied) continue;
			if (created) {
				provider.entries.push(target);
				createdRefs.push(ref);
			}
			target.generation = Math.max(target.generation, entry.generation) + 1;
			target.updatedAt = options.now();
		}
		for (const ref of createdRefs) {
			if (permitted(providers, ref)) continue;
			const provider = providers.find((item) => item.providerId === ref.providerId);
			provider.entries = provider.entries.filter((entry) => !(entry.id === ref.recordId && entry.modelId === ref.modelId));
			const orphaned = carried.filter((change) => contentEntryRefKey(change.entry) === contentEntryRefKey(ref));
			carried.splice(0, carried.length, ...carried.filter((change) => !orphaned.includes(change)));
			dropped.push(...orphaned.map((change) => ({
				...change,
				reason: "canonical-changed"
			})));
		}
		return {
			providers,
			carried,
			dropped
		};
	}
	/**
	* The revisions one commit appends: an `initial` revision of the prior values when an Entry has no history yet,
	* then one revision per changed Entry. The head CAS and the (entry, sequence) uniqueness both refuse a racing append.
	*/
	async function revisionsFor(head, after, definition, actor, operation, restoredFrom) {
		const revisions = [], source = options.source ?? "hosted-content", createdAt = options.now();
		for (const { entry, previous, next } of changedEntries(head.state.providers, after)) {
			let parent = (await options.storage.listRevisions(entry, { limit: 1 }))[0] ?? null;
			if (!parent && previous) {
				parent = {
					id: options.createId(),
					entry: copy(entry),
					sequence: 1,
					parentId: null,
					values: copy(previous.values),
					definition: head.state.definition,
					createdAt,
					actor: null,
					source,
					operation: {
						kind: "initial",
						key: null
					}
				};
				revisions.push(parent);
			}
			revisions.push({
				id: options.createId(),
				entry: copy(entry),
				sequence: (parent?.sequence ?? 0) + 1,
				parentId: parent?.id ?? null,
				values: copy(next.values),
				definition,
				createdAt,
				actor: actor ? { id: actor.id } : null,
				source,
				operation,
				...restoredFrom ? { restoredFrom } : {}
			});
		}
		for (const revision of revisions) if (await options.storage.readRevision(revision.id)) fail("configuration-required", "Host ID factory returned an existing revision identity.");
		return revisions;
	}
	/** Apply a revision's values as ordinary validated field changes, or refuse with every incompatibility. */
	function restoreValues(providers, target, values) {
		if (!permitted(providers, target)) fail("forbidden", "Entry is outside the hosted policy.");
		const permission = modelPermission(target), entry = findEntry(providers, target);
		const model = providers.find((provider) => provider.providerId === target.providerId)?.models.find((item) => item.id === target.modelId) ?? fail("not-found", "Entry model is unavailable.");
		const diagnostics = [], set = {}, clear = [];
		const diagnose = (fieldId, code, message) => diagnostics.push({
			entry: copy(target),
			fieldId,
			code,
			message
		});
		for (const fieldId of [.../* @__PURE__ */ new Set([...Object.keys(entry.values), ...Object.keys(values)])].sort()) {
			const previous = entry.values[fieldId], next = Object.hasOwn(values, fieldId) ? values[fieldId] : void 0;
			if (sameValue(previous, next)) continue;
			const field = model.document.fields.find((item) => item.id === fieldId);
			if (!field) {
				diagnose(fieldId, "field-removed", "The current definition no longer has this field.");
				continue;
			}
			if (options.policy.collections.some((collection) => contentEntryRefKey(collection.owner) === contentEntryRefKey(target) && collection.fieldId === fieldId)) {
				diagnose(fieldId, "collection-owned", "Collection membership changes only through its collection operation.");
				continue;
			}
			try {
				assertFieldChange(field, permission.fields.find((item) => item.fieldId === fieldId), previous, next, options.policy, fieldId, options.validateMarkdown);
			} catch (error) {
				if (!(error instanceof HostedContentError)) throw error;
				diagnose(fieldId, error.code === "forbidden" ? "forbidden" : "invalid-value", error.message);
				continue;
			}
			if (next === void 0) clear.push(fieldId);
			else set[fieldId] = next;
		}
		if (diagnostics.length) throw new HostedContentError("restore-incompatible", "The revision cannot be restored under the current definition and policy; nothing was written.", void 0, diagnostics);
		if (Object.keys(set).length || clear.length) setFields(providers, target, set, clear);
	}
	function entryView(head, perspective, entry, target, revisionId) {
		return copy({
			entry: target,
			perspective,
			status: editorialStatus(head, target),
			lifecycle: entry.lifecycle,
			generation: entry.generation,
			updatedAt: entry.updatedAt,
			values: entry.values,
			revisionId
		});
	}
	const perspectiveProviders = (head, perspective) => perspective === "working" ? head.state.providers : head.baselineProviders;
	/** Current read permissions apply to every perspective and to historical data. */
	function assertReadable(head, target) {
		if (!visible(head.state.providers, target)) fail("forbidden", "Entry is outside the hosted policy.");
	}
	async function readRevisionFor(target, revisionId) {
		const revision = await options.storage.readRevision(revisionId);
		if (!revision || contentEntryRefKey(revision.entry) !== contentEntryRefKey(target)) fail("not-found", "Revision is unavailable.");
		return revision;
	}
	async function targetValues(head, target, at) {
		if ("revisionId" in at) return (await readRevisionFor(target, at.revisionId)).values;
		return lookup(perspectiveProviders(head, at.perspective), target)?.values ?? {};
	}
	/** Prepare from detached reads, then commit conditionally; a refused commit is retried from fresh reads. */
	async function mutate(work) {
		for (let attempt = 0; attempt < commitAttempts; attempt++) {
			const head = copy(await options.storage.readHead());
			const { value, write } = await work(copy(head));
			if (!write) return copy(value);
			if (await options.storage.commit(copy({
				...write,
				expectedVersion: head.version,
				head: {
					...write.head,
					version: options.createId()
				}
			}))) return copy(value);
		}
		return fail("unavailable", "Storage kept refusing the commit; nothing was written. Retry the same request.");
	}
	async function readSnapshot(snapshotId) {
		return await options.storage.readSnapshot(snapshotId) ?? fail("not-found", "Snapshot is unavailable.");
	}
	async function readPublication(publicationId) {
		return await options.storage.readPublication(publicationId) ?? fail("not-found", "Publication is unavailable.");
	}
	return {
		async readState(actor) {
			await authorize(actor);
			return publicState((await options.storage.readHead()).state);
		},
		async listModels(actor) {
			await authorize(actor);
			const head = await options.storage.readHead();
			return copy(publicProviders(head.state.providers).flatMap((provider) => provider.models.map((model) => ({
				providerId: provider.providerId,
				model,
				workingEntries: provider.entries.filter((entry) => entry.modelId === model.id).length,
				publishedEntries: head.baselineProviders.find((item) => item.providerId === provider.providerId)?.entries.filter((entry) => entry.modelId === model.id && visible(head.state.providers, ref(provider.providerId, entry))).length ?? 0
			}))));
		},
		async listEntries(actor, request) {
			const query = parseHostedQuery("entries", request);
			await authorize(actor);
			const head = await options.storage.readHead(), limit = query.limit ?? defaultPageSize;
			const entries = (perspectiveProviders(head, query.perspective).find((provider) => provider.providerId === query.providerId)?.entries ?? []).filter((entry) => entry.modelId === query.modelId && visible(head.state.providers, ref(query.providerId, entry)) && (query.cursor === void 0 || entry.id > query.cursor)).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
			const page = entries.slice(0, limit);
			return {
				entries: await Promise.all(page.map(async (entry) => entryView(head, query.perspective, entry, ref(query.providerId, entry), (await options.storage.listRevisions(ref(query.providerId, entry), { limit: 1 }))[0]?.id ?? null))),
				nextCursor: entries.length > limit ? page.at(-1).id : null
			};
		},
		async readEntry(actor, request) {
			const query = parseHostedQuery("entry", request);
			await authorize(actor);
			const head = await options.storage.readHead();
			assertReadable(head, query.entry);
			const entry = lookup(perspectiveProviders(head, query.perspective), query.entry) ?? fail("not-found", `Entry has no ${query.perspective} version.`);
			return entryView(head, query.perspective, entry, query.entry, (await options.storage.listRevisions(query.entry, { limit: 1 }))[0]?.id ?? null);
		},
		async listRevisions(actor, request) {
			const query = parseHostedQuery("revisions", request);
			await authorize(actor);
			assertReadable(await options.storage.readHead(), query.entry);
			const limit = query.limit ?? defaultPageSize, beforeSequence = parseCursor(query.cursor);
			const revisions = await options.storage.listRevisions(query.entry, {
				...beforeSequence ? { beforeSequence } : {},
				limit: limit + 1
			});
			const page = revisions.slice(0, limit);
			return copy({
				revisions: page,
				nextCursor: revisions.length > limit ? String(page.at(-1).sequence) : null
			});
		},
		async readRevision(actor, request) {
			const revisionId = parseHostedQuery("revision", request);
			await authorize(actor);
			const head = await options.storage.readHead(), revision = await options.storage.readRevision(revisionId);
			if (!revision || !visible(head.state.providers, revision.entry)) fail("not-found", "Revision is unavailable.");
			return copy(revision);
		},
		async compareRevisions(actor, request) {
			const query = parseHostedQuery("compare", request);
			await authorize(actor);
			const head = await options.storage.readHead();
			assertReadable(head, query.entry);
			const [before, after] = [await targetValues(head, query.entry, query.from), await targetValues(head, query.entry, query.to)];
			const fields = head.state.providers.find((provider) => provider.providerId === query.entry.providerId)?.models.find((model) => model.id === query.entry.modelId)?.document.fields ?? [];
			const known = new Set(fields.map((field) => field.id));
			const removed = [.../* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])].filter((fieldId) => !known.has(fieldId)).sort();
			const differences = [...fields.map((field) => ({
				fieldId: field.id,
				key: field.key,
				label: field.label,
				removedFromDefinition: false
			})), ...removed.map((fieldId) => ({
				fieldId,
				key: fieldId,
				label: fieldId,
				removedFromDefinition: true
			}))].flatMap((field) => {
				const previous = before[field.fieldId], next = after[field.fieldId];
				if (sameValue(previous, next)) return [];
				return [{
					...field,
					change: previous === void 0 ? "added" : next === void 0 ? "removed" : "changed",
					...previous !== void 0 ? { before: previous } : {},
					...next !== void 0 ? { after: next } : {}
				}];
			});
			return copy({
				entry: query.entry,
				from: query.from,
				to: query.to,
				differences
			});
		},
		async readPublicationStatus(actor) {
			await authorize(actor);
			const head = await options.storage.readHead();
			const publication = head.activePublicationId ? await options.storage.readPublication(head.activePublicationId) : null;
			return copy({
				activated: {
					baseline: head.state.baseline,
					definition: head.state.definition,
					integrationFence: head.state.integrationFence
				},
				submission: publication ? {
					publicationId: publication.id,
					snapshotId: publication.snapshotId,
					status: publication.status,
					statusVersion: publication.statusVersion,
					...publication.message !== void 0 ? { message: publication.message } : {}
				} : null,
				artifact: publication?.facts?.artifact ?? null,
				deployed: publication?.status === "deployed"
			});
		},
		async readReceipt(actor, operationKey) {
			const trusted = copy(actor);
			await authorize(trusted);
			return copy(await options.storage.readReceipt(trusted.id, operationKey));
		},
		async readSnapshot(actor, snapshotId) {
			await authorize(actor);
			return publicSnapshot(await readSnapshot(snapshotId));
		},
		async getPublication(actor, publicationId) {
			await authorize(actor);
			return copy(await readPublication(publicationId));
		},
		async execute(actor, request) {
			const command = parseHostedCommand(request);
			const authenticated = copy(actor);
			await authorize(authenticated);
			const actorId = authenticated.id;
			const fingerprint = await options.digest(canonicalSerialize({
				siteId: options.siteId,
				actorId,
				command
			}));
			return mutate(async (head) => {
				const replay = receipt(await options.storage.readReceipt(actorId, command.operationKey), fingerprint);
				if (replay) return { value: replay };
				checkExpected(head.state, command.expected);
				assertDefinitions(head);
				const before = copy(head.state.providers);
				let restoredFrom;
				let createdEntry, snapshot, captured, publication;
				switch (command.kind) {
					case "set-fields":
						setFields(head.state.providers, command.entry, command.values, command.clear);
						break;
					case "create-entry":
					case "add-entry":
					case "reorder":
						createdEntry = changeCollection(head.state.providers, command);
						break;
					case "restore-revision": {
						const revision = await readRevisionFor(command.entry, command.revisionId);
						restoreValues(head.state.providers, command.entry, revision.values);
						restoredFrom = revision.id;
						break;
					}
					case "capture-snapshot": {
						const providers = deliveryProviders(head), assets = copy(options.policy.assets), diagnostics = checkGraph(providers);
						const renderData = copy(await options.project(copy(providers), copy(assets)));
						const digest = await options.digest(canonicalSerialize({
							providers,
							assets,
							renderData
						}));
						snapshot = captured = {
							...identity(head.state),
							id: options.createId(),
							digest,
							providers,
							assets,
							diagnostics,
							renderData
						};
						if (await options.storage.readSnapshot(captured.id)) fail("configuration-required", "Host ID factory returned an existing snapshot identity.");
						break;
					}
					case "begin-publication": {
						snapshot = await readSnapshot(command.snapshotId);
						checkExpected(head.state, snapshot);
						const active = head.activePublicationId ? await options.storage.readPublication(head.activePublicationId) : null;
						if (active && !terminal(active)) fail("publication-busy", "A publication is already active; recover its authoritative status.");
						if (snapshot.diagnostics.length) throw new HostedContentError("incomplete", "Complete required and accessible values before submission.", publicSnapshot(snapshot).diagnostics);
						await options.validateSubmission(copy(snapshot));
						publication = {
							id: options.createId(),
							snapshotId: snapshot.id,
							expectedBaseline: copy(snapshot.baseline),
							status: "submitted",
							lastProvenStatus: "submitted",
							statusVersion: 1
						};
						if (await options.storage.readPublication(publication.id)) fail("configuration-required", "Host ID factory returned an existing publication identity.");
						head.activePublicationId = publication.id;
						break;
					}
				}
				let revisions = [];
				if (command.kind !== "capture-snapshot" && command.kind !== "begin-publication") {
					revisions = await revisionsFor({
						...head,
						state: {
							...head.state,
							providers: before
						}
					}, head.state.providers, head.state.definition, authenticated, {
						kind: command.kind,
						key: command.operationKey
					}, restoredFrom);
					if (!revisions.length) head.state.providers = before;
					else {
						checkGraph(head.state.providers);
						head.state.draftRevision = options.createId();
					}
				}
				const result = {
					state: publicState(head.state),
					...createdEntry ? { createdEntry } : {},
					...snapshot ? { snapshot: publicSnapshot(snapshot) } : {},
					...publication ? { publication: copy(publication) } : {}
				};
				return {
					value: result,
					write: {
						head,
						receipt: {
							actorId,
							operationKey: command.operationKey,
							fingerprint,
							result: copy(result)
						},
						...captured ? { snapshot: captured } : {},
						...publication ? { publication } : {},
						...revisions.length ? { revisions } : {}
					}
				};
			});
		},
		async recordStatus(evidence) {
			const input = copy(evidence);
			if (!Number.isSafeInteger(input.statusVersion) || input.statusVersion < 1 || ![
				"submitted",
				"building",
				"verified",
				"integrated",
				"deployed",
				"failed",
				"conflict",
				"unavailable"
			].includes(input.status)) fail("invalid-request", "Malformed host status evidence.");
			return mutate(async (head) => {
				const publication = await readPublication(input.publicationId);
				if (publication.snapshotId !== input.snapshotId) fail("invalid-request", "Status evidence names a different snapshot.");
				if (input.statusVersion <= publication.statusVersion) return { value: publication };
				if ((input.status === "integrated" || input.status === "deployed") && publication.integratedFence === void 0) fail("invalid-request", "Confirmed integration evidence is required first.");
				if (terminal(publication) && !(publication.status === "integrated" && input.status === "deployed")) return { value: publication };
				if ((rank[input.status] ?? Infinity) < (rank[publication.lastProvenStatus ?? publication.status] ?? -1)) return { value: publication };
				publication.status = input.status;
				if (input.status === "submitted" || input.status === "building" || input.status === "verified" || input.status === "integrated" || input.status === "deployed") publication.lastProvenStatus = input.status;
				publication.statusVersion = input.statusVersion;
				if (input.message !== void 0) publication.message = input.message;
				if (input.facts !== void 0) publication.facts = copy(input.facts);
				return {
					value: publication,
					write: {
						head,
						publication
					}
				};
			});
		},
		async recordConfirmedIntegration(evidence) {
			const input = copy(evidence);
			return mutate(async (head) => {
				const publication = await readPublication(input.publicationId);
				const snapshot = await options.storage.readSnapshot(publication.snapshotId) ?? fail("not-found", "Publication snapshot is unavailable.");
				if (input.snapshotId !== snapshot.id || !sameValue(input.expectedBaseline, publication.expectedBaseline) || input.contentDigest !== snapshot.digest || !input.gitSha) fail("baseline-conflict", "Integration evidence must identify the exact submitted baseline and content.");
				if (publication.integratedFence !== void 0) {
					if (publication.gitSha !== input.gitSha) fail("baseline-conflict", "Publication was integrated at another commit.");
					return { value: publicState(head.state) };
				}
				if (["failed", "conflict"].includes(publication.status)) fail("baseline-conflict", "Terminal publication cannot be reconciled without host recovery.");
				if (head.state.definition !== options.definition) fail("configuration-required", "The hosted definition changed; the host must adopt the canonical baseline first.");
				if (head.state.definition !== snapshot.definition) fail("definition-conflict", "Definition changed before integration.");
				if (!sameValue(head.state.baseline, input.expectedBaseline)) fail("baseline-conflict", "Canonical baseline advanced outside this operation.");
				head.baselineProviders = copy(snapshot.providers);
				for (const provider of head.state.providers) for (const entry of provider.entries) {
					const submitted = snapshot.providers.find((item) => item.providerId === provider.providerId)?.entries.find((item) => item.id === entry.id && item.modelId === entry.modelId);
					if (submitted && submitted.generation === entry.generation && sameValue(submitted.values, entry.values) && entry.lifecycle !== submitted.lifecycle) {
						entry.lifecycle = submitted.lifecycle;
						entry.generation += 1;
					}
				}
				head.state.baseline = {
					gitSha: input.gitSha,
					contentDigest: input.contentDigest
				};
				head.state.integrationFence += 1;
				head.state.draftRevision = options.createId();
				publication.integratedFence = head.state.integrationFence;
				publication.gitSha = input.gitSha;
				publication.status = "integrated";
				publication.lastProvenStatus = "integrated";
				publication.statusVersion += 1;
				return {
					value: publicState(head.state),
					write: {
						head,
						publication
					}
				};
			});
		},
		async adoptCanonicalBaseline(evidence) {
			const input = copy(evidence);
			if (!input || !Array.isArray(input.providers) || !input.baseline?.gitSha || !input.baseline.contentDigest || !input.expected?.baseline || typeof input.expected.definition !== "string" || !["rebase", "discard"].includes(input.draft) || typeof input.apply !== "boolean") fail("invalid-request", "Malformed canonical adoption evidence.");
			return mutate(async (head) => {
				if (!sameValue(head.state.baseline, input.expected.baseline) || head.state.definition !== input.expected.definition) fail("baseline-conflict", "The stored canonical identity changed; read it again before adopting.");
				const active = head.activePublicationId ? await options.storage.readPublication(head.activePublicationId) : null;
				if (active && !terminal(active)) fail("publication-busy", "Record the active publication's outcome before adopting another canonical baseline.");
				try {
					checkGraph(input.providers);
				} catch (error) {
					fail("configuration-required", `Canonical content does not satisfy the hosted definition. ${error instanceof Error ? error.message : ""}`.trim());
				}
				const rebased = input.draft === "rebase" ? rebaseDraft(head, input.providers) : {
					providers: copy(input.providers),
					carried: [],
					dropped: authoredChanges(head).flatMap(({ ref, fieldIds }) => fieldIds.map((fieldId) => ({
						entry: ref,
						fieldId,
						reason: "discarded"
					})))
				};
				checkGraph(rebased.providers);
				const state = {
					draftRevision: options.createId(),
					baseline: copy(input.baseline),
					definition: options.definition,
					integrationFence: head.state.integrationFence + 1,
					providers: rebased.providers
				};
				const value = {
					applied: input.apply,
					state: publicState(state),
					carried: rebased.carried,
					dropped: rebased.dropped
				};
				if (!input.apply) return { value };
				const revisions = await revisionsFor(head, state.providers, state.definition, null, {
					kind: "adopt-canonical-baseline",
					key: null
				});
				head.state = state;
				head.baselineProviders = copy(input.providers);
				return {
					value,
					write: {
						head,
						...revisions.length ? { revisions } : {}
					}
				};
			});
		}
	};
}
//#endregion
export { isValueValidForField as a, isSafeRecordId as c, isPlainObject as d, HostedContentError as f, isContentAssetUse as i, cloneJson as l, canonicalSerialize as n, validateContentEntryRecord as o, buildContentGraphIndex as r, validateContentModelRecord as s, createHostedContentService as t, isJsonSafe as u };
