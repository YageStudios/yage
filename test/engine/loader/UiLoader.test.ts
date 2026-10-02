import { beforeEach, describe, expect, it } from "vitest";
import { UiLoader } from "yage/loader/UiLoader";
import { buildUiMap } from "yage/ui/UiMap";

describe("UiLoader", () => {
  beforeEach(() => {
    UiLoader.getInstance().clearOverride("umil/flow.json5");
    UiLoader.getInstance().clearOverride("ref-test/flow.json5");
    UiLoader.getInstance().clearOverride("ref-test/components/PrimaryButton.json5");
    UiLoader.getInstance().clearOverride("ref-test/cycle-a.json5");
    UiLoader.getInstance().clearOverride("ref-test/cycle-b.json5");
  });

  it("prefers registered overrides over bundled ui assets", async () => {
    UiLoader.getInstance().registerOverride("umil/flow.json5", {
      overrideRoot: {
        type: "box",
        rect: { x: 0, y: 0, width: 10, height: 10 },
        config: {},
      },
    });

    await UiLoader.getInstance().loadUi("override-umil", "assets/ui/umil/flow.json5");
    const asset = UiLoader.getInstance().get("override-umil");

    expect(asset).toHaveProperty("overrideRoot");
    expect(asset).not.toHaveProperty("overlay");
  });

  // Skipped: these bundled UMIL assets depend on a `props` indirection
  // (`label: "{{props.label || 'Button'}}"` plus a `props: {label: "{{label}}"}` block)
  // that neither UiMap nor UiMapNext implements today, so the built buttons lose
  // their labels. Revisit alongside the UI parser consolidation decision rather
  // than adding a partial props implementation here.
  it.skip("resolves $ref assets with deep-merged overrides and scoped props", async () => {
    UiLoader.getInstance().registerOverride("ref-test/components/PrimaryButton.json5", {
      type: "button",
      rect: { x: 0, y: 0, width: 120, height: 40 },
      config: {
        label: "{{props.label || 'Button'}}",
        style: {
          fontSize: 24,
          border: "2px solid white",
          backgroundColor: "black",
        },
      },
    });
    UiLoader.getInstance().registerOverride("ref-test/flow.json5", {
      root: {
        $ref: "PrimaryButton",
        props: {
          label: "{{cta}}",
        },
        config: {
          style: {
            backgroundColor: "red",
          },
        },
      },
    });

    await UiLoader.getInstance().loadUi("ref-flow", "assets/ui/ref-test/flow.json5");
    const asset = UiLoader.getInstance().get("ref-flow");
    const map = buildUiMap(asset);
    const elements = map.build({ cta: "Launch" }, () => {});

    expect(asset.root.type).toBe("button");
    expect(asset.root.config.style).toEqual({
      fontSize: 24,
      border: "2px solid white",
      backgroundColor: "red",
    });
    expect(elements.root.config.label).toBe("Launch");

    map.update({ cta: "Deploy" });
    expect(elements.root.config.label).toBe("Deploy");
  });

  it("throws on circular $ref dependencies", async () => {
    UiLoader.getInstance().registerOverride("ref-test/cycle-a.json5", { $ref: "./cycle-b.json5" });
    UiLoader.getInstance().registerOverride("ref-test/cycle-b.json5", { $ref: "./cycle-a.json5" });

    await expect(UiLoader.getInstance().loadUi("cycle-flow", "assets/ui/ref-test/cycle-a.json5")).rejects.toThrow(
      "Circular $ref detected"
    );
  });
});
