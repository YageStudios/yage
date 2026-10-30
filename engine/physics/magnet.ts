/**
 * Magnet steering for a top-down walker on eight-way keys, in hallways and doors turned to any
 * angle. While the way the keys ask is clear for the walker's look ahead, it walks just that way
 * (an open street, a hallway along the keys). Once a wall stands in it, the walker turns toward
 * the clearest way within MAGNET_SPREAD of it, a little turn costing a little clearance, and walks
 * the middle of the clear band it finds (a turned hallway's axis, a door off a diagonal), or, the
 * band open to one side, its edge nearest the asked way (along a lone turned wall). A dead
 * end, no clearer anywhere near, keeps the asked way, for the walls to slide it along.
 *
 * Pure: `free(ux, uy)` says what share (0…1) of the look ahead the walker gets straight along the
 * unit direction (lean.ts castBall does it against the walls), so a sim and the page predicting
 * it bend alike over the same walls.
 */

/** How far either side of the asked way the walker may turn (radians), and in how many steps a side. */
export const MAGNET_SPREAD = Math.PI / 4;
const STEPS = 9;
/** Clearance a turn of the whole spread costs (share of the look ahead): the nearer way wins a near tie. */
const TURN_COST = 0.15;
/** Clear enough to walk as asked; clearer by this much to be worth turning; as clear to be one band. */
const CLEAR = 0.999;
const GAIN = 0.05;
const BAND = 0.02;

/** The way to walk (a unit vector) for the asked way (dx, dy, any length, not both 0). */
export const magnetSteer = (dx: number, dy: number, free: (ux: number, uy: number) => number): { x: number; y: number } => {
  const length = Math.hypot(dx, dy);
  const asked = { x: dx / length, y: dy / length };
  const ahead = free(asked.x, asked.y);
  if (ahead >= CLEAR) return asked;
  const base = Math.atan2(dy, dx);
  const step = MAGNET_SPREAD / STEPS;
  const shares = new Float64Array(2 * STEPS + 1);
  shares[STEPS] = ahead;
  for (let k = 1; k <= STEPS; k++) {
    shares[STEPS + k] = free(Math.cos(base + k * step), Math.sin(base + k * step));
    shares[STEPS - k] = free(Math.cos(base - k * step), Math.sin(base - k * step));
  }
  // Nearest first (0, +1, −1, +2, …), so a tie keeps the smaller turn.
  let best = 0;
  let score = ahead;
  for (let k = 1; k <= STEPS; k++)
    for (const i of [k, -k]) {
      const s = shares[STEPS + i] - (TURN_COST * k) / STEPS;
      if (s > score) (score = s), (best = i);
    }
  const clear = shares[STEPS + best];
  if (clear < ahead + GAIN) return asked;
  let lo = best;
  let hi = best;
  while (lo > -STEPS && shares[STEPS + lo - 1] >= clear - BAND) lo--;
  while (hi < STEPS && shares[STEPS + hi + 1] >= clear - BAND) hi++;
  // Walled both sides (a hallway), its middle; open to the spread's edge (along a lone wall, into
  // a room), the edge nearest the asked way, so the walker keeps along the wall, not off it.
  const at = lo > -STEPS && hi < STEPS ? (lo + hi) / 2 : Math.abs(lo) < Math.abs(hi) ? lo : hi;
  const angle = base + at * step;
  return { x: Math.cos(angle), y: Math.sin(angle) };
};
