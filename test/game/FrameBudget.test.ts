import { afterEach, describe, expect, test } from "vitest";
import { beginFrame, endFrame, FRAME_TARGET_MS, frameAllowance, frameBuildIdleMs, frameQuiet, frameSpent, LOADING_TARGET_MS, resetFrameBudget, setFrameLoading, SPARE_AFTER_FRAMES, withinSpare } from "../../engine/game/FrameBudget";

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

  test("while loading, builders get the long loading frame whatever their caps", () => {
    setFrameLoading(true);
    beginFrame(0);
    expect(frameAllowance(3)).toBe(LOADING_TARGET_MS);
    frameSpent(30);
    expect(frameAllowance(3)).toBe(LOADING_TARGET_MS - 30);
    endFrame(35);
    setFrameLoading(false);
    beginFrame(40);
    expect(frameAllowance(3)).toBe(3);
  });

  test("quiet frames count up while builders idle and frames are short, and a busy or slow frame starts the count over", () => {
    const frame = (at: number, built = 0) => { beginFrame(at); frameSpent(built); endFrame(at + 5); };
    frame(0);
    frame(16);
    frame(32);
    beginFrame(48);
    expect(frameQuiet()).toBe(3);
    frameSpent(4);
    endFrame(53);
    frame(64);
    expect(frameQuiet()).toBe(0);
    frame(80);
    frame(140);
    expect(frameQuiet()).toBe(0);
    frame(156);
    expect(frameQuiet()).toBe(1);
  });

  test("spare work runs only after a run of quiet frames, and its own time keeps the run going while any other build breaks it", () => {
    let at = 0;
    const frame = (built = 0) => { beginFrame(at); frameSpent(built); endFrame(at + 5); at += 16; };
    const ran: number[] = [];
    const tryWork = () => withinSpare(4, (budget) => { ran.push(budget); frameSpent(0); });
    for (let i = 0; i < SPARE_AFTER_FRAMES; i++) frame();
    beginFrame(at);
    expect(withinSpare(4, () => {})).toBe(true);
    endFrame(at + 5); at += 16;
    beginFrame(at);
    // A zoom's streaming build breaks the run: no spare work until it is quiet again.
    frameSpent(3);
    endFrame(at + 5); at += 16;
    beginFrame(at);
    expect(tryWork()).toBe(false);
    endFrame(at + 5); at += 16;
    for (let i = 0; i < SPARE_AFTER_FRAMES - 1; i++) frame();
    beginFrame(at);
    expect(tryWork()).toBe(true);
    expect(ran).toEqual([4]);
  });

  test("outside a marked frame, spare work runs with its cap", () => {
    let budget = 0;
    expect(withinSpare(4, (b) => { budget = b; })).toBe(true);
    expect(budget).toBe(4);
  });
});


test("build idleness measures elapsed time independently of a slow renderer and resets on new work", () => {
  resetFrameBudget();
  expect(frameBuildIdleMs()).toBe(0);
  beginFrame(0); endFrame(400);
  beginFrame(425); endFrame(825);
  beginFrame(850);
  expect(frameQuiet()).toBe(0);
  expect(frameBuildIdleMs()).toBe(850);
  frameSpent(2);
  expect(frameBuildIdleMs()).toBe(0);
  endFrame(1250);
  beginFrame(1275);
  expect(frameBuildIdleMs()).toBe(0);
  endFrame(1675);
  beginFrame(1700);
  expect(frameBuildIdleMs()).toBe(425);
  resetFrameBudget();
  expect(frameBuildIdleMs()).toBe(0);
});
