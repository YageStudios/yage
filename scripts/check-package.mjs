import { fileURLToPath } from "node:url";
import { checkPackage } from "./package-layout.mjs";
const errors = checkPackage(fileURLToPath(new URL("../", import.meta.url)));
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Package entrypoints, declarations, source assets and peer boundaries are present.");
}
