import type { JsonValue } from "@zudo-composer/component-contract";
import type { ContentEntryRecord, ContentFieldDefinition, ContentModelRecord } from "./model";

/** Trusted host code. Field-local validation only; never mutates or normalizes values. */
export interface ContentFieldValidationInput {
  providerId: string;
  model: ContentModelRecord;
  entry: ContentEntryRecord;
  field: ContentFieldDefinition;
  value: JsonValue | undefined;
  previousValue: JsonValue | undefined;
  purpose: "write" | "publish";
}
export interface ContentPolicyIssue { code: string; message: string }
export interface ContentValidationModule {
  validateContentField(input: ContentFieldValidationInput): readonly ContentPolicyIssue[];
}
export interface ContentValidationPolicy extends ContentValidationModule {
  /** Attested module graph identity, persisted with proposed changes. */
  identity?: string;
  /** The loader refuses reuse after the attested source graph changes. */
  assertCurrent?(): Promise<void>;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
export async function validateContentPolicy(policy: ContentValidationPolicy | undefined, input: {
  providerId: string; model: ContentModelRecord; entry: ContentEntryRecord; previous?: ContentEntryRecord; purpose: "write" | "publish";
}, checkEpoch = true): Promise<{ fieldId: string; code: string; message: string }[]> {
  if (!policy) return [];
  const fields = input.model.document.fields.filter(field => input.purpose === "publish" || !input.previous || JSON.stringify(input.entry.values[field.id]) !== JSON.stringify(input.previous.values[field.id]));
  if (!fields.length) return [];
  if (checkEpoch) await policy.assertCurrent?.();
  const issues: { fieldId: string; code: string; message: string }[] = [];
  for (const field of fields) {
    const value = input.entry.values[field.id], previousValue = input.previous?.values[field.id];
    const result = policy.validateContentField(freeze(structuredClone({ providerId: input.providerId, model: input.model, entry: input.entry, field, value, previousValue, purpose: input.purpose })));
    if (result && typeof (result as unknown as { then?: unknown }).then === "function") {
      // Reject async hooks without leaving a rejected callback promise unhandled.
      void Promise.resolve(result).catch(() => undefined);
      throw new Error("Content validation module returned invalid diagnostics: async validators are unsupported.");
    }
    if (!Array.isArray(result) || result.some(issue => !issue || typeof issue !== "object" || Object.keys(issue).some(key => !["code", "message"].includes(key)) || typeof issue.code !== "string" || !issue.code.trim() || issue.code.length > 120 || typeof issue.message !== "string" || !issue.message.trim() || issue.message.length > 4000)) throw new Error("Content validation module returned invalid diagnostics.");
    issues.push(...result.map(issue => ({ fieldId: field.id, code: issue.code, message: issue.message })));
  }
  if (checkEpoch) await policy.assertCurrent?.();
  return issues;
}
