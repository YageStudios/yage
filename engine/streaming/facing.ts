/**
 * Which way each streamed entity faces (LOOK in layer.ts: 0 at the viewer, 1 right, 2 away, 3 left),
 * kept between frames by gid: it turns the way it went once it has gone `step` world units from where it
 * last turned, and holds that while it stands (or shuffles less than a step), so a pause never snaps it
 * back to the viewer. Shared by every layer of a kind, so it keeps facing across a chunk hand-off.
 */
export class Facings {
  private readonly at = new Map<number, { look: number; x: number; y: number; seen: number; held: boolean }>();
  private writes = 0;

  constructor(readonly step: number) {}

  /** Entity `gid` is at world (x, y): its look, turned if it has gone a step since it last turned. */
  move(gid: number, x: number, y: number) {
    const f = this.at.get(gid);
    if (!f) {
      this.at.set(gid, { look: 0, x, y, seen: this.writes, held: false });
      return 0;
    }
    f.seen = this.writes;
    const dx = x - f.x;
    const dy = y - f.y;
    const d = dx * dx + dy * dy;
    if (d < this.step * this.step) return f.look;
    // A jump (moved by the run, a teleport) turns it nowhere: it starts over from there. Held (`face`), it walks on as it faces.
    if (d < (this.step * JUMP) ** 2 && !f.held) f.look = lookFrom(dx, dy, f.look);
    f.x = x;
    f.y = y;
    return f.look;
  }

  /**
   * Entity `gid` turned to `look` and held so whichever way it walks (someone shooting faces their aim);
   * -1 lets it go, to turn the way it walks again. Nothing for an entity never seen.
   */
  face(gid: number, look: number) {
    const f = this.at.get(gid);
    if (!f) return;
    f.held = look >= 0;
    if (f.held) f.look = look;
  }

  /** Entity `gid`'s look (0 if it was never seen). */
  look(gid: number) {
    return this.at.get(gid)?.look ?? 0;
  }

  /** A snapshot written: now and then forget the entities long unseen. */
  wrote() {
    if (++this.writes % FORGET_EVERY) return;
    for (const [gid, f] of this.at) if (this.writes - f.seen > FORGET_AFTER) this.at.delete(gid);
  }
}

/** Past this many steps in one go it jumped rather than walked. */
const JUMP = 24;
/** How often (writes) to forget, and after how many unseen. */
const FORGET_EVERY = 256;
const FORGET_AFTER = 1024;

/**
 * The look for a step (dx, dy) on screen (y down): side on across the screen, away up it, at the viewer
 * down it. Near a diagonal it keeps the way it was (`was`), so a walk along one doesn't flicker.
 */
export const lookFrom = (dx: number, dy: number, was: number) => {
  const across = Math.abs(dx);
  const along = Math.abs(dy);
  const sideways = was === 1 || was === 3 ? across > 0.45 * along : across > 0.8 * along;
  if (sideways) return dx > 0 ? 1 : 3;
  return dy < 0 ? 2 : 0;
};
