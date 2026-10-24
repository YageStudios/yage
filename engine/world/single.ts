/**
 * Entity objects that exist once per world (a scene's camera, its outbreak, a planning part) are
 * found by what they hold, not through a shared bag of handles: `singleEntity(world, Camera)` is
 * the one entity with Camera; `singleEntity(world, [A, B])` the one with both.
 *
 * Import as `yage/world/single`. LeanGameModel exposes these as `model.single` / `model.singleEntity`.
 */
import { defineQuery, type Constructor, type Schema, type World } from "minecs";

/** One schema, or several the entity must all hold (a compiled definition's `components` fit, mapped to their schemas). */
export type SingleKey = Constructor<Schema> | typeof Schema | readonly (Constructor<Schema> | typeof Schema)[];

const queries = new Map<string, ReturnType<typeof defineQuery>>();

const schemasOf = (key: SingleKey) => (Array.isArray(key) ? key : [key]) as (typeof Schema)[];

const queryOf = (schemas: (typeof Schema)[]) => {
  const id = schemas.map((s) => (s as any).type ?? s.name).join("+");
  let query = queries.get(id);
  if (!query) queries.set(id, (query = defineQuery(schemas as any)));
  return query;
};

const nameOf = (schemas: (typeof Schema)[]) => schemas.map((s) => (s as any).type ?? s.name).join(" + ");

/** The entities holding every schema in `key`, in query order. */
export const entitiesWith = (world: World, key: SingleKey): readonly number[] => queryOf(schemasOf(key))(world) as number[];

/** The one entity holding `key`, or -1 when there is none. Throws when there are several: a single is a single. */
export const findSingleEntity = (world: World, key: SingleKey): number => {
  const schemas = schemasOf(key);
  const found = queryOf(schemas)(world) as number[];
  if (found.length > 1) throw new Error(`yage single: ${found.length} entities hold ${nameOf(schemas)}, expected one`);
  return found.length ? found[0] : -1;
};

/** The one entity holding `key`. Throws when there is none or there are several. */
export const singleEntity = (world: World, key: SingleKey): number => {
  const eid = findSingleEntity(world, key);
  if (eid < 0) throw new Error(`yage single: no entity holds ${nameOf(schemasOf(key))}`);
  return eid;
};

/** The `schema` data of the one entity holding it. Throws when there is none or there are several. */
export const single = <T extends Schema>(world: World, schema: Constructor<T>): T => world(schema as any, singleEntity(world, schema)) as T;
