declare module "virtual:site-project-source" {
  type SiteProject = import("../site-project/model/types").SiteProject;
  type ActivatedDeliverySource = import("../features/delivery/source").ActivatedDeliverySource;
  export const siteProject: SiteProject | null;
  export const siteProjectRevision: string | null;
  export const deliverySource: ActivatedDeliverySource;
  export default siteProject;
}
