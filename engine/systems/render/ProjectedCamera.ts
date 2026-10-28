import * as PIXI from "pixi.js";

/**
 * A camera that pans and zooms on the GPU. Its view (zoom, then offset, into its parent's space) goes
 * into the projection while its children render, so their world transforms, and the vertices Pixi
 * batches from them, stay put as the camera moves: a zoom costs a uniform, not a pass over every
 * sprite and graphic. Its own transform stays identity; move it with setView.
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

  /** Zoom about the world origin, then offset (parent units). */
  setView(zoom: number, x: number, y: number) {
    this.view.set(zoom, 0, 0, zoom, x, y);
  }

  render(renderer: PIXI.Renderer) {
    if (!this.visible || this.worldAlpha <= 0 || !this.renderable) return;
    const projection = renderer.projection;
    renderer.batch.flush();
    // Children's world transforms already hold the parent's, so the view goes in as parent · view · parent⁻¹.
    const parent = this.parent?.worldTransform ?? PIXI.Matrix.IDENTITY;
    this.inverse.copyFrom(parent).invert();
    this.through.copyFrom(parent).append(this.view).append(this.inverse);
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
