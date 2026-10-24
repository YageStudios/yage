/**
 * Canonical world saves: serializeWorld output whose query table does not depend on which systems
 * (and so which queries) the saving build registered.
 *
 * minecs writes every query in the world, in creation order. Adding a system with a new query,
 * or reordering system registration, then changes save bytes even though the entities did not
 * change. A load does not need most of that table: deserializing into a world rebuilds any query
 * the payload leaves out from the entities, in entity order. saveWorld writes only the queries a
 * rebuild would not reproduce (an iteration order that differs from entity order, pending
 * removals, or a query no system of the world holds), sorted by key. Loads are unchanged, so
 * saves written before this still load, and a canonical save loads to the same world state.
 *
 * Import as `yage/world/save` (or through `yage/world/lean`). It imports only minecs.
 */
import { SerialMode, serializeWorld, type SerializedWorld, type World } from "minecs";

type QueryLike = {
  dense: number[];
  has(eid: number): boolean;
  toRemove: { dense: number[] };
};

/** Query keys held by the world's systems; a load into a world of the same type rebuilds these. */
const systemQueryKeys = (world: World): Set<string> => {
  const keys = new Set<string>();
  const w = world as unknown as { systems?: object[]; drawSystems?: object[] };
  for (const list of [w.systems, w.drawSystems]) {
    for (const system of list ?? []) {
      const key = (system.constructor as { queryKey?: string }).queryKey;
      if (key) keys.add(key);
    }
  }
  return keys;
};

/** True when the query lists its entities in the world's entity order, as a rebuild would. */
const inEntityOrder = (world: World, query: QueryLike): boolean => {
  const entities = (world as unknown as { entitySparseSet: { dense: number[] } }).entitySparseSet.dense;
  const dense = query.dense;
  let j = 0;
  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];
    if (!query.has(eid)) continue;
    if (dense[j] !== eid) return false;
    j++;
  }
  return j === dense.length;
};

/**
 * The query keys a canonical save of `world` writes, sorted: every query whose state a load could
 * not rebuild from the entities alone.
 */
export const savedQueryKeys = (world: World): string[] => {
  const w = world as unknown as { queryMap: Map<string, QueryLike>; dirtyQueries: Set<unknown> };
  const held = systemQueryKeys(world);
  const keys: string[] = [];
  w.queryMap.forEach((query, key) => {
    const rebuilt = held.has(key) && !w.dirtyQueries.has(query) && query.toRemove.dense.length === 0 && inEntityOrder(world, query);
    if (!rebuilt) keys.push(key);
  });
  return keys.sort();
};

/**
 * serializeWorld(mode, world) with a canonical query table (see the module comment). Load the result with
 * minecs' deserializeWorld or a lean world type's deserialize, as before.
 */
export function saveWorld(mode: SerialMode.BINARY, world: World): ArrayBuffer;
export function saveWorld(mode: SerialMode.JSON, world: World): SerializedWorld;
export function saveWorld(mode: SerialMode.BASE64, world: World): string;
export function saveWorld(mode: SerialMode, world: World): SerializedWorld | ArrayBuffer | string {
  const w = world as unknown as { queryMap: Map<string, unknown> };
  const all = w.queryMap;
  const table = new Map<string, unknown>();
  for (const key of savedQueryKeys(world)) table.set(key, all.get(key));
  w.queryMap = table;
  try {
    return serializeWorld(mode as SerialMode.BINARY, world);
  } finally {
    w.queryMap = all;
  }
}
