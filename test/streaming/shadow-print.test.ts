import * as PIXI from "pixi.js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FramePrint } from "yage/streaming/frame-print";
import { printObject, sendsAhead } from "yage/streaming/shadow-pass";
vi.unmock("pixi.js");

beforeAll(() => {
  class Canvas {
    width = 0;
    height = 0;
    getContext = (kind: string) => (kind === "2d" ? { fillStyle: "", fillRect() {} } : null);
  }
  vi.stubGlobal("HTMLCanvasElement", Canvas);
  vi.stubGlobal("document", { createElement: () => new Canvas() });
});

const meshOf = () => {
  const program = PIXI.Program.from("void main(){}", "void main(){}", "test-print");
  // What a compile would leave: the shader's one active uniform.
  (program as unknown as { uniformData: object }).uniformData = { uAlpha: {} };
  const geometry = new PIXI.Geometry().addAttribute("aV", [0, 0, 1, 0, 1, 1], 2);
  const mesh = new PIXI.Mesh(geometry, new PIXI.Shader(program, { uAlpha: 1 }));
  const parent = mesh.enableTempParent();
  mesh.updateTransform();
  mesh.disableTempParent(parent);
  return mesh;
};
const frames = (print: FramePrint, mesh: PIXI.Mesh<PIXI.Shader>, n: number) => {
  const same: boolean[] = [];
  for (let i = 0; i < n; i++) {
    print.begin();
    printObject(print, mesh);
    same.push(print.end());
  }
  return same;
};

describe("printObject", () => {
  it("keeps a still mesh from its second frame", () => {
    expect(frames(new FramePrint(), meshOf(), 3)).toEqual([false, true, true]);
  });

  it("can't see into a mesh with a draw of its own", () => {
    const mesh = meshOf();
    const render = (mesh as any)._render.bind(mesh);
    (mesh as any)._render = (r: PIXI.Renderer) => render(r);
    expect(frames(new FramePrint(), mesh, 3)).toEqual([false, false, false]);
  });

  it("sees into one that sends data up ahead of Mesh's draw, by its count of what it sent", () => {
    const mesh = meshOf();
    let sent = 0;
    const render = (mesh as any)._render.bind(mesh);
    (mesh as any)._render = (r: PIXI.Renderer) => render(r);
    sendsAhead(mesh, () => sent);
    const print = new FramePrint();
    expect(frames(print, mesh, 3)).toEqual([false, true, true]);
    sent++;
    expect(frames(print, mesh, 2)).toEqual([false, true]);
  });
});
