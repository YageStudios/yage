/**
 * Moves whole entities between minecs worlds as flat rows, for chunk hand-offs.
 *
 * Only flat numeric columns (one typed-array value per entity) are carried. That covers the lean
 * components chunk simulations use; components with strings, objects or nested arrays are
 * rejected when the layout is built, so a lossy hand-off can't happen silently.
 */
import { addComponent, addEntity, hasComponent, removeEntity, type Schema, type World } from "minecs";
import { ByteReader, ByteWriter } from "./protocol";

type TypedColumn = Float32Array | Float64Array | Int8Array | Int16Array | Int32Array | Uint8Array | Uint16Array | Uint32Array | Uint8ClampedArray;

type Layout = {
  columns: TypedColumn[][];
  keys: string[][];
};

const layouts = new WeakMap<World, Layout>();

const isFlatColumn = (value: unknown, size: number): value is TypedColumn =>
  ArrayBuffer.isView(value) && !(value instanceof DataView) && (value as TypedColumn).length >= size;

const layoutFor = (world: World, components: readonly (typeof Schema)[]): Layout => {
  let layout = layouts.get(world);
  if (layout) return layout;
  if (components.length > 32) throw new Error("Entity rows support at most 32 components");
  layout = { columns: [], keys: [] };
  for (const component of components) {
    const store = (world as any)(component).store;
    const keys = Object.keys(store).sort();
    const columns: TypedColumn[] = [];
    for (const key of keys) {
      const value = store[key];
      if (!isFlatColumn(value, world.size)) {
        throw new Error(`Component ${component.type}.${key} is not a flat numeric column and can't be handed off`);
      }
      columns.push(value);
    }
    layout.columns.push(columns);
    layout.keys.push(keys);
  }
  layouts.set(world, layout);
  return layout;
};

/** Appends one entity's components to `writer`. */
export const writeRow = (world: World, components: readonly (typeof Schema)[], eid: number, writer: ByteWriter) => {
  const layout = layoutFor(world, components);
  let mask = 0;
  for (let i = 0; i < components.length; i++) {
    if (hasComponent(world, components[i] as any, eid)) mask |= 1 << i;
  }
  writer.u32(mask >>> 0);
  for (let i = 0; i < components.length; i++) {
    if (!(mask & (1 << i))) continue;
    const columns = layout.columns[i];
    for (let c = 0; c < columns.length; c++) writer.f64(columns[c][eid]);
  }
};

/**
 * Reads one row from `reader` into a new entity, or returns -1 (and skips the row) when the world
 * is full. `shift` adjusts a position after the row is written, e.g. into the new chunk's frame.
 */
export const readRow = (
  world: World,
  components: readonly (typeof Schema)[],
  reader: ByteReader,
  shift?: (world: World, eid: number) => void
): number => {
  const layout = layoutFor(world, components);
  const mask = reader.u32();
  const full = world.entitySparseSet.dense.length >= world.size;
  if (full) {
    for (let i = 0; i < components.length; i++) {
      if (mask & (1 << i)) reader.offset += layout.columns[i].length * 8;
    }
    return -1;
  }
  const eid = addEntity(world);
  for (let i = 0; i < components.length; i++) {
    if (!(mask & (1 << i))) continue;
    addComponent(world, components[i] as any, eid);
    const columns = layout.columns[i];
    for (let c = 0; c < columns.length; c++) columns[c][eid] = reader.f64();
  }
  shift?.(world, eid);
  return eid;
};

/** Writes `eids` as rows and removes them from `world`. */
export const takeRows = (world: World, components: readonly (typeof Schema)[], eids: readonly number[]) => {
  const writer = new ByteWriter(64 + eids.length * 64);
  for (const eid of eids) {
    writeRow(world, components, eid, writer);
    removeEntity(world, eid);
  }
  return writer.finish();
};

/** Reads `count` rows. Returns the new entity ids and the bytes of rows that didn't fit. */
export const putRows = (
  world: World,
  components: readonly (typeof Schema)[],
  rows: Uint8Array,
  count: number,
  shift?: (world: World, eid: number) => void
): { added: number[]; rejected: Uint8Array; rejectedCount: number } => {
  const reader = new ByteReader(rows);
  const added: number[] = [];
  const rejectedWriter = new ByteWriter(64);
  let rejectedCount = 0;
  for (let i = 0; i < count; i++) {
    const start = reader.offset;
    const eid = readRow(world, components, reader, shift);
    if (eid === -1) {
      rejectedWriter.raw(rows.subarray(start, reader.offset));
      rejectedCount++;
    } else {
      added.push(eid);
    }
  }
  return { added, rejected: rejectedWriter.finish(), rejectedCount };
};
