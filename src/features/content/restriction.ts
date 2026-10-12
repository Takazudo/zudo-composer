// Restricted (content-only) presentation of the Content route.
//
// A hosted client role sees only the models its host policy lists, edits only
// the listed field ids, and never reaches schema, relationship, raw-record or
// structural controls. This is the presentation projection of that policy:
// hiding a control is usability, the host's service stays authoritative and
// rejects anything this projection would have hidden.

import { createContext } from "preact";
import { useContext } from "preact/hooks";

export interface ContentRestrictedModel {
  /** Field ids this role may edit; every other field renders read-only. */
  readonly fields: readonly string[];
  /** Host policy operation names, e.g. `put-entry-values`. */
  readonly operations: readonly string[];
}

export interface ContentRestriction {
  readonly models: Readonly<Record<string, ContentRestrictedModel>>;
}

export const ContentRestrictionContext = createContext<ContentRestriction | null>(null);

/** `null` is the unrestricted local tool. */
export function useContentRestriction(): ContentRestriction | null {
  return useContext(ContentRestrictionContext);
}

export function restrictionAllowsModel(restriction: ContentRestriction | null, modelId: string): boolean {
  return restriction === null || Object.hasOwn(restriction.models, modelId);
}

export function restrictionAllowsField(restriction: ContentRestriction | null, modelId: string, fieldId: string): boolean {
  return restriction === null || (Object.hasOwn(restriction.models, modelId) && restriction.models[modelId]!.fields.includes(fieldId));
}
