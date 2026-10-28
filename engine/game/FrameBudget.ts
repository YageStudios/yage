/**
 * One frame's room for deferrable work: streaming builds (art for chunks coming into view, ground
 * paint, prefab parts) that may wait a frame without anything going wrong. Each builder asks how
 * much it may spend (`frameAllowance`), works within that, then reports what it spent
 * (`frameSpent`), so several builders in one frame share one budget instead of each spending its
 * own and stacking past the frame.
 *
 * The room is the frame target less the frame's fixed cost (everything that is not deferrable:
 * simulation, drawing, render), estimated from recent frames, less what builders have spent so
 * far this frame. The fixed estimate rises at once and falls slowly, so a heavy stretch (a battle
 * on screen) leaves builders little until it eases. LeanGameModel.run marks each frame; a loop that
 * does not use it calls beginFrame and endFrame itself.
 *
 * Import as `yage/game/FrameBudget`.
 */

/** The frame time builders fill up to (ms): a 60 Hz frame, less headroom for the compositor and GC. */
export const FRAME_TARGET_MS = 12;

let started = -1;
let spent = 0;
let fixed = 0;

/** Marks a frame's start. */
export const beginFrame = (now = performance.now()) => {
  started = now;
  spent = 0;
};

/** Marks a frame's end: what it took, less what builders spent, is the fixed cost the next frames expect. */
export const endFrame = (now = performance.now()) => {
  if (started < 0) return;
  const cost = Math.max(0, now - started - spent);
  fixed = cost > fixed ? cost : fixed * 0.9 + cost * 0.1;
  started = -1;
};

/**
 * Milliseconds deferrable work may take now, at most `cap`. Outside a marked frame (tests, tools)
 * it is `cap`. Callers still make at least one step of progress per run when it is 0.
 */
export const frameAllowance = (cap = Infinity) => {
  if (started < 0) return cap;
  return Math.max(0, Math.min(cap, FRAME_TARGET_MS - fixed - spent));
};

/** Reports `ms` of deferrable work done this frame. */
export const frameSpent = (ms: number) => {
  spent += ms;
};

/** Forgets the estimate (a new scene). */
export const resetFrameBudget = () => {
  started = -1;
  spent = 0;
  fixed = 0;
};

/** Runs `work` with this frame's allowance (at most `cap`) and reports the time it took. */
export const withinFrame = <T>(cap: number, work: (budget: number) => T): T => {
  const t = performance.now();
  try {
    return work(frameAllowance(cap));
  } finally {
    frameSpent(performance.now() - t);
  }
};
