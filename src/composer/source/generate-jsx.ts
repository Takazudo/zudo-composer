// Deterministic Preact JSX generator.
//
// Turns a Composition document + serializable manifest into a single, stable
// Preact JSX module. Determinism guarantees:
//
//  - imports are collected across the whole tree and emitted in a stable
//    (module, export-name) order, with collision-safe local aliases — including
//    identical export names imported from DIFFERENT modules;
//  - scalar props are escaped as JSON. A "simple" string becomes a JSX string
//    attribute (`prop="x"`); a string with newlines/quotes/backslashes/braces/
//    angle-brackets/ampersands becomes a JS-EXPRESSION attribute
//    (`prop={"line1\nline2"}`) because JSX string attributes do not process
//    backslash escapes;
//  - a component's DEFAULT `children` slot renders as element children, while a
//    scalar `children` text field renders as a text-bound child expression;
//  - NAMED slots render as expression props (`left={<A/>}`), Fragment-wrapped
//    (`right={<>…</>}`) when a slot holds more than one child;
//  - `undefined`/`NaN` never appear.
//
// The virtual `document.root` is emitted as a Fragment (`<>…</>`) — never a
// wrapper element and never an import.
//
// Export is REFUSED when any node is opaque/invalid: dropping preserved data
// into a misleading export is worse than returning actionable diagnostics.

import type { CompositionDocument, CompositionNode } from "../model/types";
import type { ComponentCatalog } from "../model/types";
import type { DocumentDiagnostics } from "../model/validate";
import { diagnoseDocument } from "../model/validate";
import { orderedSlotIds } from "../model/index-model";

// ── Public API ───────────────────────────────────────────────────────────────

export interface ImportPlan {
  componentId: string;
  module: string;
  exportKind: "named" | "default";
  exportName: string;
  /** Collision-safe local identifier used as the JSX tag. */
  localName: string;
}

export interface GenerateJsxOptions {
  /** Exported component identifier. Defaults to `Composition`. */
  componentName?: string;
  /**
   * How the generated component is exported. The established single-document
   * generator keeps its named export by default; linked file modules opt into
   * a stable default export.
   */
  componentExport?: "named" | "default" | "none";
  /**
   * Identifiers already owned by a surrounding generated module. Component
   * imports are aliased away from these names deterministically.
   */
  reservedIdentifiers?: readonly string[];
  /**
   * A real source-slot exposed by a linked Global-template module. The
   * generated component receives an `outlets` object keyed by this stable id
   * and renders that entry at the selected slot. This is intentionally an
   * opt-in source-module primitive; ordinary document generation has no
   * outlet API or generated props.
   */
  linkedOutlet?: {
    id: string;
    target: { parentId: string; slotId: string };
  };
}

export interface JsxGenerationResult {
  /** True when a clean module was generated; false when export was refused. */
  ok: boolean;
  /** True when generation was refused because opaque/invalid nodes remain. */
  blocked: boolean;
  /** The generated module source (empty string when blocked). */
  code: string;
  diagnostics: DocumentDiagnostics;
  /** Resolved imports, in emitted order. */
  imports: ImportPlan[];
  /** Node ids in emission order — equals canonical traversal order. */
  emittedNodeOrder: string[];
}

// ── Escaping ─────────────────────────────────────────────────────────────────

// A string is "simple" (safe as a JSX string attribute) only if it contains no
// backslash, double-quote, angle bracket, brace, ampersand, or C0/DEL control
// character (newline/tab/form-feed/etc — ANY raw control byte, not just the
// three most common ones). Everything else must go through a JS-expression
// attribute.
// eslint-disable-next-line no-control-regex
const SIMPLE_STRING = /^[^\\"<>{}&\x00-\x1F\x7F]*$/;

// A prop key survives as a literal JSX attribute name only if it is a legal
// JS identifier optionally hyphenated (JSX allows `data-*`/`aria-*`). A
// non-conforming key (e.g. stray whitespace on a JSON prop that bypassed a
// field descriptor) cannot be expressed as `name={...}` without producing
// unparseable JSX, so it is OMITTED from scalar attrs rather than corrupting
// the generated module.
const VALID_JSX_ATTR_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*(-[A-Za-z0-9_$]+)*$/;

function renderScalarAttr(name: string, value: unknown): string | null {
  if (value === undefined) return null; // never emit undefined
  if (value === null) return `${name}={null}`;
  switch (typeof value) {
    case "string":
      return SIMPLE_STRING.test(value)
        ? `${name}="${value}"`
        : `${name}={${JSON.stringify(value)}}`;
    case "number":
      return Number.isFinite(value) ? `${name}={${value}}` : null; // never emit NaN/Infinity
    case "boolean":
      return `${name}={${value}}`;
    case "object":
      // arrays + plain objects → JSON expression.
      return `${name}={${JSON.stringify(value)}}`;
    default:
      return null;
  }
}

// ── Line helpers ─────────────────────────────────────────────────────────────

function indentLines(lines: string[], spaces: number): string[] {
  const pad = " ".repeat(spaces);
  return lines.map((line) => (line.length ? pad + line : line));
}

// ── Import planning ──────────────────────────────────────────────────────────

function planImports(
  componentIds: string[],
  manifest: ComponentCatalog,
  reserved: Set<string>,
): Map<string, ImportPlan> {
  const sorted = [...componentIds].sort((a, b) => {
    const sa = manifest.get(a)!.source;
    const sb = manifest.get(b)!.source;
    return sa.module.localeCompare(sb.module) || sa.exportName.localeCompare(sb.exportName) || a.localeCompare(b);
  });

  const used = new Set(reserved);
  const plan = new Map<string, ImportPlan>();
  // Two different componentIds can point at the EXACT same (module,
  // exportKind, exportName) export — e.g. two definitions wrapping the same
  // underlying component. A JS module can bind a given export under only one
  // local name per file, so they MUST share one ImportPlan; planning them
  // independently would either double-import or (for two `default` exports of
  // the same module) silently drop one import while still referencing its tag.
  const byExportKey = new Map<string, ImportPlan>();

  for (const componentId of sorted) {
    const src = manifest.get(componentId)!.source;
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
    const importPlan: ImportPlan = {
      componentId,
      module: src.module,
      exportKind: src.exportKind,
      exportName: src.exportName,
      localName: local,
    };
    byExportKey.set(exportKey, importPlan);
    plan.set(componentId, importPlan);
  }
  return plan;
}

function buildImportLines(plans: ImportPlan[]): string[] {
  const byModule = new Map<string, { def?: ImportPlan; named: ImportPlan[] }>();
  for (const plan of plans) {
    const group = byModule.get(plan.module) ?? { named: [] };
    if (plan.exportKind === "default") group.def = plan;
    else group.named.push(plan);
    byModule.set(plan.module, group);
  }

  const lines: string[] = [];
  for (const module of [...byModule.keys()].sort()) {
    const group = byModule.get(module)!;
    const parts: string[] = [];
    if (group.def) parts.push(group.def.localName);
    if (group.named.length) {
      const specs = [...group.named]
        .sort((a, b) => a.exportName.localeCompare(b.exportName))
        .map((n) => (n.exportName === n.localName ? n.exportName : `${n.exportName} as ${n.localName}`));
      parts.push(`{ ${specs.join(", ")} }`);
    }
    lines.push(`import ${parts.join(", ")} from "${module}";`);
  }
  return lines;
}

// ── Element rendering ────────────────────────────────────────────────────────

function toIdentifier(name: string, fallback: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]/g, " ").trim();
  if (!cleaned) return fallback;
  const pascal = cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  return /^[A-Za-z_]/.test(pascal) ? pascal : fallback;
}

/**
 * Generate a deterministic Preact JSX module. See the file header for the full
 * determinism/escaping contract.
 */
export function generateJsx(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  options: GenerateJsxOptions = {},
): JsxGenerationResult {
  const diagnostics = diagnoseDocument(document, manifest);
  const componentName = toIdentifier(options.componentName ?? document.name ?? "Composition", "Composition");
  const componentExport = options.componentExport ?? "named";
  const linkedOutlet = options.linkedOutlet;

  if (!diagnostics.canExport) {
    return { ok: false, blocked: true, code: "", diagnostics, imports: [], emittedNodeOrder: [] };
  }

  const usedComponentIds = new Set<string>();
  const emittedNodeOrder: string[] = [];

  // Two-pass: collect components + emission order while rendering into a tree of
  // lines, then resolve aliases and rewrite tags. To keep it single-pass and
  // deterministic we render with the FINAL tag by planning imports first.
  const collect = (children: CompositionNode[]): void => {
    for (const node of children) {
      usedComponentIds.add(node.componentId);
      const entry = manifest.get(node.componentId)!;
      for (const slotId of orderedSlotIds(node, entry)) collect(node.slots[slotId] ?? []);
    }
  };
  collect(document.root);

  const reserved = new Set([componentName, ...(options.reservedIdentifiers ?? [])]);
  if (linkedOutlet) reserved.add("CompositionOutlets");
  const plan = planImports([...usedComponentIds], manifest, reserved);
  // De-duplicated by reference: two componentIds sharing the exact same export
  // (see `planImports`) point at the SAME ImportPlan object, so a Set collapses
  // them to one entry for both the emitted import statement and `imports`.
  const uniqueImportPlans = [...new Set(plan.values())];
  const tagOf = (componentId: string): string => plan.get(componentId)!.localName;

  const renderNode = (node: CompositionNode): string[] => {
    emittedNodeOrder.push(node.id);
    const entry = manifest.get(node.componentId)!;
    const tag = tagOf(node.componentId);

    const slotProps = new Set(entry.slots.map((s) => s.prop));
    const hasDefaultChildrenSlot = entry.slots.some((s) => s.prop === "children");
    const childrenTextField = hasDefaultChildrenSlot
      ? undefined
      : entry.fields.find((f) => f.prop === "children" && f.kind === "text");
    const textChildProp = childrenTextField?.prop;

    // Scalar attributes: field-declared props first (in declaration order), then
    // any remaining props (sorted) — excluding slot-backed and text-child props.
    const emittedProps = new Set<string>();
    const scalarAttrs: string[] = [];
    const pushScalar = (prop: string): void => {
      if (emittedProps.has(prop)) return;
      if (prop === textChildProp || slotProps.has(prop)) return;
      if (!(prop in node.props)) return;
      if (!VALID_JSX_ATTR_NAME.test(prop)) return; // cannot be expressed as a JSX attr
      const attr = renderScalarAttr(prop, node.props[prop]);
      if (attr !== null) scalarAttrs.push(attr);
      emittedProps.add(prop);
    };
    for (const field of entry.fields) pushScalar(field.prop);
    for (const prop of Object.keys(node.props).sort()) pushScalar(prop);

    // Slots in canonical order: named slots → expression props; default children
    // slot → structural children body.
    const namedAttrLines: string[][] = [];
    const structuralChildBlocks: string[][] = [];
    for (const slotId of orderedSlotIds(node, entry)) {
      const slot = entry.slots.find((s) => s.id === slotId);
      if (!slot) continue; // canExport guarantees no undeclared slots remain
      const children = node.slots[slotId] ?? [];
      const isLinkedOutlet =
        linkedOutlet !== undefined
        && node.id === linkedOutlet.target.parentId
        && slotId === linkedOutlet.target.slotId;
      const linkedOutletExpression = isLinkedOutlet ? `outlets[${JSON.stringify(linkedOutlet.id)}]` : undefined;
      if (slot.prop === "children") {
        if (linkedOutletExpression !== undefined) {
          structuralChildBlocks.push([`{${linkedOutletExpression}}`]);
          continue;
        }
        for (const child of children) structuralChildBlocks.push(renderNode(child));
      } else {
        if (linkedOutletExpression !== undefined) {
          namedAttrLines.push([`${slot.prop}={${linkedOutletExpression}}`]);
          continue;
        }
        if (children.length === 0) continue; // omit empty named slots (no null props)
        namedAttrLines.push(renderNamedSlotAttr(slot.prop, children));
      }
    }

    const textChildValue =
      textChildProp !== undefined && node.props[textChildProp] != null
        ? String(node.props[textChildProp])
        : null;
    const textChildSource = textChildValue !== null ? `{${JSON.stringify(textChildValue)}}` : "";

    const attrBlocks: string[][] = [...scalarAttrs.map((a) => [a]), ...namedAttrLines];
    const attrsMultiline = attrBlocks.some((a) => a.length > 1);
    const hasStructural = structuralChildBlocks.length > 0;

    if (!attrsMultiline) {
      const attrStr = attrBlocks.length ? " " + attrBlocks.map((a) => a[0]).join(" ") : "";
      if (hasStructural) {
        return [
          `<${tag}${attrStr}>`,
          ...structuralChildBlocks.flatMap((b) => indentLines(b, 2)),
          `</${tag}>`,
        ];
      }
      if (textChildSource) return [`<${tag}${attrStr}>${textChildSource}</${tag}>`];
      return [`<${tag}${attrStr} />`];
    }

    const open = [`<${tag}`, ...attrBlocks.flatMap((a) => indentLines(a, 2))];
    if (hasStructural) {
      return [...open, `>`, ...structuralChildBlocks.flatMap((b) => indentLines(b, 2)), `</${tag}>`];
    }
    if (textChildSource) return [...open, `>${textChildSource}</${tag}>`];
    return [...open, `/>`];
  };

  const renderNamedSlotAttr = (prop: string, children: CompositionNode[]): string[] => {
    if (children.length === 1) {
      const childLines = renderNode(children[0]);
      if (childLines.length === 1) return [`${prop}={${childLines[0]}}`];
      return [`${prop}={`, ...indentLines(childLines, 2), `}`];
    }
    const inner = children.flatMap((c) => renderNode(c));
    return [`${prop}={`, `  <>`, ...indentLines(inner, 4), `  </>`, `}`];
  };

  const rootBlocks = document.root.map((node) => renderNode(node));
  const importLines = buildImportLines(uniqueImportPlans);

  const body =
    rootBlocks.length === 0
      ? ["    <></>"]
      : ["    <>", ...rootBlocks.flatMap((b) => indentLines(b, 6)), "    </>"];

  const componentParameter = linkedOutlet
    ? `({ outlets = {} }: { outlets?: CompositionOutlets })`
    : "()";
  const exportPrefix = componentExport === "default" ? "export default " : componentExport === "named" ? "export " : "";
  const lines = [
    ...(importLines.length ? [...importLines, ""] : []),
    ...(linkedOutlet
      ? [
          "export type CompositionOutlets = {",
          `  ${JSON.stringify(linkedOutlet.id)}?: import("preact").ComponentChildren;`,
          "};",
          "",
        ]
      : []),
    `${exportPrefix}function ${componentName}${componentParameter} {`,
    "  return (",
    ...body,
    "  );",
    "}",
    "",
  ];

  return {
    ok: true,
    blocked: false,
    code: lines.join("\n"),
    diagnostics,
    imports: uniqueImportPlans,
    emittedNodeOrder,
  };
}
