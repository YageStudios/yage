import { assignGlobalSingleton } from "yage/global";
import { getUiMapTemplate, registerTemplate } from "yage/ui/UiMap";
import sharedFetch from "yage/utils/sharedFetch";
import JSON5 from "json5";

export class UiLoader {
  uiLibrary = new Map<string, any>();
  hbsLibrary = new Map<string, string>();

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
    } else if (assetPath.endsWith(".hbs")) {
      registerTemplate(name, await map.text());
    }
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
