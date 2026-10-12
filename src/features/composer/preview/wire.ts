import { z } from "zod";

/** Envelope discriminator — keeps Composer traffic off other message buses. */
export const COMPOSER_PREVIEW_CHANNEL = "composer-preview" as const;

/** Protocol version. Bump only on a BREAKING envelope change. */
export const COMPOSER_PREVIEW_PROTOCOL_VERSION = 2 as const;

export interface PreviewPackIdentity {
  readonly packId: string;
  readonly packVersion: string;
}

export const previewEnvelopeSchema = {
  channel: z.literal(COMPOSER_PREVIEW_CHANNEL),
  v: z.literal(COMPOSER_PREVIEW_PROTOCOL_VERSION),
  packId: z.string().min(1),
  packVersion: z.string().min(1),
} as const;

export function previewEnvelopeValue(pack: PreviewPackIdentity) {
  return { channel: COMPOSER_PREVIEW_CHANNEL, v: COMPOSER_PREVIEW_PROTOCOL_VERSION,
    packId: pack.packId, packVersion: pack.packVersion } as const;
}

// ── Structural window/message types ─────────────────────────────────────────
//
// Structural (not `Window`/`MessageEvent`) so both sides can be unit-tested
// against plain fakes, and so a caller cannot accidentally hand the bridge a
// window it does not actually intend to talk to.

/** The three fields of a `MessageEvent` this protocol is allowed to look at. */
export interface MessageEventLike {
  readonly data: unknown;
  readonly origin: string;
  readonly source: unknown;
}

/** Anything that can receive an exact-origin `postMessage`. */
export interface MessagePoster {
  postMessage(message: unknown, targetOrigin: string): void;
}

/** Anything that can host the `message` listener. */
export interface MessageTarget {
  addEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
}

// ── The guard ───────────────────────────────────────────────────────────────

export type GuardFailure = "wrong-source" | "wrong-origin" | "invalid-payload" | "pack-mismatch";

export type GuardResult<T> =
  | { ok: true; message: T }
  | { ok: false; reason: GuardFailure; detail?: string };

/**
 * The single security gate. `event.data` is NEVER read, parsed, or coerced
 * before the source/origin checks pass and zod has validated it — it is handed
 * to `safeParse` as an opaque `unknown` and nothing else.
 */
export function guardPreviewMessage<T>(
  schema: z.ZodType<T>,
  event: MessageEventLike,
  expected: { source: unknown; origin: string; pack: PreviewPackIdentity },
): GuardResult<T> {
  // A null/undefined expected source would make `===` match a message whose
  // `source` is also null (e.g. one posted from a detached context), so an
  // unresolved expectation is treated as "trust nothing".
  if (expected.source == null || event.source !== expected.source) {
    return { ok: false, reason: "wrong-source" };
  }
  if (event.origin !== expected.origin) {
    return { ok: false, reason: "wrong-origin" };
  }
  const parsed = schema.safeParse(event.data);
  if (!parsed.success) {
    return { ok: false, reason: "invalid-payload", detail: parsed.error.message };
  }
  const message = parsed.data as T & PreviewPackIdentity;
  if (
    message.packId !== expected.pack.packId
    || message.packVersion !== expected.pack.packVersion
  ) {
    return {
      ok: false,
      reason: "pack-mismatch",
      detail: `Expected ${expected.pack.packId}@${expected.pack.packVersion}, received ${message.packId}@${message.packVersion}.`,
    };
  }
  return { ok: true, message: parsed.data };
}

