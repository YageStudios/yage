import { afterEach, describe, expect, test } from "vitest";
import { beginFrame, endFrame, FRAME_TARGET_MS, frameAllowance, frameSpent, resetFrameBudget } from "../../engine/game/FrameBudget";

describe("FrameBudget", () => {
  afterEach(resetFrameBudget);

  test("outside a marked frame, deferrable work gets its whole cap", () => {
    expect(frameAllowance(4)).toBe(4);
    expect(frameAllowance()).toBe(Infinity);
  });

  test("builders in one frame share what is left of the target", () => {
    beginFrame(0);
    expect(frameAllowance()).toBe(FRAME_TARGET_MS);
    frameSpent(5);
    expect(frameAllowance(4)).toBe(4);
    frameSpent(5);
    expect(frameAllowance(4)).toBe(FRAME_TARGET_MS - 10);
    frameSpent(5);
    expect(frameAllowance(4)).toBe(0);
  });

  test("a frame's fixed cost (all but deferrable work) is taken off the next frames, rising at once and easing off", () => {
    beginFrame(0);
    frameSpent(3);
    endFrame(10);
    beginFrame(20);
    // 10 ms taken, 3 of them deferrable: 7 fixed.
    expect(frameAllowance()).toBe(FRAME_TARGET_MS - 7);
    endFrame(21);
    beginFrame(30);
    expect(frameAllowance()).toBeCloseTo(FRAME_TARGET_MS - (7 * 0.9 + 1 * 0.1));
  });
});
