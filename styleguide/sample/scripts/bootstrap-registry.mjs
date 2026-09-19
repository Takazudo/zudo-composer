import { constants, copyFileSync } from "node:fs";

const seed = new URL("../src/styleguide/sg-registry.seed.ts", import.meta.url);
const target = new URL("../src/styleguide/sg-registry.ts", import.meta.url);

try {
  copyFileSync(seed, target, constants.COPYFILE_EXCL);
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}
