export const COMPONENT_PACK_KIND = 'zudo-composer/component-pack' as const;
export const COMPONENT_DOCUMENT_KIND = 'zudo-composer/document' as const;
export const CONTRACT_VERSION = 1 as const;
export const DOCUMENT_VERSION = 1 as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type ScalarPropValue = JsonPrimitive;
export type ScalarProps = Readonly<Record<string, ScalarPropValue>>;
export type ScalarPropKey<TProps extends object> = Extract<{
  [TKey in keyof TProps]-?: Exclude<TProps[TKey], undefined> extends ScalarPropValue ? TKey : never;
}[keyof TProps], string>;

export type ScalarPropKind = 'string' | 'number' | 'boolean' | 'null';

export interface PropDefinition<TProp extends string = string> {
  readonly prop: TProp;
  readonly kind: ScalarPropKind;
  readonly required?: boolean;
}

export interface FieldDefinition<TField extends string = string> {
  readonly id: TField;
}

export interface SlotDefinition<TComponentId extends string = string, TSlot extends string = string> {
  readonly id: TSlot;
  readonly accepts?: readonly TComponentId[];
}

/** A source that generated consumer code may import without reaching into private files. */
export interface PublicSourceDefinition<TSource extends string = string> {
  readonly id: TSource;
  readonly module: string;
  readonly export: string;
}

export interface ComponentManifest<
  TComponentId extends string = string,
  TProp extends string = string,
  TField extends string = string,
  TSlot extends string = string,
  TSource extends string = string,
> {
  readonly id: TComponentId;
  /** Persisted schema identity for this component. Increment when persisted keys change. */
  readonly schemaVersion: number;
  readonly displayName: string;
  readonly props: readonly PropDefinition<TProp>[];
  readonly defaults: Readonly<Record<TProp, ScalarPropValue>>;
  readonly fields: readonly FieldDefinition<TField>[];
  readonly slots: readonly SlotDefinition<TComponentId, TSlot>[];
  readonly sources: readonly PublicSourceDefinition<TSource>[];
}

export interface ComponentPackManifest<TComponentId extends string = string> {
  readonly kind: typeof COMPONENT_PACK_KIND;
  /** Major version of this package envelope, independent of every other version. */
  readonly contractVersion: typeof CONTRACT_VERSION;
  readonly packId: string;
  /** Provider release identity; intentionally opaque to the contract. */
  readonly packVersion: string;
  readonly components: readonly ComponentManifest<TComponentId>[];
}

export interface AuthorComponentDefinition<
  TProps extends object,
  TRuntime,
  TComponentId extends string = string,
  TField extends string = string,
  TSlot extends string = string,
  TSource extends string = string,
> {
  readonly id: TComponentId;
  readonly schemaVersion: number;
  readonly displayName: string;
  /** `prop` names are persisted and therefore constrained to actual scalar component props. */
  readonly props: readonly PropDefinition<ScalarPropKey<TProps>>[];
  readonly defaults?: Partial<Readonly<Record<ScalarPropKey<TProps>, ScalarPropValue>>>;
  readonly fields?: readonly FieldDefinition<TField>[];
  readonly slots?: readonly SlotDefinition<string, TSlot>[];
  readonly sources?: readonly PublicSourceDefinition<TSource>[];
  /** Trusted runtime value. It is never copied into or accepted from JSON. */
  readonly runtime: TRuntime;
}

export interface RuntimeComponentEntry<TRuntime = unknown> {
  readonly schemaVersion: number;
  readonly runtime: TRuntime;
}

export interface ComponentRuntimeRegistry<TRuntime = unknown> {
  readonly packId: string;
  readonly packVersion: string;
  readonly components: Readonly<Record<string, RuntimeComponentEntry<TRuntime>>>;
}

export interface TrustedComponentPack<TRuntime = unknown> {
  readonly manifest: ComponentPackManifest;
  readonly runtime: ComponentRuntimeRegistry<TRuntime>;
}

export interface PersistedComponentNode {
  readonly id: string;
  readonly componentId: string;
  readonly componentVersion: number;
  readonly props: ScalarProps;
  readonly fields: JsonObject;
  readonly slots: Readonly<Record<string, readonly PersistedComponentNode[]>>;
}

export interface ComponentDocument {
  readonly kind: typeof COMPONENT_DOCUMENT_KIND;
  /** Version of persisted composition documents, independent of the pack contract. */
  readonly documentVersion: typeof DOCUMENT_VERSION;
  readonly packId: string;
  readonly packVersion: string;
  readonly roots: readonly PersistedComponentNode[];
}

export type ComponentResolution<TRuntime> =
  | {
      readonly status: 'resolved';
      readonly node: PersistedComponentNode;
      readonly component: ComponentManifest;
      readonly runtime: TRuntime;
    }
  | {
      readonly status: 'opaque';
      readonly reason: 'unknown-component' | 'component-version-mismatch';
      /** The original value is retained exactly for current-document-format recovery. */
      readonly node: PersistedComponentNode;
    };

export interface RuntimeSchema<T> {
  parse(input: unknown): T;
  safeParse(input: unknown):
    | { readonly success: true; readonly data: T }
    | { readonly success: false; readonly error: ContractValidationError };
}

export type ContractIssueCode =
  | 'DUPLICATE_COMPONENT_ID'
  | 'DUPLICATE_FIELD_ID'
  | 'DUPLICATE_PROP'
  | 'DUPLICATE_SLOT_ID'
  | 'DUPLICATE_SOURCE_ID'
  | 'DUPLICATE_ACCEPTS'
  | 'INLINE_ADAPTER_NOT_ALLOWED'
  | 'INVALID_JSON_VALUE'
  | 'INVALID_PUBLIC_EXPORT'
  | 'INVALID_PUBLIC_IMPORT'
  | 'INVALID_VALUE'
  | 'MISSING_RUNTIME_ENTRY'
  | 'RESERVED_KEY'
  | 'RUNTIME_COMPONENT_VERSION_MISMATCH'
  | 'RUNTIME_MANIFEST_MISMATCH'
  | 'UNRESOLVED_ACCEPTS'
  | 'UNKNOWN_KEY'
  | 'UNSUPPORTED_CONTRACT_VERSION'
  | 'UNSUPPORTED_DOCUMENT_VERSION';

export interface ContractIssue {
  readonly code: ContractIssueCode;
  readonly path: string;
  readonly message: string;
}

export class ContractValidationError extends Error {
  readonly issues: readonly ContractIssue[];

  constructor(issues: readonly ContractIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
    this.name = 'ContractValidationError';
    this.issues = issues;
  }
}
