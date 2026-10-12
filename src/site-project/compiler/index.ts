import { planLinkedJsxModules } from "../../composer/source/plan-linked-jsx";
import { compileSiteProject as compileSiteProjectWithoutModules } from "./compiler";
import type { CompileSiteProjectOptions, SiteProjectCompilation } from "./types";
import type { SiteProject } from "../model/types";

export * from "./types";

/** The full compiler: routes plus generated linked-JSX modules. */
export function compileSiteProject(project: SiteProject, options: CompileSiteProjectOptions): Promise<SiteProjectCompilation> {
  return compileSiteProjectWithoutModules(project, { planModules: planLinkedJsxModules, ...options });
}
