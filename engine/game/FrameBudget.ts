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
 * A builder with a backlog may ask for a floor past what is left (`frameFloor`): one builder a frame
 * gets it, the one that has waited longest, so every backlog moves on in turn while the floors never
 * stack (a ground floor, a building floor and a roof floor in one frame were a whole frame over).
 *
 * The room is judged at each ask against the frame's real deadline: a frame whose fixed work so far
 * already ran past the estimate (a spike this frame) leaves only what is truly left. The target
 * follows the display (`frameTarget`): a 120 Hz screen's frames are half a 60 Hz one's.
 *
 * `frameStats` reports what the frames took (interval percentiles) and what each named builder
 * (`withinFrame`'s stage) spent, for the scene's performance readout.
 *
 * Work done ahead on a guess (what the pointer hovers may be next) runs only on free frames
 * (`withinSpare`): after SPARE_AFTER_FRAMES quiet ones, so never while anything streams in (a zoom,
 * a pan), and its own time doesn't break the streak.
 *
 * Import as `yage/game/FrameBudget`.
 */

/** The frame time builders fill up to (ms): a 60 Hz frame, less headroom for the compositor and GC. */
export const FRAME_TARGET_MS = 12;
/** The share of the display's frame interval builders may fill (12 of a 60 Hz frame's 16.7 ms). */
export const FRAME_TARGET_SHARE = 0.72;
/** Frame intervals kept for the display's rate and the readout's percentiles. */
const INTERVALS = 240;
/** Intervals measured before the target follows the display's rate. */
const RATE_AFTER = 60;
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
let buildIdleSince = -1;
let spare = 0;
/** performance.now() at the frame's start, whatever clock `beginFrame` was given: asks measure against it. */
let wall = 0;
let target: number | null = null;
let displayTarget = FRAME_TARGET_MS;
const intervals = new Float64Array(INTERVALS);
let intervalCount = 0;
let frameNo = 0;
let floored = false;
/** Builders waiting on a floor: owner → the frame it began waiting and the last frame it asked. */
const waiting = new Map<string, { since: number; asked: number }>();
/** What each named builder spent: this frame, and over the frames since the readout last reset. */
const stages = new Map<string, { frame: number; total: number; frames: number; max: number }>();
let overruns = 0;
let floorsGiven = 0;

const median = () => {
  const n = Math.min(intervalCount, INTERVALS);
  const sorted = Array.from(intervals.subarray(0, n)).sort((a, b) => a - b);
  return sorted[n >> 1];
};

/** Marks a frame's start (and judges the last one, begin to begin, as quiet or not). */
export const beginFrame = (now = performance.now()) => {
  if (lastBegin >= 0 && now >= lastBegin && spent - spare < QUIET_SPENT_MS) {
    if (buildIdleSince < 0) buildIdleSince = lastBegin;
  } else buildIdleSince = -1;
  quiet = lastBegin >= 0 && now - lastBegin < QUIET_FRAME_MS && spent - spare < QUIET_SPENT_MS ? quiet + 1 : 0;
  if (lastBegin >= 0 && now > lastBegin) {
    intervals[intervalCount++ % INTERVALS] = now - lastBegin;
    // The display's rate, from the middle interval: a missed frame or two doesn't move it.
    if (intervalCount >= RATE_AFTER && intervalCount % 30 === 0) displayTarget = Math.min(FRAME_TARGET_MS, median() * FRAME_TARGET_SHARE);
  }
  for (const stage of stages.values()) {
    if (stage.frame > 0) { stage.total += stage.frame; stage.frames++; if (stage.frame > stage.max) stage.max = stage.frame; }
    stage.frame = 0;
  }
  frameNo++;
  floored = false;
  for (const [owner, w] of waiting) if (w.asked < frameNo - 1) waiting.delete(owner);
  lastBegin = now;
  started = now;
  wall = performance.now();
  spent = 0;
  spare = 0;
};

/** The frame time builders fill up to now (ms): set with setFrameTarget, else from the display's rate. */
export const frameTarget = () => target ?? displayTarget;

/** Fixes the frame target (ms), e.g. from a quality setting; null follows the display's rate again. */
export const setFrameTarget = (ms: number | null) => {
  target = ms;
};

/** Marks a frame's end: what it took, less what builders spent, is the fixed cost the next frames expect. */
export const endFrame = (now = performance.now()) => {
  if (started < 0) return;
  const cost = Math.max(0, now - started - spent);
  if (!loading && spent > 0 && cost + spent > frameTarget() + 0.5) overruns++;
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
  // The fixed work so far this frame, if it already ran past the estimate, is what the frame costs.
  const fixedSoFar = performance.now() - wall - spent;
  return Math.max(0, Math.min(cap, frameTarget() - Math.max(fixed, fixedSoFar) - spent));
};

/**
 * What a builder with a backlog may spend: `allowed` (its share of the frame), or `floor` when that is
 * more and this builder gets the frame's one floor, which goes to whoever has waited longest for it
 * (so each backlog moves on in turn, and no two floors stack in a frame). Outside a marked frame, or
 * while loading, the floor is not rationed.
 */
export const frameFloor = (owner: string, allowed: number, floor: number): number => {
  if (floor <= allowed || floor <= 0) {
    waiting.delete(owner);
    return allowed;
  }
  if (started < 0 || loading) return floor;
  let mine = waiting.get(owner);
  if (!mine) waiting.set(owner, (mine = { since: frameNo, asked: frameNo }));
  mine.asked = frameNo;
  if (floored) return allowed;
  for (const [other, w] of waiting) if (other !== owner && w.since < mine.since) return allowed;
  floored = true;
  floorsGiven++;
  waiting.delete(owner);
  return floor;
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

/** How long required builders have been idle, independently of render speed. Optional spare work is excluded. */
export const frameBuildIdleMs = () =>
  buildIdleSince < 0 || spent - spare >= QUIET_SPENT_MS ? 0 : lastBegin - buildIdleSince;

/** Forgets the estimate (a new scene). */
export const resetFrameBudget = () => {
  started = -1;
  spent = 0;
  fixed = 0;
  loading = false;
  lastBegin = -1;
  quiet = 0;
  buildIdleSince = -1;
  spare = 0;
  target = null;
  displayTarget = FRAME_TARGET_MS;
  intervalCount = 0;
  frameNo = 0;
  floored = false;
  waiting.clear();
  stages.clear();
  overruns = 0;
  floorsGiven = 0;
};

/**
 * Runs `work` with this frame's allowance (at most `cap`) and reports the time it took, under
 * `stage` in frameStats when named. `floor` (with a stage) asks frameFloor for more when the
 * allowance is under it: pass it only while the builder has a backlog.
 */
export const withinFrame = <T>(cap: number, work: (budget: number) => T, stage?: string, floor = 0): T => {
  const t = performance.now();
  try {
    const allowed = frameAllowance(cap);
    return work(stage ? frameFloor(stage, allowed, floor) : allowed);
  } finally {
    const ms = performance.now() - t;
    frameSpent(ms);
    if (stage) {
      let s = stages.get(stage);
      if (!s) stages.set(stage, (s = { frame: 0, total: 0, frames: 0, max: 0 }));
      s.frame += ms;
    }
  }
};

/** What the frames took since the last reset: interval percentiles (ms), slow frames, floors given, and each stage's busy frames, mean and worst. */
export const frameStats = (reset = false) => {
  const n = Math.min(intervalCount, INTERVALS);
  const sorted = Array.from(intervals.subarray(0, n)).sort((a, b) => a - b);
  const at = (q: number) => (n ? sorted[Math.min(n - 1, Math.floor(q * n))] : 0);
  const out = {
    target: frameTarget(),
    frames: n,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: n ? sorted[n - 1] : 0,
    overruns,
    floors: floorsGiven,
    stages: Object.fromEntries([...stages].map(([name, s]) => [name, { frames: s.frames, mean: s.frames ? s.total / s.frames : 0, max: s.max }])),
  };
  if (reset) {
    overruns = floorsGiven = 0;
    for (const s of stages.values()) s.total = s.frames = s.max = 0;
  }
  return out;
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
