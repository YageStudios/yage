import { beforeEach, describe, expect, it, vi } from "vitest";
import { UiLoader } from "yage/loader/UiLoader";
import { buildUiMap } from "yage/ui/UiMap";

describe("UiLoader", () => {
  beforeEach(() => {
    UiLoader.getInstance().clearOverride("umil/flow.json5");
    UiLoader.getInstance().clearOverride("ref-test/flow.json5");
    UiLoader.getInstance().clearOverride("ref-test/components/PrimaryButton.json5");
    UiLoader.getInstance().clearOverride("ref-test/cycle-a.json5");
    UiLoader.getInstance().clearOverride("ref-test/cycle-b.json5");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1920 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1080 });
  });

  it("loads bundled ui assets from assets/ui", async () => {
    await UiLoader.getInstance().loadUi("bundled-umil", "assets/ui/umil/flow.json5");
    expect(UiLoader.getInstance().get("bundled-umil")).toHaveProperty("overlay");
  });

  it("builds bundled UMIL main menu actions from $ref components", async () => {
    await UiLoader.getInstance().loadUi("bundled-umil-build", "assets/ui/umil/flow.json5");
    const asset = UiLoader.getInstance().get("bundled-umil-build");
    const map = buildUiMap(asset);
    const handler = vi.fn();
    const elements = map.build(
      {
        appName: "Tic Tac Toe",
        step: "MAIN_MENU",
        mainMenuActions: [
          { action: "selectLocal", label: "Play Local", disabled: false },
          { action: "selectHost", label: "Host Online Game", disabled: false },
          { action: "selectJoin", label: "Join via Room Code", disabled: false },
        ],
      },
      handler
    );

    const overlayChildren = elements.overlay?._config?.children ?? [];
    expect(overlayChildren.length).toBe(1);

    const breakpointWrapperChildren = overlayChildren[0]?._config?.children ?? [];
    expect(breakpointWrapperChildren.length).toBe(1);

    const mainMenuChildren = breakpointWrapperChildren[0]?._config?.children ?? [];
    expect(mainMenuChildren.length).toBe(2);

    const actionStackChildren = mainMenuChildren[1]?._config?.children ?? [];
    expect(actionStackChildren.length).toBe(3);
    expect(actionStackChildren.map((child: any) => child._config?.label)).toEqual([
      "Play Local",
      "Host Online Game",
      "Join via Room Code",
    ]);
    expect(actionStackChildren.map((child: any) => child._config?.layoutRect?.width)).toEqual([300, 300, 300]);
    expect(actionStackChildren.every((child: any) => (child._config?.layoutRect?.y ?? -1) >= 0)).toBe(true);

    actionStackChildren[0]?._config?.onClick?.(0);
    expect(handler).toHaveBeenCalledWith(
      0,
      "selectLocal",
      "click",
      expect.objectContaining({
        action: "selectLocal",
        label: "Play Local",
        props: { label: "Play Local" },
      })
    );
  });

  it("builds bundled UMIL portrait main menu actions from $ref components", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1280 });

    await UiLoader.getInstance().loadUi("bundled-umil-portrait", "assets/ui/umil/flow.json5");
    const asset = UiLoader.getInstance().get("bundled-umil-portrait");
    const map = buildUiMap(asset);
    const elements = map.build(
      {
        appName: "Tic Tac Toe",
        step: "MAIN_MENU",
        mainMenuActions: [
          { action: "selectLocal", label: "Play Local", disabled: false },
          { action: "selectHost", label: "Host Online Game", disabled: false },
          { action: "selectJoin", label: "Join via Room Code", disabled: false },
        ],
      },
      () => {}
    );

    const overlayChildren = elements.overlay?._config?.children ?? [];
    const breakpointWrapperChildren = overlayChildren[0]?._config?.children ?? [];
    const mainMenuChildren = breakpointWrapperChildren[0]?._config?.children ?? [];
    const actionStackChildren = mainMenuChildren[1]?._config?.children ?? [];

    expect(actionStackChildren.length).toBe(3);
    expect(actionStackChildren.map((child: any) => child._config?.label)).toEqual([
      "Play Local",
      "Host Online Game",
      "Join via Room Code",
    ]);
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

  it("resolves $ref assets with deep-merged overrides and scoped props", async () => {
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
    expect(elements.root._config.label).toBe("Launch");

    map.update({ cta: "Deploy" });
    expect(elements.root._config.label).toBe("Deploy");
  });

  it("throws on circular $ref dependencies", async () => {
    UiLoader.getInstance().registerOverride("ref-test/cycle-a.json5", { $ref: "./cycle-b.json5" });
    UiLoader.getInstance().registerOverride("ref-test/cycle-b.json5", { $ref: "./cycle-a.json5" });

    await expect(UiLoader.getInstance().loadUi("cycle-flow", "assets/ui/ref-test/cycle-a.json5")).rejects.toThrow(
      "Circular $ref detected"
    );
  });
});
