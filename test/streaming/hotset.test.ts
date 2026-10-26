import { describe, expect, test } from "vitest";
import { HotSet, spaceChunkKey } from "../../engine/streaming";

const keys = (list: [number, number][], space = 0) => list.map(([cx, cy]) => spaceChunkKey(space, cx, cy)).sort((a, b) => a - b);

describe("HotSet", () => {
  test("a focus heats its bounds and ring; another focus adds its own; a chunk cools once every focus is past it", () => {
    const set = new HotSet();
    const a = { minX: 2.2, minY: 2.2, maxX: 2.8, maxY: 2.8, ring: 0 };
    expect(set.update([a])).toEqual({ heat: keys([[2, 2]]), cool: [] });
    // A second player's view far off: both are hot at once.
    const b = { minX: 10.5, minY: 0.5, maxX: 10.5, maxY: 0.5, ring: 1 };
    const both = set.update([a, b]);
    expect(both.heat).toEqual(keys([[9, -1], [10, -1], [11, -1], [9, 0], [10, 0], [11, 0], [9, 1], [10, 1], [11, 1]]));
    expect(both.cool).toEqual([]);
    // The first view nudges east within the hysteresis: its old chunk stays, the new one heats.
    const nudged = { ...a, minX: 3.1, maxX: 3.3 };
    expect(set.update([nudged, b])).toEqual({ heat: keys([[3, 2]]), cool: [] });
    // Further on, the old chunk cools; the second player leaving cools all of theirs.
    const moved = { ...a, minX: 3.6, maxX: 3.8 };
    expect(set.update([moved])).toEqual({ heat: [], cool: keys([[2, 2], [9, -1], [10, -1], [11, -1], [9, 0], [10, 0], [11, 0], [9, 1], [10, 1], [11, 1]]) });
    expect([...set.hot]).toEqual(keys([[3, 2]]));
  });

  test("foci keep to their space, and only chunks that exist heat", () => {
    const set = new HotSet({ exists: (space, cx) => space === 1 || cx >= 0 });
    const out = set.update([{ minX: -0.5, minY: 0.5, maxX: 0.5, maxY: 0.5, ring: 0 }, { space: 1, minX: 0.5, minY: 0.5, maxX: 0.5, maxY: 0.5, ring: 0 }]);
    expect(out.heat).toEqual([...keys([[0, 0]]), ...keys([[0, 0]], 1)].sort((a, b) => a - b));
    // The space-0 focus gone: only its chunk cools.
    expect(set.update([{ space: 1, minX: 0.5, minY: 0.5, maxX: 0.5, maxY: 0.5, ring: 0 }]).cool).toEqual(keys([[0, 0]]));
  });
});
