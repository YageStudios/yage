/**
 * Chunk coordinates for streamed worlds.
 *
 * A chunk is addressed by integer `(cx, cy)`; positions inside it are chunk-local, so float32
 * precision holds however far from the origin a chunk is. Keys pack both coordinates into one
 * exact integer (each in -262144..262143: 19 bits, room for a whole Earth of 128 m chunks), which
 * keeps Map lookups and wire encoding cheap.
 */

export const CHUNK_COORD_MIN = -262144;
export const CHUNK_COORD_MAX = 262143;
/** Key distance between y rows (one axis's 19 bits). */
const AXIS = 524288;
/** Key distance between spaces (see spaceChunkKey): above both axes' 38 bits. */
const SPACE_STRIDE = AXIS * AXIS;

export const chunkKey = (cx: number, cy: number): number => {
  if (cx < CHUNK_COORD_MIN || cx > CHUNK_COORD_MAX || cy < CHUNK_COORD_MIN || cy > CHUNK_COORD_MAX) {
    throw new RangeError(`Chunk (${cx}, ${cy}) is outside the supported range`);
  }
  return (cx - CHUNK_COORD_MIN) * AXIS + (cy - CHUNK_COORD_MIN);
};

export const chunkX = (key: number): number => Math.floor((key % SPACE_STRIDE) / AXIS) + CHUNK_COORD_MIN;
export const chunkY = (key: number): number => (key % AXIS) + CHUNK_COORD_MIN;

// ---------------------------------------------------------------------------------------------
// Spaces. A game may run several independent maps ("spaces": regions, interiors, a second city)
// on the same hosts. Each has its own chunk grid, so chunk (0, 0) of space 1 and chunk (0, 0) of
// space 2 are different chunks. Space 0 is the default space; single-space games never mention it.
//
// A space-qualified key is `space × 2³⁸ + chunkKey(cx, cy)`: the space is its own field above the
// packed coordinates (not squeezed into spare coordinate bits), it stays an exact integer for
// every space id up to 32767 (2⁵³ / 2³⁸), and space 0 keys equal plain `chunkKey`s.

export const DEFAULT_SPACE = 0;
export const SPACE_MAX = 32767;

/** One runtime chunk: which space it belongs to and its coordinates there. */
export type ChunkAddress = { space: number; cx: number; cy: number };

export const spaceChunkKey = (space: number, cx: number, cy: number): number => {
  if (!Number.isInteger(space) || space < 0 || space > SPACE_MAX) throw new RangeError(`Space ${space} is outside 0..${SPACE_MAX}`);
  return space * SPACE_STRIDE + chunkKey(cx, cy);
};

export const keySpace = (key: number): number => Math.floor(key / SPACE_STRIDE);

export const addressKey = (address: ChunkAddress) => spaceChunkKey(address.space, address.cx, address.cy);

export const keyAddress = (key: number): ChunkAddress => ({ space: keySpace(key), cx: chunkX(key), cy: chunkY(key) });

/** The chunk containing a global position. */
export const chunkOf = (x: number, y: number, chunkSize: number): [number, number] => [
  Math.floor(x / chunkSize),
  Math.floor(y / chunkSize),
];

/** Keys of every chunk whose square intersects the rectangle, expanded by `ring` chunks. */
export const chunksInRect = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  chunkSize: number,
  ring = 0
): number[] => {
  const x0 = Math.floor(minX / chunkSize) - ring;
  const y0 = Math.floor(minY / chunkSize) - ring;
  const x1 = Math.floor(maxX / chunkSize) + ring;
  const y1 = Math.floor(maxY / chunkSize) + ring;
  const keys: number[] = [];
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) keys.push(chunkKey(cx, cy));
  }
  return keys;
};

/** Small stable hash of a chunk, used to stagger chunks across ticks and hosts. */
export const chunkHash = (cx: number, cy: number, space = 0): number => {
  let h = Math.imul(cx | 0, 0x27d4eb2d) ^ Math.imul(cy | 0, 0x165667b1) ^ Math.imul(space | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
};
