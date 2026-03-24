import { beforeEach, describe, expect, it } from "vitest";
import { UiLoader } from "yage/loader/UiLoader";

describe("UiLoader", () => {
  beforeEach(() => {
    UiLoader.getInstance().clearOverride("umil/flow.json5");
  });

  it("loads bundled ui assets from assets/ui", async () => {
    await UiLoader.getInstance().loadUi("bundled-umil", "assets/ui/umil/flow.json5");
    expect(UiLoader.getInstance().get("bundled-umil")).toHaveProperty("overlay");
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
});
