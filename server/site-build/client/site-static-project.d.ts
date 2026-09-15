declare module "virtual:site-static-project" {
  export const project: import("../../../src/site-project/model/types").SiteProject;
  export const build: import("../../../src/site-project/compiler").SiteBuildPlan;
}
