import type { FlexibleEntityDefinition } from "yage/entity/EntityFactory";

const entities = import.meta.glob(["../entities/*.json", "../entities/*.jsonc", "../entities/*.json5"], {
  eager: true,
});
const folders = import.meta.glob(["../entities/**/*.json", "../entities/**/*.jsonc", "../entities/**/*.json5"], {
  eager: true,
});
const both = [...Object.values(entities), ...Object.values(folders)];
export default both as FlexibleEntityDefinition[];
