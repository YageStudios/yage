import { assignGlobalSingleton } from "yage/global";
import { getUiMapTemplate, registerTemplate } from "yage/ui/UiMap";
import sharedFetch from "yage/utils/sharedFetch";
import JSON5 from "json5";
import { cloneDeep, get } from "lodash";
import { bundledUiAssets, type BundledUiAsset } from "./BundledUiAssets";

export class UiLoader {
  uiLibrary = new Map<string, any>();
  hbsLibrary = new Map<string, string>();
  private uiOverrides = new Map<string, BundledUiAsset>();
  private rawUiAssetCache = new Map<string, Promise<any>>();
  private resolvedUiAssetCache = new Map<string, Promise<any>>();

  static getInstance(): UiLoader {
    return assignGlobalSingleton("UiLoader", () => new UiLoader());
  }

  registerOverride(path: string, asset: BundledUiAsset): void {
    this.uiOverrides.set(this.normalizeAssetPath(path), asset);
    this.rawUiAssetCache.clear();
    this.resolvedUiAssetCache.clear();
  }

  clearOverride(path: string): void {
    this.uiOverrides.delete(this.normalizeAssetPath(path));
    this.rawUiAssetCache.clear();
    this.resolvedUiAssetCache.clear();
  }

  private normalizeAssetPath(assetPath: string): string {
    return assetPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^assets\/ui\//, "").replace(/\/+/g, "/");
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

  private isJsonUiAsset(assetPath: string): boolean {
    return assetPath.endsWith(".json") || assetPath.endsWith(".json5") || assetPath.endsWith(".jsonc");
  }

  private hasExtension(assetPath: string): boolean {
    return /\.[^/.]+$/.test(assetPath);
  }

  private dirname(assetPath: string): string {
    const normalized = this.normalizeAssetPath(assetPath);
    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash === -1 ? "" : normalized.slice(0, lastSlash);
  }

  private joinAssetPath(...parts: string[]): string {
    const raw = parts
      .filter(Boolean)
      .join("/")
      .replace(/\/+/g, "/");
    const segments: string[] = [];

    raw.split("/").forEach((segment) => {
      if (!segment || segment === ".") {
        return;
      }
      if (segment === "..") {
        segments.pop();
        return;
      }
      segments.push(segment);
    });

    return this.normalizeAssetPath(segments.join("/"));
  }

  private listRefCandidates(currentAssetPath: string, rawRef: string): string[] {
    const [refPath, fragment] = rawRef.split("#", 2);
    const normalizedRef = refPath.replace(/\\/g, "/").replace(/^\/+/, "");
    const currentDir = this.dirname(currentAssetPath);
    const candidates: string[] = [];
    const pushCandidate = (candidatePath: string) => {
      const normalized = this.normalizeAssetPath(candidatePath);
      const withFragment = fragment ? `${normalized}#${fragment}` : normalized;
      if (!candidates.includes(withFragment)) {
        candidates.push(withFragment);
      }
    };
    const pushPathVariants = (candidatePath: string) => {
      if (!this.hasExtension(candidatePath)) {
        pushCandidate(`${candidatePath}.json5`);
        pushCandidate(candidatePath);
        return;
      }
      pushCandidate(candidatePath);
    };

    if (normalizedRef.startsWith("./") || normalizedRef.startsWith("../")) {
      pushPathVariants(this.joinAssetPath(currentDir, normalizedRef));
      return candidates;
    }

    pushPathVariants(normalizedRef);
    if (currentDir) {
      pushPathVariants(this.joinAssetPath(currentDir, normalizedRef));
    }

    if (!normalizedRef.includes("/")) {
      if (currentDir) {
        pushPathVariants(this.joinAssetPath(currentDir, "components", normalizedRef));
      }
      pushPathVariants(this.joinAssetPath("components", normalizedRef));
    }

    return candidates;
  }

  private isMergeableObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  private deepMergeUi(template: any, overrides: any): any {
    if (overrides === undefined) {
      return cloneDeep(template);
    }
    if (template === undefined) {
      return cloneDeep(overrides);
    }
    if (Array.isArray(template) || Array.isArray(overrides)) {
      return cloneDeep(overrides);
    }
    if (this.isMergeableObject(template) && this.isMergeableObject(overrides)) {
      const merged: Record<string, unknown> = cloneDeep(template);
      Object.entries(overrides).forEach(([key, value]) => {
        merged[key] = key in merged ? this.deepMergeUi(merged[key], value) : cloneDeep(value);
      });
      return merged;
    }
    return cloneDeep(overrides);
  }

  private async loadRawUiAsset(assetPath: string): Promise<any> {
    const normalizedAssetPath = this.normalizeAssetPath(assetPath);
    const cached = this.rawUiAssetCache.get(normalizedAssetPath);
    if (cached) {
      return cached;
    }

    const pending = (async () => {
      const overrideAsset = this.uiOverrides.get(normalizedAssetPath);
      const bundledAsset = bundledUiAssets.get(normalizedAssetPath);

      if (overrideAsset !== undefined) {
        return this.parseAsset(normalizedAssetPath, overrideAsset);
      }

      if (bundledAsset !== undefined) {
        return this.parseAsset(normalizedAssetPath, bundledAsset);
      }

      const response = await sharedFetch(`assets/ui/${normalizedAssetPath}`);
      if (normalizedAssetPath.endsWith(".json")) {
        return response.json();
      }
      if (normalizedAssetPath.endsWith(".json5") || normalizedAssetPath.endsWith(".jsonc")) {
        return JSON5.parse(await response.text());
      }
      if (normalizedAssetPath.endsWith(".hbs")) {
        return response.text();
      }
      return response.text();
    })();

    this.rawUiAssetCache.set(normalizedAssetPath, pending);
    return pending;
  }

  private async resolveUiRef(rawRef: string, currentAssetPath: string, stack: string[]): Promise<any> {
    const candidates = this.listRefCandidates(currentAssetPath, rawRef);
    let lastError: unknown = null;

    for (const candidate of candidates) {
      const [candidatePath, fragment] = candidate.split("#", 2);
      try {
        const resolvedAsset = await this.resolveUiAsset(candidatePath, stack);
        if (typeof resolvedAsset === "string") {
          throw new Error(`UiLoader: $ref "${rawRef}" resolved to non-JSON asset "${candidatePath}".`);
        }
        if (!fragment) {
          return resolvedAsset;
        }

        const fragmentValue = get(resolvedAsset, fragment);
        if (fragmentValue === undefined) {
          throw new Error(`UiLoader: $ref "${rawRef}" fragment "${fragment}" was not found in "${candidatePath}".`);
        }
        return cloneDeep(fragmentValue);
      } catch (error) {
        lastError = error;
      }
    }

    throw (
      lastError ??
      new Error(`UiLoader: Unable to resolve $ref "${rawRef}" from "${currentAssetPath}".`)
    );
  }

  private async resolveUiNode(node: any, currentAssetPath: string, stack: string[]): Promise<any> {
    if (Array.isArray(node)) {
      return Promise.all(node.map((entry) => this.resolveUiNode(entry, currentAssetPath, stack)));
    }

    if (!node || typeof node !== "object") {
      return node;
    }

    let resolvedNode = cloneDeep(node);
    if ("$ref" in resolvedNode && typeof resolvedNode.$ref === "string") {
      const { $ref, ...overrides } = resolvedNode;
      const template = await this.resolveUiRef($ref, currentAssetPath, stack);
      resolvedNode = this.deepMergeUi(template, overrides);
    }

    const nextNode: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(resolvedNode)) {
      nextNode[key] = await this.resolveUiNode(value, currentAssetPath, stack);
    }
    return nextNode;
  }

  private async resolveUiAsset(assetPath: string, stack: string[] = []): Promise<any> {
    const normalizedAssetPath = this.normalizeAssetPath(assetPath);
    if (stack.includes(normalizedAssetPath)) {
      throw new Error(`UiLoader: Circular $ref detected: ${[...stack, normalizedAssetPath].join(" -> ")}`);
    }

    const cached = this.resolvedUiAssetCache.get(normalizedAssetPath);
    if (cached) {
      return cloneDeep(await cached);
    }

    const pending = (async () => {
      const parsed = await this.loadRawUiAsset(normalizedAssetPath);
      if (!this.isJsonUiAsset(normalizedAssetPath)) {
        return parsed;
      }
      return this.resolveUiNode(parsed, normalizedAssetPath, [...stack, normalizedAssetPath]);
    })();

    this.resolvedUiAssetCache.set(normalizedAssetPath, pending);
    return cloneDeep(await pending);
  }

  async loadUi(name: string, assetPath: string): Promise<void> {
    const normalizedAssetPath = this.normalizeAssetPath(assetPath);
    const parsed = await this.resolveUiAsset(normalizedAssetPath);

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
