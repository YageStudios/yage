/**
 * Entity objects that belong to another (a marker drawn into a camera, a panel in a HUD) say so
 * with OwnedBy, set when they spawn: `compiled.spawn(world, { owner: camera })`. Systems then
 * reach the owner's data through the entity instead of a shared bag: `ownedBy(world, eid, Camera)`.
 *
 * OwnedBy is a plain number column (-1: no owner), so it fits lean worlds too (yage/world/columns
 * forbids nullable typed columns there; yage/schemas/core/Owner is the GameModel one).
 *
 * Owning is not lifetime by itself: removing an owner leaves what it owns. `removeOwned(world, eid)`
 * removes `eid` with everything it owns, leaf-first, so each part's cleanup still reaches its owner.
 *
 * Import as `yage/world/owner`.
 */
import { Component, defaultValue, entityExists, hasComponent, removeEntity, Schema, type, type Constructor, type World } from "minecs";
import { entitiesWith } from "./single";

@Component("OwnedBy")
export class OwnedBy extends Schema {
  /** The owning entity, or -1. */
  @type("number")
  @defaultValue(-1)
  owner: number;
}

/** The entity that owns `eid`, or -1. */
export const ownerOf = (world: World, eid: number): number =>
  hasComponent(world, OwnedBy as any, eid) ? (world(OwnedBy as any, eid) as OwnedBy).owner : -1;

/** The nearest owner up `eid`'s chain (its owner, its owner's owner…) that holds `schema`, or -1. */
export const findOwnerWith = (world: World, eid: number, schema: Constructor<Schema> | typeof Schema): number => {
  const seen = new Set<number>();
  for (let at = ownerOf(world, eid); at >= 0 && !seen.has(at); at = ownerOf(world, at)) {
    seen.add(at);
    if (hasComponent(world, schema as any, at)) return at;
  }
  return -1;
};

/** `schema`'s data on the nearest owner of `eid` holding it. Throws when no owner up the chain does. */
export const ownedBy = <T extends Schema>(world: World, eid: number, schema: Constructor<T>): T => {
  const owner = findOwnerWith(world, eid, schema);
  if (owner < 0) throw new Error(`yage owner: no owner of entity ${eid} holds ${(schema as any).type ?? schema.name}`);
  return world(schema as any, owner) as T;
};

/** What `eid` owns, directly or down the chain, deepest first (newest first among equals). */
export const ownedTree = (world: World, eid: number): number[] => {
  const children = new Map<number, number[]>();
  for (const e of entitiesWith(world, OwnedBy)) {
    const owner = ownerOf(world, e);
    if (owner < 0 || owner === e) continue;
    const list = children.get(owner);
    if (list) list.push(e);
    else children.set(owner, [e]);
  }
  const depth = new Map<number, number>();
  const walk = [eid];
  depth.set(eid, 0);
  for (let i = 0; i < walk.length; i++) {
    for (const child of children.get(walk[i]) ?? []) {
      if (depth.has(child)) continue;
      depth.set(child, depth.get(walk[i])! + 1);
      walk.push(child);
    }
  }
  return walk.slice(1).sort((a, b) => depth.get(b)! - depth.get(a)! || b - a);
};

/** Removes `eid` and everything it owns, leaf-first; each is removed exactly once. */
export const removeOwned = (world: World, eid: number): void => {
  for (const e of [...ownedTree(world, eid), eid]) if (entityExists(world, e)) removeEntity(world, e);
};
