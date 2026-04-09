import umilFlowTemplate from "../../assets/ui/umil/flow.json5?raw";
import umilBaseButtonTemplate from "../../assets/ui/umil/components/BaseButton.json5?raw";
import umilPrimaryButtonTemplate from "../../assets/ui/umil/components/PrimaryButton.json5?raw";
import umilSecondaryButtonTemplate from "../../assets/ui/umil/components/SecondaryButton.json5?raw";

export type BundledUiAsset = string | Record<string, unknown>;

export const bundledUiAssets = new Map<string, BundledUiAsset>([
  ["umil/flow.json5", umilFlowTemplate],
  ["umil/components/BaseButton.json5", umilBaseButtonTemplate],
  ["umil/components/PrimaryButton.json5", umilPrimaryButtonTemplate],
  ["umil/components/SecondaryButton.json5", umilSecondaryButtonTemplate],
]);
