declare module "virtual:site-project-source" {
  import type { SiteProject } from "../site-project/model/types";
  import type { ActivatedDeliverySource } from "../features/delivery/source";
  export const siteProject: SiteProject | null;
  export const siteProjectRevision: string | null;
  export const deliverySource: ActivatedDeliverySource;
  export default siteProject;
}
