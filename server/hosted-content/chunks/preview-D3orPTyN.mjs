import { z } from "zod";
//#region src/features/composer/preview/wire.ts
/** Envelope discriminator — keeps Composer traffic off other message buses. */
var COMPOSER_PREVIEW_CHANNEL = "composer-preview";
/** Protocol version. Bump only on a BREAKING envelope change. */
var COMPOSER_PREVIEW_PROTOCOL_VERSION = 2;
var previewEnvelopeSchema = {
	channel: z.literal(COMPOSER_PREVIEW_CHANNEL),
	v: z.literal(2),
	packId: z.string().min(1),
	packVersion: z.string().min(1)
};
function previewEnvelopeValue(pack) {
	return {
		channel: COMPOSER_PREVIEW_CHANNEL,
		v: 2,
		packId: pack.packId,
		packVersion: pack.packVersion
	};
}
/**
* The single security gate. `event.data` is NEVER read, parsed, or coerced
* before the source/origin checks pass and zod has validated it — it is handed
* to `safeParse` as an opaque `unknown` and nothing else.
*/
function guardPreviewMessage(schema, event, expected) {
	if (expected.source == null || event.source !== expected.source) return {
		ok: false,
		reason: "wrong-source"
	};
	if (event.origin !== expected.origin) return {
		ok: false,
		reason: "wrong-origin"
	};
	const parsed = schema.safeParse(event.data);
	if (!parsed.success) return {
		ok: false,
		reason: "invalid-payload",
		detail: parsed.error.message
	};
	const message = parsed.data;
	if (message.packId !== expected.pack.packId || message.packVersion !== expected.pack.packVersion) return {
		ok: false,
		reason: "pack-mismatch",
		detail: `Expected ${expected.pack.packId}@${expected.pack.packVersion}, received ${message.packId}@${message.packVersion}.`
	};
	return {
		ok: true,
		message: parsed.data
	};
}
//#endregion
//#region src/hosted-content/preview.ts
/** Additive hosted-document messages on the existing guarded Composer wire protocol.
* This module is portable: no browser globals or renderer implementations. */
var token = z.string().min(1);
var renderer = {
	rendererId: token,
	rendererVersion: token
};
var envelope = {
	...previewEnvelopeSchema,
	...renderer
};
var jsonObject = z.unknown().superRefine((value, ctx) => {
	if (value === null || typeof value !== "object" || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) ctx.addIssue({
		code: "custom",
		message: "Expected a plain JSON object"
	});
}).pipe(z.lazy(() => z.record(z.string(), json)));
var json = z.lazy(() => z.union([
	z.string(),
	z.number().finite(),
	z.boolean(),
	z.null(),
	z.array(json),
	jsonObject
]));
var renderDataSchema = z.unknown().superRefine((value, ctx) => {
	const active = /* @__PURE__ */ new Set();
	const stack = [{
		value,
		depth: 0
	}];
	while (stack.length) {
		const item = stack.pop();
		if (item.value === null || typeof item.value !== "object") continue;
		if (item.exit) {
			active.delete(item.value);
			continue;
		}
		if (item.depth > 128 || active.has(item.value)) {
			ctx.addIssue({
				code: "custom",
				message: "Render data must be acyclic JSON with bounded nesting"
			});
			return;
		}
		active.add(item.value);
		stack.push({
			...item,
			exit: true
		});
		const array = Array.isArray(item.value);
		for (const key of Reflect.ownKeys(item.value)) {
			if (typeof key !== "string") {
				ctx.addIssue({
					code: "custom",
					message: "Render data cannot contain symbol keys"
				});
				return;
			}
			if (array && key === "length") continue;
			if (array && (!Number.isSafeInteger(Number(key)) || Number(key) < 0 || String(Number(key)) !== key)) {
				ctx.addIssue({
					code: "custom",
					message: "JSON arrays cannot contain named properties"
				});
				return;
			}
			const property = Object.getOwnPropertyDescriptor(item.value, key);
			if (key === "__proto__" || !("value" in property) || !property.enumerable) {
				ctx.addIssue({
					code: "custom",
					message: "Render data cannot contain prototype keys or accessors"
				});
				return;
			}
			stack.push({
				value: property.value,
				depth: item.depth + 1
			});
		}
	}
}).pipe(json);
var hostedPreviewBindingSchema = z.object({
	frameSession: token,
	frameGeneration: z.number().int().nonnegative().safe(),
	requestId: z.number().int().positive().safe(),
	snapshotId: token,
	snapshotDigest: token,
	draftRevision: token,
	baseline: z.object({
		gitSha: token,
		contentDigest: token
	}).strict(),
	definition: token,
	routeId: token
}).strict();
var hostedReadySchema = z.object({
	...envelope,
	type: z.literal("host-ready"),
	frameSession: token
}).strict();
var hostedRenderSchema = z.object({
	...envelope,
	...hostedPreviewBindingSchema.shape,
	type: z.literal("document-render"),
	renderData: renderDataSchema
}).strict();
var hostedRenderedSchema = z.object({
	...envelope,
	...hostedPreviewBindingSchema.shape,
	type: z.literal("document-rendered")
}).strict();
var hostedDocumentErrorSchema = z.object({
	...envelope,
	...hostedPreviewBindingSchema.shape,
	type: z.literal("document-error"),
	code: z.enum([
		"render-failed",
		"missing-dependency",
		"unsupported-route",
		"invalid-document"
	]),
	message: token
}).strict();
var hostedPreviewResponseSchema = z.discriminatedUnion("type", [
	hostedReadySchema,
	hostedRenderedSchema,
	hostedDocumentErrorSchema
]);
function read(schema, event, expected) {
	const result = guardPreviewMessage(schema, event, expected);
	if (!result.ok) return result;
	if (result.message.rendererId !== expected.renderer.rendererId || result.message.rendererVersion !== expected.renderer.rendererVersion) return {
		ok: false,
		reason: "renderer-mismatch",
		detail: "Preview renderer identity does not match"
	};
	return result;
}
function readHostedPreviewRequest(event, expected) {
	return read(hostedRenderSchema, event, expected);
}
function readHostedPreviewResponse(event, expected) {
	return read(hostedPreviewResponseSchema, event, expected);
}
function hostedReadyMessage(pack, identity, frameSession) {
	return hostedReadySchema.parse({
		...previewEnvelopeValue(pack),
		...identity,
		type: "host-ready",
		frameSession
	});
}
function hostedRenderMessage(pack, identity, binding, renderData) {
	return hostedRenderSchema.parse({
		...previewEnvelopeValue(pack),
		...identity,
		...binding,
		type: "document-render",
		renderData
	});
}
function hostedRenderedMessage(request) {
	const { renderData, ...rest } = request;
	return hostedRenderedSchema.parse({
		...rest,
		type: "document-rendered"
	});
}
function hostedDocumentErrorMessage(request, code, message) {
	const { renderData, ...rest } = request;
	return hostedDocumentErrorSchema.parse({
		...rest,
		type: "document-error",
		code,
		message
	});
}
/** Result binding equality deliberately covers every identity, never only request ID. */
function matchesHostedPreviewBinding(a, b) {
	return a.frameSession === b.frameSession && a.frameGeneration === b.frameGeneration && a.requestId === b.requestId && a.snapshotId === b.snapshotId && a.snapshotDigest === b.snapshotDigest && a.draftRevision === b.draftRevision && a.baseline.gitSha === b.baseline.gitSha && a.baseline.contentDigest === b.baseline.contentDigest && a.definition === b.definition && a.routeId === b.routeId;
}
//#endregion
export { hostedReadyMessage as a, hostedRenderSchema as c, matchesHostedPreviewBinding as d, readHostedPreviewRequest as f, COMPOSER_PREVIEW_PROTOCOL_VERSION as h, hostedPreviewResponseSchema as i, hostedRenderedMessage as l, COMPOSER_PREVIEW_CHANNEL as m, hostedDocumentErrorSchema as n, hostedReadySchema as o, readHostedPreviewResponse as p, hostedPreviewBindingSchema as r, hostedRenderMessage as s, hostedDocumentErrorMessage as t, hostedRenderedSchema as u };
