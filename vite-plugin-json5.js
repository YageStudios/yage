// Kept for older in-repository configs. New games use `yage/vite`.
export { yageJson5 as default } from "./tooling/vite.mjs";
export const isJSONRequest = (request) => /\.(?:json|jsonc|json5)(?:$|\?)/.test(request);
