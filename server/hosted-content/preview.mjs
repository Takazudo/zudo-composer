import { a as hostedReadyMessage, d as matchesHostedPreviewBinding, f as readHostedPreviewRequest, l as hostedRenderedMessage, p as readHostedPreviewResponse, s as hostedRenderMessage, t as hostedDocumentErrorMessage } from "./chunks/preview-D3orPTyN.mjs";
//#region src/hosted-content/preview-browser.ts
/** Preview URL is host configuration. Editable content never selects it. */
function buildHostedPreviewLocation(previewUrl, documentOrigin) {
	const parent = new URL(documentOrigin);
	const preview = new URL(previewUrl, parent);
	if (!["http:", "https:"].includes(parent.protocol) || preview.origin !== parent.origin || preview.username || preview.password) throw new Error("Preview requires a same-origin HTTP(S) host URL");
	return {
		src: preview.href,
		targetOrigin: preview.origin
	};
}
var HostedPreviewError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "HostedPreviewError";
	}
};
function createHostedPreviewController(options) {
	const documentOrigin = options.documentOrigin ?? globalThis.location?.origin;
	if (!documentOrigin) throw new Error("Preview controller requires the hosting document origin");
	const location = buildHostedPreviewLocation(options.location.src, documentOrigin);
	if (location.targetOrigin !== options.location.targetOrigin) throw new Error("Preview target origin does not match its host URL");
	const timeoutMs = options.timeoutMs ?? 1e4;
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Preview timeout must be positive and finite");
	let state = { status: "idle" };
	let retained = null;
	let timer;
	let session = null;
	let generation = 0;
	let sequence = 0;
	let disposed = false;
	let terminal = false;
	const retired = /* @__PURE__ */ new Set();
	const subscribers = /* @__PURE__ */ new Set();
	const publish = (next) => {
		state = next;
		options.onState?.(next);
		for (const listener of subscribers) listener(next);
	};
	const clearTimer = () => {
		if (timer !== void 0) clearTimeout(timer);
		timer = void 0;
	};
	const rejectPending = (error) => {
		clearTimer();
		const reject = retained?.reject;
		if (retained) {
			retained.reject = void 0;
			retained.resolve = void 0;
		}
		reject?.(error);
	};
	const fail = (error) => {
		rejectPending(error);
		retained = null;
		publish({
			status: "error",
			error
		});
	};
	const arm = () => {
		clearTimer();
		timer = setTimeout(() => fail(new HostedPreviewError("timeout", "Preview did not finish within the configured timeout")), timeoutMs);
	};
	const send = () => {
		if (!session || !retained || disposed || terminal) return;
		const snapshot = retained.snapshot;
		retained.request = hostedRenderMessage(options.pack, options.renderer, {
			frameSession: session,
			frameGeneration: generation,
			requestId: ++sequence,
			snapshotId: snapshot.id,
			snapshotDigest: snapshot.digest,
			draftRevision: snapshot.draftRevision,
			baseline: snapshot.baseline,
			definition: snapshot.definition,
			routeId: retained.routeId
		}, snapshot.renderData);
		publish({
			status: "pending",
			snapshotId: snapshot.id,
			routeId: retained.routeId
		});
		arm();
		try {
			options.frame.contentWindow?.postMessage(retained.request, location.targetOrigin);
		} catch {
			fail(new HostedPreviewError("transport-error", "Preview message could not be delivered"));
		}
	};
	const onMessage = (event) => {
		if (disposed || terminal) return;
		const result = readHostedPreviewResponse(event, {
			source: options.frame.contentWindow,
			origin: location.targetOrigin,
			pack: options.pack,
			renderer: options.renderer
		});
		if (!result.ok) {
			options.onRejected?.(result.reason, result.detail);
			if (result.reason === "pack-mismatch" || result.reason === "renderer-mismatch") {
				terminal = true;
				fail(new HostedPreviewError("identity-mismatch", result.detail ?? "Preview identity does not match"));
			}
			return;
		}
		const message = result.message;
		if (message.type === "host-ready") {
			if (message.frameSession === session || retired.has(message.frameSession)) return;
			if (session) retired.add(session);
			session = message.frameSession;
			++generation;
			send();
			return;
		}
		if (!retained?.request || !matchesHostedPreviewBinding(message, retained.request)) return;
		if (message.type === "document-error") {
			fail(new HostedPreviewError(message.code, message.message));
			return;
		}
		const resolve = retained.resolve;
		retained.resolve = void 0;
		retained.reject = void 0;
		retained.request = null;
		clearTimer();
		publish({
			status: "rendered",
			result: message
		});
		resolve?.(message);
	};
	const onLoad = () => {
		if (disposed || terminal) return;
		++generation;
		if (retained) {
			retained.request = null;
			publish({
				status: "pending",
				snapshotId: retained.snapshot.id,
				routeId: retained.routeId
			});
			arm();
			send();
		}
	};
	options.hostWindow.addEventListener("message", onMessage);
	options.frame.addEventListener?.("load", onLoad);
	return {
		get state() {
			return state;
		},
		subscribe(listener) {
			if (!disposed) subscribers.add(listener);
			listener(state);
			return () => {
				subscribers.delete(listener);
			};
		},
		render(snapshot, routeId) {
			if (disposed || terminal) return Promise.reject(new HostedPreviewError(disposed ? "disposed" : "identity-mismatch", "Preview connection is unavailable"));
			let detached;
			try {
				detached = hostedRenderMessage(options.pack, options.renderer, {
					frameSession: session ?? "awaiting-host",
					frameGeneration: generation,
					requestId: sequence + 1,
					snapshotId: snapshot.id,
					snapshotDigest: snapshot.digest,
					draftRevision: snapshot.draftRevision,
					baseline: snapshot.baseline,
					definition: snapshot.definition,
					routeId
				}, snapshot.renderData);
			} catch (error) {
				return Promise.reject(error);
			}
			rejectPending(new HostedPreviewError("superseded", "A newer preview request replaced this request"));
			return new Promise((resolve, reject) => {
				retained = {
					snapshot: {
						id: detached.snapshotId,
						digest: detached.snapshotDigest,
						draftRevision: detached.draftRevision,
						baseline: detached.baseline,
						definition: detached.definition,
						renderData: detached.renderData
					},
					routeId,
					request: null,
					resolve,
					reject
				};
				publish({
					status: "pending",
					snapshotId: snapshot.id,
					routeId
				});
				arm();
				send();
			});
		},
		invalidate() {
			if (disposed) return;
			rejectPending(new HostedPreviewError("superseded", "The draft changed after preview was requested"));
			retained = null;
			publish({ status: "stale" });
		},
		reload() {
			if (disposed || terminal) return;
			if (session) retired.add(session);
			session = null;
			++generation;
			if (retained) {
				retained.request = null;
				publish({
					status: "pending",
					snapshotId: retained.snapshot.id,
					routeId: retained.routeId
				});
				arm();
			} else publish({ status: "idle" });
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			options.hostWindow.removeEventListener("message", onMessage);
			options.frame.removeEventListener?.("load", onLoad);
			rejectPending(new HostedPreviewError("disposed", "Preview connection was disposed"));
			retained = null;
			publish({ status: "disposed" });
			subscribers.clear();
		}
	};
}
/** No framework dependency: a host mounts its own real renderer and styles. */
function createHostedPreviewHost(options) {
	const location = buildHostedPreviewLocation(options.origin, options.origin);
	const ready = hostedReadyMessage(options.pack, options.renderer, options.frameSession);
	let disposed = false;
	let current = null;
	let abort = null;
	const post = (message) => {
		try {
			options.parent.postMessage(message, location.targetOrigin);
		} catch {}
	};
	const onMessage = (event) => {
		if (disposed) return;
		const result = readHostedPreviewRequest(event, {
			source: options.parent,
			origin: location.targetOrigin,
			pack: options.pack,
			renderer: options.renderer
		});
		if (!result.ok) {
			options.onRejected?.(result.reason, result.detail);
			return;
		}
		const request = result.message;
		if (request.frameSession !== options.frameSession) return;
		if (current && (request.frameGeneration < current.frameGeneration || request.requestId <= current.requestId)) return;
		abort?.abort();
		const taskAbort = new AbortController();
		abort = taskAbort;
		current = request;
		const isCurrent = () => !disposed && current === request && !taskAbort.signal.aborted;
		Promise.resolve().then(async () => {
			if (!isCurrent()) return;
			try {
				await options.render(request, {
					signal: taskAbort.signal,
					isCurrent
				});
				if (isCurrent()) post(hostedRenderedMessage(request));
			} catch (error) {
				if (!isCurrent()) return;
				const code = error instanceof HostedPreviewError && [
					"missing-dependency",
					"unsupported-route",
					"invalid-document"
				].includes(error.code) ? error.code : "render-failed";
				post(hostedDocumentErrorMessage(request, code, error instanceof Error && error.message ? error.message : "Visitor document could not be rendered"));
			}
		});
	};
	options.hostWindow.addEventListener("message", onMessage);
	return {
		ready() {
			if (!disposed) post(ready);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			abort?.abort();
			current = null;
			options.hostWindow.removeEventListener("message", onMessage);
		}
	};
}
/** Fullscreen presentation retains the same iframe and never touches its src.
* The host owns dialog/layout; this helper owns the trigger focus contract. */
function createHostedPreviewFullscreen(options) {
	let trigger = null;
	let disposed = false;
	const close = () => {
		if (!trigger) return;
		const restore = trigger;
		trigger = null;
		try {
			options.hide();
		} finally {
			restore.focus();
		}
	};
	return {
		open(next) {
			if (disposed || trigger) return;
			trigger = next;
			options.show();
		},
		close,
		dispose() {
			if (disposed) return;
			disposed = true;
			close();
		}
	};
}
//#endregion
export { HostedPreviewError, buildHostedPreviewLocation, createHostedPreviewController, createHostedPreviewFullscreen, createHostedPreviewHost };
