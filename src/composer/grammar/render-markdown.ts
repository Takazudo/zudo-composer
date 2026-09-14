// Renders a `Grammar` (see `./index`) as Markdown for agents. One section
// per template, in the grammar's own order; a closing section covers pages
// bound to no template. Pure string formatting — no knowledge of the manifest
// or documents that produced the grammar.

import type { Grammar, GrammarAcceptedKind, GrammarRegion, GrammarTemplate } from "./index";

function acceptsHeader(region: GrammarRegion): string {
  if (region.cardinality === "single") return "accepts (exactly one):";
  const fragments: string[] = [];
  if (region.min !== undefined) fragments.push(`at least ${region.min}`);
  if (region.max !== undefined) fragments.push(`at most ${region.max}`);
  return fragments.length > 0 ? `accepts (any order, ${fragments.join(", ")}):` : "accepts (any order):";
}

function acceptedKindLine(kind: GrammarAcceptedKind, idWidth: number): string {
  const childrenNote = kind.accepts ? `; children: ${kind.accepts.join(", ")} only` : "";
  return `  - ${kind.id.padEnd(idWidth)}  — ${kind.description}${childrenNote}`;
}

function renderRegion(region: GrammarRegion): string[] {
  const idWidth = region.accepts.reduce((width, kind) => Math.max(width, kind.id.length), 0);
  return [
    `Region "${region.outletLabel}" = ${region.componentId} › ${region.slotId}`,
    `- ${acceptsHeader(region)}`,
    ...region.accepts.map((kind) => acceptedKindLine(kind, idWidth)),
    "- everything else in the pack is rejected by the model.",
  ];
}

function renderTemplate(template: GrammarTemplate): string {
  const header = `# ${template.name} (template ${template.id})`;
  if (template.region === null) {
    return [header, "- open: this template's root accepts any component in the pack."].join("\n");
  }
  return [header, ...renderRegion(template.region)].join("\n");
}

/** Render the grammar as Markdown, one section per template plus the openRoot note. */
export function renderGrammarMarkdown(grammar: Grammar): string {
  const sections = grammar.templates.map(renderTemplate);
  sections.push(["# Pages without a template", "- accepts: any component in the pack."].join("\n"));
  return sections.join("\n\n");
}
