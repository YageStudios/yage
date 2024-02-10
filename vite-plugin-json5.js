import { dataToEsm } from "@rollup/pluginutils";
import JSON5 from "json5";

// Custom json filter for vite
const jsonExtRE = /\.(jsonc|json5)$/;

const jsonLangs = `\\.(?:json|json5)(?:$|\\?)`;
const jsonLangRE = new RegExp(jsonLangs);
export const isJSONRequest = (request) => jsonLangRE.test(request);
function stripBomTag(content) {
  if (content.charCodeAt(0) === 0xfeff) {
    return content.slice(1);
  }

  return content;
}

export default function jsonPlugin(options = {}, isBuild) {
  return {
    name: "vite:json5",

    transform(json, id) {
      if (!jsonExtRE.test(id)) return null;

      json = stripBomTag(json);

      try {
        const parsed = JSON5.parse(json);
        return {
          code: dataToEsm(parsed, {
            preferConst: true,
            namedExports: options.namedExports,
          }),
          map: { mappings: "" },
        };
      } catch (e) {
        this.error(`Failed to parse JSON file.`);
      }
    },
  };
}
