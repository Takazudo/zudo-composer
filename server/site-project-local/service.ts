import { componentPack } from "@zudo-sg/ui/composer-pack";
import { createComponentCatalog } from "../../src/composer/model/types";
import { createSiteProjectApiService } from "../../src/site-project/api/service";
import type { SiteProjectApiService } from "../../src/site-project/api/types";
import { createLocalSiteProjectStore, type LocalSiteProjectStoreOptions } from "./store";

export function createLocalSiteProjectApiService(options?: LocalSiteProjectStoreOptions): SiteProjectApiService {
  const store = createLocalSiteProjectStore(options);
  return createSiteProjectApiService({
    componentCatalog: createComponentCatalog(componentPack.manifest),
    projectStore: store,
    buildStore: store,
  });
}
