import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.unmock("pixi.js");
import * as PIXI from "pixi.js";
import { ProjectedCamera } from "../../engine/systems/render/ProjectedCamera";

// Exercise the real PIXI Float32 batch buffer, not a double-precision substitute.
class BatchProbe extends PIXI.Graphics {
  screen: number[] = [];
  override render(renderer: PIXI.Renderer) {
    this.geometry.updateBatches();
    this._populateBatches();
    this.calculateVertices();
    const m = renderer.projection.projectionMatrix;
    for (let i = 0; i < this.vertexData.length; i += 2) {
      const p = m.apply(
        new PIXI.Point(this.vertexData[i], this.vertexData[i + 1])
      );
      this.screen.push(p.x, p.y);
    }
  }
}
const white = new PIXI.Texture(
  PIXI.BaseTexture.fromBuffer(new Uint8Array(16).fill(255), 2, 2)
);
const descriptor = Object.getOwnPropertyDescriptor(PIXI.Texture, "WHITE")!;
beforeAll(() => {
  Object.defineProperty(PIXI.Texture, "WHITE", {
    get: () => white,
    configurable: true,
  });
});
afterAll(() => {
  Object.defineProperty(PIXI.Texture, "WHITE", descriptor);
  white.destroy(true);
});
const renderer = () =>
  ({
    projection: { projectionMatrix: new PIXI.Matrix() },
    batch: { flush: vi.fn() },
    globalUniforms: { update: vi.fn() },
    shader: { shader: null },
  } as unknown as PIXI.Renderer);
const scene = () => {
  const stage = new PIXI.Container();
  stage.parent = new PIXI.Container();
  const camera = stage.addChild(new ProjectedCamera());
  return { stage, camera };
};

it("preserves the actual DC facade slope and wall depth in distant frame1", () => {
  const { stage, camera } = scene(),
    probe = camera.addChild(new BatchProbe());
  const x = 160287.82791162,
    y = 352296904.703,
    angle = 0.015113467157278166,
    scale = 1.0002084957071022,
    len = 588.6017921019727,
    rise = 105;
  probe.beginFill(0xffffff).drawRect(0, 0, len, rise).endFill();
  probe.position.set(x, y);
  probe.rotation = angle;
  probe.skew.x = angle;
  probe.scale.set(scale);
  camera.setView(2.394, -x * 2.394, -y * 2.394);
  stage.updateTransform();
  camera.render(renderer());
  try {
    expect(probe.screen[3] - probe.screen[1]).toBeCloseTo(
      Math.sin(angle) * len * scale * 2.394,
      2
    );
    expect(probe.screen[5] - probe.screen[1]).toBeCloseTo(
      rise * scale * 2.394,
      2
    );
  } finally {
    stage.destroy({ children: true });
  }
});

it("keeps ordinary pans in the projection without invalidating child transforms", () => {
  const { stage, camera } = scene(),
    child = camera.addChild(new PIXI.Container());
  camera.setView(4, 0, -352296904 * 4);
  stage.updateTransform();
  const id = child.transform._worldID;
  for (let i = 0; i < 500; i++) {
    camera.setView(4, -i, -352296904 * 4 - i);
    stage.updateTransform();
    expect(child.transform._worldID).toBe(id);
  }
  stage.destroy({ children: true });
});

it("keeps the public view unchanged and restores projection after rendering with a transformed parent", () => {
  const { stage, camera } = scene();
  stage.position.set(17, -31);
  stage.rotation = 0.2;
  stage.scale.set(1.2, 0.8);
  const child = camera.addChild(new BatchProbe());
  child.beginFill(0xffffff).drawRect(0, 0, 10, 10).endFill();
  child.position.set(160000, 352296900);
  camera.setView(4, -640000, -352296900 * 4);
  stage.updateTransform();
  const r = renderer();
  r.projection.projectionMatrix.set(0.01, 0, 0, -0.02, -1, 1);
  const before = r.projection.projectionMatrix.clone();
  camera.render(r);
  expect(camera.view).toMatchObject({
    a: 4,
    d: 4,
    tx: -640000,
    ty: -352296900 * 4,
  });
  expect(r.projection.projectionMatrix).toEqual(before);
  const expected = before.apply(
    stage.worldTransform.apply(new PIXI.Point(0, 0))
  );
  expect(child.screen[0]).toBeCloseTo(expected.x, 3);
  expect(child.screen[1]).toBeCloseTo(expected.y, 3);
  camera.visible = false;
  camera.render(r);
  expect(r.projection.projectionMatrix).toEqual(before);
  stage.destroy({ children: true });
});

it.each([-1, 1])(
  "rebases continuously across the precision boundary in direction %s",
  (sign) => {
    const { stage, camera } = scene();
    const child = camera.addChild(new BatchProbe());
    child.beginFill(0xffffff).drawRect(0, 0, 10, 10).endFill();
    child.position.set(sign * 131073, sign * 131073);
    for (const focus of [131071, 131072, 131073, 131074]) {
      child.screen = [];
      camera.setView(1, -sign * focus, -sign * focus);
      stage.updateTransform();
      camera.render(renderer());
      expect(child.screen[0]).toBeCloseTo(sign * (131073 - focus), 5);
      expect(child.screen[1]).toBeCloseTo(sign * (131073 - focus), 5);
    }
    stage.destroy({ children: true });
  }
);

it("leaves zero zoom finite and skips hidden or unrenderable cameras", () => {
  const camera = new ProjectedCamera(),
    r = renderer();
  camera.setView(0, 0, 0);
  expect(camera.position.x).toBe(0);
  expect(camera.position.y).toBe(0);
  for (const state of [
    { visible: false, worldAlpha: 1, renderable: true },
    { visible: true, worldAlpha: 0, renderable: true },
    { visible: true, worldAlpha: 1, renderable: false },
  ]) {
    Object.assign(camera, state);
    camera.render(r);
    expect(r.batch.flush).not.toHaveBeenCalled();
  }
  Object.assign(camera, { visible: true, worldAlpha: 1, renderable: true });
  camera.setView(1, 0, 0);
  camera.render(r);
  expect(r.projection.projectionMatrix).toEqual(new PIXI.Matrix());
  camera.destroy();
});

it("carries the rebased camera through shadow/light offscreen passes and restores its projection", async () => {
  const { renderInto } = await import("../../engine/streaming/window-light");
  const { stage, camera } = scene();
  camera.setView(4, -640000, -352296900 * 4);
  stage.updateTransform();
  const r = renderer(),
    base = new PIXI.Matrix(0.002, 0, 0, -0.003, -1, 1);
  r.projection.projectionMatrix.copyFrom(base);
  const source = new PIXI.Rectangle(0, 0, 1687, 1067),
    destination = source.clone();
  Object.assign(r, {
    renderTexture: {
      current: undefined,
      sourceFrame: source,
      destinationFrame: destination,
      bind: () => r.projection.projectionMatrix.copyFrom(base),
      clear: vi.fn(),
    },
  });
  const uniforms = { globals: {} };
  r.shader.shader = { uniforms } as never;
  r.shader.syncUniformGroup = vi.fn();
  const child = camera.addChild(new PIXI.Container());
  child.render = () => {
    const screen = r.projection.projectionMatrix.clone();
    renderInto(r, {} as PIXI.RenderTexture, [0, 0, 0, 0], () => {
      expect(r.projection.projectionMatrix).toEqual(screen);
      // Height/depth shaders multiply these same matrices for geometry and its ground foot.
      const clip = screen
        .clone()
        .append(camera.worldTransform)
        .apply(new PIXI.Point(160000, 352296900));
      expect(clip.x).toBeCloseTo(-1, 5);
      expect(clip.y).toBeCloseTo(1, 5);
    });
    expect(r.projection.projectionMatrix).toEqual(screen);
  };
  camera.render(r);
  expect(r.projection.projectionMatrix).toEqual(base);
  expect(r.shader.syncUniformGroup).toHaveBeenCalled();
  stage.destroy({ children: true });
});
