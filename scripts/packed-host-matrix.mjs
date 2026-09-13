// @ts-check
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { packedHostMatrix } from "./packed-host-helpers.mjs";

const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== "--github-output")) throw new Error("Usage: packed-host-matrix.mjs [--github-output]");
const matrix = JSON.stringify(packedHostMatrix(resolve(import.meta.dirname, "..")));
if (args.length) {
  if (!process.env.GITHUB_OUTPUT) throw new Error("--github-output requires GITHUB_OUTPUT");
  await appendFile(process.env.GITHUB_OUTPUT, `matrix=${matrix}\n`);
}
console.log(matrix);
