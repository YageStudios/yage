import { afterEach, describe, expect, test, vi } from "vitest";
import { beginFrame, endFrame, FRAME_TARGET_MS, frameAllowance, frameBuildIdleMs, frameFloor, frameQuiet, frameSpent, frameStats, frameTarget, LOADING_TARGET_MS, resetFrameBudget, setFrameLoading, setFrameTarget, SPARE_AFTER_FRAMES, withinFrame, withinSpare } from "../../engine/game/FrameBudget";

describe("FrameBudget", () => {
  afterEach(() => { resetFrameBudget(); vi.restoreAllMocks(); });

  test("outside a marked frame, deferrable work gets its whole cap", () => {
    expect(frameAllowance(4)).toBe(4);
    expect(frameAllowance()).toBe(Infinity);
  });

  test("builders in one frame share what is left of the target", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
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

  test("one floor a frame, to whichever builder has waited longest: backlogs move on in turn and floors never stack", () => {
    let at = 0;
    const frame = (asks: string[]) => {
      beginFrame(at);
      frameSpent(FRAME_TARGET_MS);
      const got = asks.filter((owner) => frameFloor(owner, frameAllowance(), 5) === 5);
      endFrame(at + FRAME_TARGET_MS);
      at += 16;
      return got;
    };
    // The ground asks first each frame, but statics have waited longer by the second frame.
    expect(frame(["ground", "statics", "roofs"])).toEqual(["ground"]);
    expect(frame(["ground", "statics", "roofs"])).toEqual(["statics"]);
    expect(frame(["ground", "statics", "roofs"])).toEqual(["roofs"]);
    expect(frame(["ground", "statics", "roofs"])).toEqual(["ground"]);
    // A builder whose share covers its floor takes no floor and stops waiting.
    beginFrame(at);
    expect(frameFloor("statics", 6, 5)).toBe(6);
    expect(frameFloor("roofs", 0, 5)).toBe(5);
  });

  test("a frame whose fixed work ran past the estimate leaves only what is truly left of the target", () => {
    const real = performance.now;
    let clock = 1000;
    performance.now = () => clock;
    try {
      beginFrame(0);
      endFrame(4);
      beginFrame(16);
      // Estimate: 4 ms fixed.
      expect(frameAllowance()).toBe(FRAME_TARGET_MS - 4);
      // A spike: 9 ms of fixed work already this frame.
      clock += 9;
      expect(frameAllowance()).toBe(FRAME_TARGET_MS - 9);
    } finally { performance.now = real; }
  });

  test("the target follows the display's rate (a 120 Hz screen leaves half), unless fixed", () => {
    for (let i = 0; i <= 120; i++) { beginFrame(i * 8.33); endFrame(i * 8.33 + 1); }
    expect(frameTarget()).toBeCloseTo(8.33 * 0.72, 1);
    setFrameTarget(10);
    expect(frameTarget()).toBe(10);
    setFrameTarget(null);
    resetFrameBudget();
    for (let i = 0; i <= 120; i++) { beginFrame(i * 16.7); endFrame(i * 16.7 + 1); }
    expect(frameTarget()).toBe(FRAME_TARGET_MS);
  });

  test("the readout gives interval percentiles and each named builder's spend", () => {
    const real = performance.now;
    let clock = 0;
    performance.now = () => clock;
    try {
      for (let i = 0; i < 10; i++) {
        beginFrame(i * 16);
        withinFrame(4, () => { clock += i === 9 ? 3 : 1; }, "ground");
        endFrame(i * 16 + 5);
      }
      beginFrame(160);
      const stats = frameStats();
      expect(stats.p50).toBe(16);
      expect(stats.stages.ground.frames).toBe(10);
      expect(stats.stages.ground.max).toBe(3);
      expect(stats.stages.ground.mean).toBeCloseTo(1.2);
    } finally { performance.now = real; }
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
