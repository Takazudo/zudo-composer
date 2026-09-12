// `site-project.ts` → `site-project.json`.
//
// The TypeScript source is the authored truth and the JSON is what the tool
// consumes: the release CLI reads the aggregate, the currency test guards the
// committed copy, and a reviewer can diff it. Generation validates against the
// pack manifest first, so a broken graph fails here rather than at release.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalStringifyJson, validateSiteProject } from "zudo-composer/authoring";
import type { Site, SiteProject, SiteProjectDiagnostic } from "zudo-composer/site-project";

export const SITE_SOURCE_FILE = "site-project.ts";
export const SITE_OUTPUT_FILE = "site-project.json";

export class SiteProjectGenerationError extends Error {
  constructor(message: string, readonly diagnostics: readonly SiteProjectDiagnostic[] = []) {
    super(diagnostics.length ? `${message}\n${diagnostics.map((item) => `  ${item.path}: ${item.message} [${item.code}]`).join("\n")}` : message);
  }
}

function isSite(value: unknown): value is Site {
  return typeof value === "object" && value !== null && typeof (value as Site).toSiteProject === "function";
}

/** Import a package's `site-project.ts` and return its default-exported site. */
export async function loadSite(packageRoot: string): Promise<Site> {
  const module = (await import(/* @vite-ignore */ pathToFileURL(resolve(packageRoot, SITE_SOURCE_FILE)).href)) as { default?: unknown };
  if (!isSite(module.default)) throw new SiteProjectGenerationError(`${SITE_SOURCE_FILE} must default-export a site built with defineSite().`);
  return module.default;
}

/** Validate against the pack the site was authored with and return the canonical JSON text. */
export function renderSiteProject(site: Site): { project: SiteProject; text: string } {
  const validation = validateSiteProject(site.toSiteProject(), { componentPack: site.manifest });
  if (!validation.ok) throw new SiteProjectGenerationError(`Site "${site.id}" is not a valid SiteProject.`, validation.diagnostics);
  return { project: validation.project, text: canonicalStringifyJson(validation.project as never) };
}

export async function generateSiteProject(packageRoot: string): Promise<{ outputPath: string; changed: boolean }> {
  const site = await loadSite(packageRoot);
  const { text } = renderSiteProject(site);
  const outputPath = resolve(packageRoot, SITE_OUTPUT_FILE);
  const previous = await readFile(outputPath, "utf8").catch(() => undefined);
  if (previous !== text) await writeFile(outputPath, text);
  return { outputPath, changed: previous !== text };
}

/** Read the committed aggregate a package ships. */
export async function readSiteProjectFile(packageRoot: string): Promise<SiteProject> {
  return JSON.parse(await readFile(resolve(packageRoot, SITE_OUTPUT_FILE), "utf8")) as SiteProject;
}
