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
 * While a scene loads behind a loading screen (`setFrameLoading`), builders get a long frame each
 * whatever their caps, so the one-time work lands before play; `frameQuiet` counts the frames in a
 * row since anything was left to build, which is how a loading screen knows it may lift.
 *
 * Work done ahead on a guess (what the pointer hovers may be next) runs only on free frames
 * (`withinSpare`): after SPARE_AFTER_FRAMES quiet ones, so never while anything streams in (a zoom,
 * a pan), and its own time doesn't break the streak.
 *
 * Import as `yage/game/FrameBudget`.
 */

/** The frame time builders fill up to (ms): a 60 Hz frame, less headroom for the compositor and GC. */
export const FRAME_TARGET_MS = 12;
/** The frame time builders fill up to while loading (ms): nobody is playing yet. */
export const LOADING_TARGET_MS = 40;
/** A quiet frame: builders spent under QUIET_SPENT_MS and the whole frame (render too) took under QUIET_FRAME_MS. */
export const QUIET_SPENT_MS = 1;
export const QUIET_FRAME_MS = 25;
/** Quiet frames in a row before spare work may run. */
export const SPARE_AFTER_FRAMES = 10;

let started = -1;
let spent = 0;
let fixed = 0;
let loading = false;
let lastBegin = -1;
let quiet = 0;
let spare = 0;

/** Marks a frame's start (and judges the last one, begin to begin, as quiet or not). */
export const beginFrame = (now = performance.now()) => {
  quiet = lastBegin >= 0 && now - lastBegin < QUIET_FRAME_MS && spent - spare < QUIET_SPENT_MS ? quiet + 1 : 0;
  lastBegin = now;
  started = now;
  spent = 0;
  spare = 0;
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
  if (loading) return Math.max(0, LOADING_TARGET_MS - spent);
  return Math.max(0, Math.min(cap, FRAME_TARGET_MS - fixed - spent));
};

/** Reports `ms` of deferrable work done this frame. */
export const frameSpent = (ms: number) => {
  spent += ms;
};

/** Turns loading on (builders get LOADING_TARGET_MS a frame, caps aside) or off. */
export const setFrameLoading = (on: boolean) => {
  loading = on;
};

/** The frames in a row, up to the last begun, that were quiet: nothing much built and none slow. */
export const frameQuiet = () => quiet;

/** Forgets the estimate (a new scene). */
export const resetFrameBudget = () => {
  started = -1;
  spent = 0;
  fixed = 0;
  loading = false;
  lastBegin = -1;
  quiet = 0;
  spare = 0;
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

/**
 * Runs optional work (a guess at what comes next) with this frame's allowance (at most `cap`), but
 * only on a free frame: after SPARE_AFTER_FRAMES quiet ones (outside a marked frame, always). Its
 * time comes off the frame's room but doesn't break the quiet streak. Returns whether it ran.
 */
export const withinSpare = (cap: number, work: (budget: number) => void): boolean => {
  if (started >= 0 && quiet < SPARE_AFTER_FRAMES) return false;
  const budget = frameAllowance(cap);
  if (budget <= 0) return false;
  const t = performance.now();
  try {
    work(budget);
  } finally {
    const ms = performance.now() - t;
    spent += ms;
    if (started >= 0) spare += ms;
  }
  return true;
};
