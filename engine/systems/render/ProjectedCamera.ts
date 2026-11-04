import * as PIXI from "pixi.js";

/**
 * A camera that pans and zooms on the GPU. Its view (zoom, then offset, into its parent's space) goes
 * into the projection while its children render. A stable nearby origin keeps Float32 batch
 * vertices precise in distant worlds; children stay put through ordinary pans and zooms. The
 * origin moves only beyond a screen-space precision bound; move the camera with setView.
 *
 * Children's world transforms are world space, not screen space, so nothing under it may rely on
 * filters, scissor masks, cullable or pointer hit tests (they read world transforms as the screen).
 */
export class ProjectedCamera extends PIXI.Container {
  /** World to the parent's space. */
  readonly view = new PIXI.Matrix();
  private readonly saved = new PIXI.Matrix();
  private readonly through = new PIXI.Matrix();
  private readonly inverse = new PIXI.Matrix();
  private readonly unshift = new PIXI.Matrix();
  private originX = 0;
  private originY = 0;

  /** Zoom about the world origin, then offset (parent units). */
  setView(zoom: number, x: number, y: number) {
    this.view.set(zoom, 0, 0, zoom, x, y);
    const focusX = -x / zoom,
      focusY = -y / zoom;
    // Beyond 2^17 projected units, Float32 rounding can exceed 1/128 screen px.
    // Rebase in doubles before PIXI writes world positions into its Float32 batches.
    if (
      Number.isFinite(focusX) &&
      Number.isFinite(focusY) &&
      Math.max(
        Math.abs(focusX - this.originX),
        Math.abs(focusY - this.originY)
      ) *
        Math.abs(zoom) >
        2 ** 17
    ) {
      this.originX = Math.round(focusX);
      this.originY = Math.round(focusY);
      this.position.set(-this.originX, -this.originY);
      this.unshift.set(1, 0, 0, 1, this.originX, this.originY);
    }
  }

  render(renderer: PIXI.Renderer) {
    if (!this.visible || this.worldAlpha <= 0 || !this.renderable) return;
    const projection = renderer.projection;
    renderer.batch.flush();
    // Children include the stable origin shift R; compensate with P · view · R⁻¹ · P⁻¹.
    const parent = this.parent?.worldTransform ?? PIXI.Matrix.IDENTITY;
    this.inverse.copyFrom(parent).invert();
    this.through
      .copyFrom(parent)
      .append(this.view)
      .append(this.unshift)
      .append(this.inverse);
    this.saved.copyFrom(projection.projectionMatrix);
    projection.projectionMatrix.append(this.through);
    ProjectedCamera.sync(renderer);
    super.render(renderer);
    renderer.batch.flush();
    projection.projectionMatrix.copyFrom(this.saved);
    ProjectedCamera.sync(renderer);
  }

  private static sync(renderer: PIXI.Renderer) {
    renderer.globalUniforms.update();
    const bound = renderer.shader.shader;
    if (bound) renderer.shader.syncUniformGroup(bound.uniforms.globals);
  }
}
