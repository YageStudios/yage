/**
 * What a buffer was drawn from (ShadowPass's, LightPass's): the camera and every contributor's
 * state that drawing reads, a frame's worth in order, against the last frame's. Unchanged, the
 * buffer holds what drawing it again would: it's kept.
 */
export class FramePrint {
  private nums: number[] = [];
  private refs: unknown[] = [];
  private n = 0;
  private r = 0;
  private same = false;
  private valid = false;
  /** Arrays and textures printed this frame: shared by many (a layer's uniform group), each is printed once. */
  readonly seen = new Set<unknown>();
  begin() {
    this.n = 0;
    this.r = 0;
    this.seen.clear();
    this.same = this.valid;
    this.valid = true;
  }
  num(value: number) {
    if (this.same && !Object.is(this.nums[this.n], value)) this.same = false;
    this.nums[this.n++] = value;
  }
  ref(value: unknown) {
    if (this.same && this.refs[this.r] !== value) this.same = false;
    this.refs[this.r++] = value;
  }
  /** Something this can't see into: drawn afresh this frame and the next. */
  poison() {
    this.same = false;
    this.valid = false;
  }
  /** Whether this frame's print is the last one's. */
  end() {
    const same = this.same && this.n === this.nums.length && this.r === this.refs.length;
    this.nums.length = this.n;
    this.refs.length = this.r;
    return same;
  }
  /** Draw afresh next frame. */
  reset() {
    this.valid = false;
  }
}
