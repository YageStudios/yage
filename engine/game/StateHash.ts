import { SerialMode, serializeWorld } from "minecs";
import type { SerializedWorld, World } from "minecs";

// Two independent 32-bit FNV-1a lanes over the serialized world state.
// Two lanes double the effective hash width without paying for a 64-bit
// implementation, and FNV-1a uses only integer ops, so the result is stable
// across JS engines.
const fnv1a = (data: Uint8Array, offsetBasis: number, prime: number): number => {
  let hash = offsetBasis;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = Math.imul(hash, prime);
  }
  return hash >>> 0;
};

/**
 * Deterministic digest of the full ECS world state. Two clients running the
 * same simulation produce the same digest for the same frame; a differing
 * digest at the same frame is a desync.
 *
 * Query bookkeeping is excluded: queries are created lazily by whichever
 * code path happens to run (debug overlays, host-only systems), so a query
 * created on one peer only must not look like a desync. The binary format
 * embeds queries positionally and cannot skip them, so this hashes the JSON
 * form without them. Callers hash on desync-check frames only, so the extra
 * cost of the JSON form is bounded.
 */
export const hashWorldState = (world: World): string => {
  const state: SerializedWorld = serializeWorld(SerialMode.JSON, world);
  const simulationState: SerializedWorld = { ...state, queryMap: {}, dirtyQueries: [] };
  const bytes = new TextEncoder().encode(JSON.stringify(simulationState));
  const lane1 = fnv1a(bytes, 0x811c9dc5, 0x01000193);
  const lane2 = fnv1a(bytes, 0x9747b28c, 0x85ebca6b);
  return lane1.toString(16).padStart(8, "0") + lane2.toString(16).padStart(8, "0");
};
