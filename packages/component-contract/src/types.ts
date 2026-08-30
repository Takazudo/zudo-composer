export const COMPONENT_PACK_KIND = 'zudo-composer/component-pack' as const;
export const COMPONENT_DOCUMENT_KIND = 'zudo-composer/document' as const;
export const CONTRACT_VERSION = 1 as const;
export const DOCUMENT_VERSION = 1 as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type PropKey<TProps extends object> = Extract<keyof TProps, string>;
type JsonCompatible<TValue> = TValue extends JsonPrimitive
  ? TValue
  : TValue extends readonly (infer TItem)[]
    ? readonly JsonCompatible<TItem>[]
    : TValue extends object
      ? { readonly [TKey in keyof TValue]: JsonCompatible<TValue[TKey]> }
      : never;

export type ComponentDefaults<TProps extends object> = {
  readonly [TKey in PropKey<TProps>]?: JsonCompatible<TProps[TKey]>;
};

type SelectOption<TValue> = unknown extends TValue
  ? string
  : Extract<NonNullable<TValue>, string>;

export interface AuthorInlineEditMetadata {
  readonly multiline?: boolean;
  readonly mode?: 'plain' | 'markdown-source';
}

export interface InlineEditMetadata {
  readonly multiline: boolean;
  readonly mode: 'plain' | 'markdown-source';
}

type FieldBase<TProp extends string> = {
  readonly prop: TProp;
  readonly label: string;
  /** Required editable fields must have a valid default. */
  readonly required?: boolean;
};

type UntypedFieldDefinition<TProp extends string> =
  | (FieldBase<TProp> & {
      readonly kind: 'text';
      readonly inlineEdit?: AuthorInlineEditMetadata;
    })
  | (FieldBase<TProp> & { readonly kind: 'select'; readonly options: readonly string[] })
  | (FieldBase<TProp> & { readonly kind: 'boolean' })
  | (FieldBase<TProp> & {
      readonly kind: 'number';
      readonly min?: number;
      readonly max?: number;
      readonly step?: number;
    })
  | (FieldBase<TProp> & { readonly kind: 'color' });

type StringFieldDefinition<TProp extends string, TValue> = Extract<NonNullable<TValue>, string> extends never
  ? never
  :
    | (FieldBase<TProp> & {
        readonly kind: 'text';
        readonly inlineEdit?: AuthorInlineEditMetadata;
      })
    | (FieldBase<TProp> & { readonly kind: 'color' });

type SelectFieldDefinition<TProp extends string, TValue> = [NonNullable<TValue>] extends [never]
  ? never
  : NonNullable<TValue> extends string
    ? FieldBase<TProp> & {
        readonly kind: 'select';
        readonly options: readonly SelectOption<TValue>[];
      }
    : never;

type BooleanFieldDefinition<TProp extends string, TValue> = [NonNullable<TValue>] extends [never]
  ? never
  : NonNullable<TValue> extends boolean
    ? FieldBase<TProp> & { readonly kind: 'boolean' }
    : never;

type NumberFieldDefinition<TProp extends string, TValue> = [NonNullable<TValue>] extends [never]
  ? never
  : NonNullable<TValue> extends number
    ? FieldBase<TProp> & {
        readonly kind: 'number';
        readonly min?: number;
        readonly max?: number;
        readonly step?: number;
      }
    : never;

type FieldDefinitionForProp<TProp extends string, TValue> = unknown extends TValue
  ? UntypedFieldDefinition<TProp>
  : StringFieldDefinition<TProp, TValue>
    | SelectFieldDefinition<TProp, TValue>
    | BooleanFieldDefinition<TProp, TValue>
    | NumberFieldDefinition<TProp, TValue>;

export type AuthorFieldDefinition<TProps extends object = Record<string, unknown>> = {
  [TKey in PropKey<TProps>]: FieldDefinitionForProp<TKey, TProps[TKey]>;
}[PropKey<TProps>];

export type FieldDefinition<TProp extends string = string> =
  | (FieldBase<TProp> & { readonly kind: 'text'; readonly inlineEdit?: InlineEditMetadata })
  | (FieldBase<TProp> & { readonly kind: 'select'; readonly options: readonly string[] })
  | (FieldBase<TProp> & { readonly kind: 'boolean' })
  | (FieldBase<TProp> & {
      readonly kind: 'number';
      readonly min?: number;
      readonly max?: number;
      readonly step?: number;
    })
  | (FieldBase<TProp> & { readonly kind: 'color' });

export type SlotCardinality = 'single' | 'many';

/** Framework-neutral structural equivalent of the values a component renderer can project. */
type RenderedComponentChild = object | string | number | bigint | boolean | null | undefined;
type RenderedComponentChildren = RenderedComponentChild | RenderedComponentChild[];

type SlotPropKey<TProps extends object, TCardinality extends SlotCardinality> = {
  [TKey in PropKey<TProps>]: TCardinality extends 'single'
    ? RenderedComponentChildren extends TProps[TKey] ? TKey : never
    : RenderedComponentChildren[] extends TProps[TKey] ? TKey : never;
}[PropKey<TProps>];

interface AuthorSlotDefinitionBase<TProp extends string, TComponentId extends string, TCardinality extends SlotCardinality> {
  readonly id: string;
  readonly prop: TProp;
  readonly label: string;
  /** Omitted means any component in the pack is accepted. */
  readonly accepts?: readonly TComponentId[];
  readonly cardinality: TCardinality;
}

export type AuthorSlotDefinition<TProps extends object = Record<string, unknown>, TComponentId extends string = string> =
  | AuthorSlotDefinitionBase<SlotPropKey<TProps, 'single'>, TComponentId, 'single'>
  | AuthorSlotDefinitionBase<SlotPropKey<TProps, 'many'>, TComponentId, 'many'>;

export interface SlotDefinition<TComponentId extends string = string, TProp extends string = string> {
  readonly id: string;
  readonly prop: TProp;
  readonly label: string;
  readonly accepts?: readonly TComponentId[];
  readonly cardinality: SlotCardinality;
}

/** Explicitly documents a prop that is intentionally not authorable. */
export interface StaticPropDefinition<TProp extends string = string> {
  readonly prop: TProp;
  readonly reason?: string;
}

export type AuthorStaticPropDefinition<TProps extends object = Record<string, unknown>> =
  StaticPropDefinition<PropKey<TProps>>;

/** Public import metadata for deterministic generated source. */
export interface PublicSourceDefinition {
  readonly module: string;
  readonly exportKind: 'named' | 'default';
  readonly exportName: string;
  readonly localName?: string;
}

export interface ComponentManifest<TComponentId extends string = string> {
  readonly id: TComponentId;
  readonly schemaVersion: number;
  readonly title: string;
  readonly category: string;
  readonly description: string;
  readonly source: PublicSourceDefinition;
  readonly defaults: JsonObject;
  readonly fields: readonly FieldDefinition[];
  readonly slots: readonly SlotDefinition<TComponentId>[];
  /** Normalized to an empty array by the runtime parser when omitted. */
  readonly staticProps?: readonly StaticPropDefinition[];
}

export interface ComponentPackManifest<TComponentId extends string = string> {
  readonly kind: typeof COMPONENT_PACK_KIND;
  readonly contractVersion: typeof CONTRACT_VERSION;
  readonly packId: string;
  readonly packVersion: string;
  readonly components: readonly ComponentManifest<TComponentId>[];
}

export interface InlineEditorAdapter<TProps extends object = Record<string, unknown>, TElement = unknown> {
  readonly field: PropKey<TProps>;
  readonly resolveElement: (root: TElement) => TElement | null;
}

export interface RuntimeAdapters<
  TProps extends object = Record<string, unknown>,
  TRenderOutput = unknown,
  TElement = unknown,
> {
  readonly render?: (props: Partial<TProps>) => TRenderOutput;
  readonly inlineEditor?: InlineEditorAdapter<TProps, TElement>;
}

interface AuthorComponentDefinitionBase<
  TProps extends object = Record<string, unknown>,
  TComponent = unknown,
  TRenderOutput = unknown,
  TElement = unknown,
  TComponentId extends string = string,
> {
  readonly id: TComponentId;
  readonly schemaVersion: number;
  readonly title: string;
  readonly category: string;
  readonly description: string;
  readonly source: PublicSourceDefinition;
  readonly defaults?: ComponentDefaults<TProps>;
  readonly fields?: readonly AuthorFieldDefinition<TProps>[];
  readonly slots?: readonly AuthorSlotDefinition<TProps, string>[];
  /** Props intentionally kept outside the authoring surface. */
  readonly staticProps?: readonly AuthorStaticPropDefinition<TProps>[];
  /** Trusted runtime values; neither member enters the manifest. */
  readonly component: TComponent;
  readonly adapters?: RuntimeAdapters<TProps, TRenderOutput, TElement>;
}

export type AuthorComponentDefinitionInput<
  TProps extends object,
  TComponent = unknown,
  TRenderOutput = unknown,
  TElement = unknown,
  TComponentId extends string = string,
> = Omit<AuthorComponentDefinitionBase<TProps, TComponent, TRenderOutput, TElement, TComponentId>, 'component'>;

type RequiredPropKey<TProps extends object> = {
  [TKey in PropKey<TProps>]-?: object extends Pick<TProps, TKey> ? never : TKey;
}[PropKey<TProps>];

type AtLeastOneRequiredDefault<TProps extends object> = {
  [TKey in RequiredPropKey<TProps>]: Readonly<Record<TKey, JsonCompatible<TProps[TKey]>>>
    & ComponentDefaults<TProps>;
}[RequiredPropKey<TProps>];

type NonEmptyArray<TValue> = readonly [TValue, ...TValue[]];

type HasRequiredPropClassification<TProps extends object> = [RequiredPropKey<TProps>] extends [never]
  ? unknown
  :
    | { readonly defaults: AtLeastOneRequiredDefault<TProps> }
    | { readonly fields: NonEmptyArray<AuthorFieldDefinition<TProps> & { readonly prop: RequiredPropKey<TProps> }> }
    | { readonly slots: NonEmptyArray<AuthorSlotDefinition<TProps, string> & { readonly prop: RequiredPropKey<TProps> }> }
    | { readonly staticProps: NonEmptyArray<AuthorStaticPropDefinition<TProps> & { readonly prop: RequiredPropKey<TProps> }> };

export type AuthorComponentDefinition<
  TProps extends object = Record<string, unknown>,
  TComponent = unknown,
  TRenderOutput = unknown,
  TElement = unknown,
  TComponentId extends string = string,
> = AuthorComponentDefinitionBase<TProps, TComponent, TRenderOutput, TElement, TComponentId>
  & HasRequiredPropClassification<TProps>;

type ComponentProps<TComponent> = TComponent extends (props: infer TProps, ...args: never[]) => unknown
  ? TProps extends object ? TProps : never
  : TComponent extends abstract new (props: infer TProps, ...args: never[]) => unknown
    ? TProps extends object ? TProps : never
    : never;

type ClassifiedPropKey<TDefinition> =
  | (TDefinition extends { readonly defaults: infer TDefaults } ? Extract<keyof TDefaults, string> : never)
  | (TDefinition extends { readonly fields: readonly (infer TField)[] }
    ? TField extends { readonly prop: infer TProp extends string } ? TProp : never
    : never)
  | (TDefinition extends { readonly slots: readonly (infer TSlot)[] }
    ? TSlot extends { readonly prop: infer TProp extends string } ? TProp : never
    : never)
  | (TDefinition extends { readonly staticProps: readonly (infer TStatic)[] }
    ? TStatic extends { readonly prop: infer TProp extends string } ? TProp : never
    : never);

export type ValidateAuthorComponentDefinition<TProps extends object, TDefinition> =
  TDefinition extends { readonly component: infer TComponent }
    ? Omit<TDefinition, 'component'> extends AuthorComponentDefinitionInput<TProps, TComponent, unknown, any>
      ? TProps extends ComponentProps<TComponent>
        ? Exclude<RequiredPropKey<TProps>, ClassifiedPropKey<TDefinition>> extends never
          ? unknown
          : { readonly ERROR_unclassified_required_props: Exclude<RequiredPropKey<TProps>, ClassifiedPropKey<TDefinition>> }
        : { readonly ERROR_props_must_belong_to_component: ComponentProps<TComponent> }
      : { readonly ERROR_invalid_component_definition: AuthorComponentDefinitionInput<TProps, TComponent, unknown, any> }
    : never;

export interface RuntimeComponentEntry<TComponent = unknown, TRenderOutput = unknown, TElement = unknown> {
  readonly schemaVersion: number;
  readonly component: TComponent;
  readonly adapters?: RuntimeAdapters<Record<string, unknown>, TRenderOutput, TElement>;
}

export interface ComponentRuntimeRegistry<TComponent = unknown, TRenderOutput = unknown, TElement = unknown> {
  readonly packId: string;
  readonly packVersion: string;
  readonly components: Readonly<Record<string, RuntimeComponentEntry<TComponent, TRenderOutput, TElement>>>;
}

export interface TrustedComponentPack<TComponent = unknown, TRenderOutput = unknown, TElement = unknown> {
  readonly manifest: ComponentPackManifest;
  readonly runtime: ComponentRuntimeRegistry<TComponent, TRenderOutput, TElement>;
}

export interface PersistedComponentNode {
  readonly id: string;
  readonly componentId: string;
  readonly componentVersion: number;
  readonly props: JsonObject;
  readonly slots: Readonly<Record<string, readonly PersistedComponentNode[]>>;
}

/** Minimal versioned tree boundary; composition naming/reuse belongs to the application. */
export interface ComponentDocument {
  readonly kind: typeof COMPONENT_DOCUMENT_KIND;
  readonly documentVersion: typeof DOCUMENT_VERSION;
  readonly root: readonly PersistedComponentNode[];
}

export type ComponentResolution<TComponent, TRenderOutput = unknown, TElement = unknown> =
  | {
      readonly status: 'resolved';
      readonly node: PersistedComponentNode;
      readonly definition: ComponentManifest;
      readonly runtime: RuntimeComponentEntry<TComponent, TRenderOutput, TElement>;
    }
  | {
      readonly status: 'opaque';
      readonly reason: 'unknown-component' | 'component-version-mismatch';
      readonly node: PersistedComponentNode;
    };

export interface RuntimeSchema<T> {
  parse(input: unknown): T;
  safeParse(input: unknown):
    | { readonly success: true; readonly data: T }
    | { readonly success: false; readonly error: ContractValidationError };
}

export type ContractIssueCode =
  | 'DUPLICATE_ACCEPTS'
  | 'DUPLICATE_COMPONENT_ID'
  | 'DUPLICATE_FIELD_PROP'
  | 'DUPLICATE_SELECT_OPTION'
  | 'DUPLICATE_SLOT_ID'
  | 'DUPLICATE_SLOT_PROP'
  | 'DUPLICATE_SOURCE'
  | 'DUPLICATE_STATIC_PROP'
  | 'FIELD_SLOT_PROP_COLLISION'
  | 'INLINE_EDITOR_MISMATCH'
  | 'INVALID_FIELD_DOMAIN'
  | 'INVALID_JSON_VALUE'
  | 'INVALID_PUBLIC_EXPORT'
  | 'INVALID_PUBLIC_IMPORT'
  | 'INVALID_VALUE'
  | 'MISSING_RUNTIME_ENTRY'
  | 'MULTIPLE_INLINE_EDIT_FIELDS'
  | 'REQUIRED_DEFAULT_MISSING'
  | 'RESERVED_KEY'
  | 'RUNTIME_COMPONENT_VERSION_MISMATCH'
  | 'RUNTIME_MANIFEST_MISMATCH'
  | 'SOURCE_ADAPTER_NOT_ALLOWED'
  | 'STATIC_PROP_COLLISION'
  | 'TRUSTED_VALUE_IN_MANIFEST'
  | 'UNCLASSIFIED_DEFAULT'
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
