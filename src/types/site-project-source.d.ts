declare module "virtual:site-project-source" {
  import type { SiteProject } from "../site-project/model/types";
  export const siteProject: SiteProject | null;
  export default siteProject;
}
