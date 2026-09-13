declare module "virtual:hosted-demo-seed" {
  export const assets: import("../assets/model").AssetSnapshot;
}

declare module "virtual:demo-editor-project" {
  export const project: import("../site-project/model/types").SiteProject;
}
