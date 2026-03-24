import { assignGlobalSingleton } from "yage/global";
import { getUiMapTemplate, registerTemplate } from "yage/ui/UiMap";
import sharedFetch from "yage/utils/sharedFetch";
import JSON5 from "json5";
import { bundledUiAssets, type BundledUiAsset } from "./BundledUiAssets";

export class UiLoader {
  uiLibrary = new Map<string, any>();
  hbsLibrary = new Map<string, string>();
  private uiOverrides = new Map<string, BundledUiAsset>();

  static getInstance(): UiLoader {
    return assignGlobalSingleton("UiLoader", () => new UiLoader());
  }

  registerOverride(path: string, asset: BundledUiAsset): void {
    this.uiOverrides.set(this.normalizeAssetPath(path), asset);
  }

  clearOverride(path: string): void {
    this.uiOverrides.delete(this.normalizeAssetPath(path));
  }

  private normalizeAssetPath(assetPath: string): string {
    return assetPath.replace(/^\/+/, "").replace(/^assets\/ui\//, "");
  }

  private parseAsset(assetPath: string, asset: BundledUiAsset): any {
    if (typeof asset !== "string") {
      return asset;
    }
    if (assetPath.endsWith(".json")) {
      return JSON.parse(asset);
    }
    if (assetPath.endsWith(".json5") || assetPath.endsWith(".jsonc")) {
      return JSON5.parse(asset);
    }
    return asset;
  }

  async loadUi(name: string, assetPath: string): Promise<void> {
    const normalizedAssetPath = this.normalizeAssetPath(assetPath);
    const overrideAsset = this.uiOverrides.get(normalizedAssetPath);
    const bundledAsset = bundledUiAssets.get(normalizedAssetPath);
    let parsed: any;

    if (overrideAsset !== undefined) {
      parsed = this.parseAsset(normalizedAssetPath, overrideAsset);
    } else if (bundledAsset !== undefined) {
      parsed = this.parseAsset(normalizedAssetPath, bundledAsset);
    } else {
      const map = await sharedFetch(assetPath);

      if (assetPath.endsWith(".json")) {
        parsed = await map.json();
      } else if (assetPath.endsWith(".json5") || assetPath.endsWith(".jsonc")) {
        parsed = JSON5.parse(await map.text());
      } else if (assetPath.endsWith(".hbs")) {
        parsed = await map.text();
      }
    }

    registerTemplate(name, parsed);
    this.uiLibrary.set(name, getUiMapTemplate(name));
    this.hbsLibrary.set(name, getUiMapTemplate(name));
  }

  get(name: string) {
    const resource = this.uiLibrary.get(name);
    if (!resource) {
      throw new Error(`Template resource ${name} not found`);
    }
    return resource;
  }

  getHbs(name: string) {
    const resource = this.hbsLibrary.get(name);
    if (!resource) {
      throw new Error(`Hbs resource ${name} not found`);
    }
    return resource;
  }
}
