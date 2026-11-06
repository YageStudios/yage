import * as PIXI from "pixi.js";

/** Sprite and Graphics batches already supply RGB integers; packing need not normalize them again. */
export function packedTint(
  tint: unknown,
  alpha: number,
  premultiply: boolean
): number | null {
  let rgb: number;
  if (
    typeof tint === "number" &&
    Number.isInteger(tint) &&
    tint >= 0 &&
    tint <= 0xffffff
  ) {
    rgb = tint;
  } else {
    return null;
  }
  if (alpha === 1) return (255 << 24) + rgb;
  if (alpha === 0) return premultiply ? 0 : rgb;
  let r = (rgb >> 16) & 255,
    g = (rgb >> 8) & 255,
    b = rgb & 255;
  if (premultiply) {
    r = (r * alpha + 0.5) | 0;
    g = (g * alpha + 0.5) | 0;
    b = (b * alpha + 0.5) | 0;
  }
  return ((alpha * 255) << 24) + (r << 16) + (g << 8) + b;
}

/** Change only the default packer on this renderer; a custom batch plugin keeps its own packing. */
export function installPackedBatchColors(renderer: PIXI.IRenderer): () => void {
  const batch = renderer.plugins?.batch;
  // A renderer without the batch plugin (a test's stand-in) has no default packer to change.
  if (!batch) return () => {};
  if (
    !(batch instanceof PIXI.BatchRenderer) ||
    Reflect.get(batch, "vertexSize") !== 6 ||
    batch.packInterleavedGeometry !==
      PIXI.BatchRenderer.prototype.packInterleavedGeometry
  )
    return () => {};
  const original = batch.packInterleavedGeometry;
  const pack: typeof original = function (
    this: PIXI.BatchRenderer,
    element,
    attributeBuffer,
    indexBuffer,
    aIndex,
    iIndex
  ) {
    const tint = packedTint(
      element._tintRGB,
      Math.min(element.worldAlpha, 1),
      element._texture.baseTexture.alphaMode > 0
    );
    if (tint === null)
      return original.call(
        this,
        element,
        attributeBuffer,
        indexBuffer,
        aIndex,
        iIndex
      );
    const { uint32View, float32View } = attributeBuffer;
    const packedVertices = aIndex / this.vertexSize;
    const { uvs, indices, vertexData } = element;
    const textureId = element._texture.baseTexture._batchLocation;
    for (let i = 0; i < vertexData.length; i += 2) {
      float32View[aIndex++] = vertexData[i];
      float32View[aIndex++] = vertexData[i + 1];
      float32View[aIndex++] = uvs[i];
      float32View[aIndex++] = uvs[i + 1];
      uint32View[aIndex++] = tint;
      float32View[aIndex++] = textureId;
    }
    for (let i = 0; i < indices.length; i++)
      indexBuffer[iIndex++] = packedVertices + indices[i];
  };
  batch.packInterleavedGeometry = pack;
  return () => {
    if (batch.packInterleavedGeometry === pack)
      batch.packInterleavedGeometry = original;
  };
}
