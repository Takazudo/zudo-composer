declare module "virtual:site-static-project" {
  export const project: import("../site-project/model/types").SiteProject;
  export const build: import("../site-project/compiler").SiteBuildPlan;
}
