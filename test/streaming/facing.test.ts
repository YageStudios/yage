import { describe, expect, it } from "vitest";
import { Facings, lookFrom } from "../../engine/streaming/facing";
// LOOK (layer.ts), without pixi.
const LOOK = { Front: 0, Right: 1, Back: 2, Left: 3 } as const;

describe("Facings", () => {
  it("turns the way an entity walks once it has gone a step, and holds it standing", () => {
    const f = new Facings(3);
    expect(f.move(7, 0, 0)).toBe(LOOK.Front);
    expect(f.move(7, 2, 0)).toBe(LOOK.Front);
    expect(f.move(7, 4, 0)).toBe(LOOK.Right);
    // Standing still (the same spot, frame after frame) never snaps it back to the viewer.
    for (let i = 0; i < 10; i++) expect(f.move(7, 4, 0)).toBe(LOOK.Right);
    expect(f.move(7, 4, -5)).toBe(LOOK.Back);
    expect(f.move(7, -1, -5)).toBe(LOOK.Left);
    expect(f.move(7, -1, 0)).toBe(LOOK.Front);
    expect(f.look(7)).toBe(LOOK.Front);
    expect(f.look(8)).toBe(LOOK.Front);
  });

  it("keeps its way near a diagonal, and a jump turns it nowhere", () => {
    expect(lookFrom(1, 1.5, LOOK.Right)).toBe(LOOK.Right);
    expect(lookFrom(1, 1.5, LOOK.Front)).toBe(LOOK.Front);
    expect(lookFrom(-1, -1.5, LOOK.Back)).toBe(LOOK.Back);
    const f = new Facings(3);
    f.move(1, 0, 0);
    f.move(1, 10, 0);
    expect(f.move(1, 10, 500)).toBe(LOOK.Right);
  });
});
