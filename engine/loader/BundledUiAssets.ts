import umilFlowTemplate from "../../assets/ui/umil/flow.json5?raw";

export type BundledUiAsset = string | Record<string, unknown>;

export const bundledUiAssets = new Map<string, BundledUiAsset>([["umil/flow.json5", umilFlowTemplate]]);
