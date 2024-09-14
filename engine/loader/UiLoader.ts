import { assignGlobalSingleton } from "yage/global";
import { getUiMapTemplate, registerTemplate } from "yage/ui/UiMap";
import sharedFetch from "yage/utils/sharedFetch";
import JSON5 from "json5";

export class UiLoader {
  uiLibrary = new Map<string, any>();

  static getInstance(): UiLoader {
    return assignGlobalSingleton("UiLoader", () => new UiLoader());
  }

  async loadUi(name: string, assetPath: string): Promise<void> {
    const map = await sharedFetch(assetPath);

    console.log(map);

    if (assetPath.endsWith(".json")) {
      registerTemplate(name, await map.json());
    } else if (assetPath.endsWith(".json5")) {
      const parsed = JSON5.parse(await map.text());
      registerTemplate(name, parsed);
    }
    this.uiLibrary.set(name, getUiMapTemplate(name));
  }

  get(name: string) {
    const resource = this.uiLibrary.get(name);
    if (!resource) {
      throw new Error(`Template resource ${name} not found`);
    }
    return resource;
  }
}
