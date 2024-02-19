import { registerTemplate } from "@/ui/UiMap";

const uis = import.meta.glob(["../ui/*.json", "../ui/*.jsonc", "../ui/*.json5"], {
  eager: true,
}) as any;
const folders = import.meta.glob(["../ui/**/*.json", "../ui/**/*.jsonc", "../ui/**/*.json5"], {
  eager: true,
}) as any;
const both = {
  ...Object.entries(uis)
    .map(([key, value]: any) => {
      const name = key.substring(2).replace(/\//g, "__").split(".")[0];
      return [name, value.default];
    })
    .reduce((acc, [key, value]) => {
      acc[key] = value;
      registerTemplate(key, value);
      return acc;
    }, {} as any),
  ...Object.entries(folders)
    .map(([key, value]: any) => {
      const name = key.substring(2).replace(/\//g, "__").split(".")[0];
      return [name, value.default];
    })
    .reduce((acc, [key, value]) => {
      acc[key] = value;
      registerTemplate(key, value);
      return acc;
    }, {} as any),
};
export default both as any;
