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
export { CONTENT_FIELD_KINDS as i, createContentEntryRecord as n, diagnoseContentEntryCompleteness as r, canonicalSerialize as t };
