import { DrawSystemImpl, System, defineQuery } from "minecs";
import type { SystemImpl, Schema, World } from "minecs";

type SystemClass = typeof SystemImpl<any>;
type Revision = { implementation: SystemClass; components: (typeof Schema)[] };
type Registration = {
  current: Revision;
  pending?: Revision;
  ready?: Revision;
  stable: SystemClass;
  signature: string;
};
type LiveSystem = {
  registration: Registration;
  instance: SystemImpl<any>;
  version: Revision;
};
const registrations = new Map<string, Registration>();
const hotConstructors = new WeakSet<SystemClass>();
const liveSystems = new WeakMap<object, LiveSystem>();
const moduleClasses = new Map<string, Set<string>>();
let entityReload: ((definition: unknown) => void) | undefined;
const entityNames = new Map<string, string>();
const defaultsPatches: ((world: World) => void)[] = [];
const appliedDefaults = new WeakMap<World, number>();

export function registerHotWorld(world: World): void {
  appliedDefaults.set(world, defaultsPatches.length);
}

export function isEntityHotReloadEnabled(): boolean {
  return entityNames.size > 0;
}

export function queueEntityDefaultsPatch(patch: (world: World) => void): void {
  defaultsPatches.push(patch);
}
const pendingEntities = new Map<
  string,
  { definition: unknown; invalidate: (reason: string) => void }
>();

export function setEntityReloadHandler(
  handler: (definition: unknown) => void
): void {
  entityReload = handler;
}

export function stageEntityDefinition(
  file: string,
  definition: { name: string },
  invalidate: (reason: string) => void
): boolean {
  if (!definition || typeof definition.name !== "string") return false;
  const name = entityNames.get(file);
  if (name === undefined) {
    entityNames.set(file, definition.name);
  } else {
    if (name !== definition.name) return false;
    pendingEntities.set(file, { definition, invalidate });
  }
  return true;
}

/** Vite calls this before evaluating the decorators in an updated module. */
export function beginHotSystems(file: string): void {
  moduleClasses.set(file, new Set());
  for (const [key, entry] of registrations) {
    if (key.startsWith(`${file}:`)) entry.pending = undefined;
  }
}

export function hotSystem(
  file: string,
  categoryOrSchema: number | typeof Schema,
  ...schemas: (typeof Schema)[]
) {
  return (implementation: SystemClass): SystemClass => {
    const key = `${file}:${implementation.name}`;
    moduleClasses.get(file)?.add(key);
    const components =
      typeof categoryOrSchema === "number"
        ? schemas
        : [categoryOrSchema, ...schemas];
    implementation.queryKey = components
      .map((component) => component.type)
      .sort()
      .join("|");
    if (typeof categoryOrSchema === "number")
      implementation.category = categoryOrSchema;
    const revision = { implementation, components };
    const signature = JSON.stringify(
      implementation.prototype instanceof DrawSystemImpl
    );
    const existing = registrations.get(key);
    if (existing) {
      if (existing.signature === signature) existing.pending = revision;
      else existing.pending = undefined;
      // Keep constructor identity as well as cached system references stable.
      return existing.stable;
    }
    const registration: Registration = {
      current: revision,
      stable: implementation,
      signature,
    };
    const stable = new Proxy(implementation, {
      get(target, property) {
        if (
          property === "prototype" || property === "name" || property === "length" || property === Symbol.hasInstance
        ) {
          return Reflect.get(target, property);
        }
        const value = Reflect.get(registration.current.implementation, property);
        return typeof value === "function" ? value.bind(registration.current.implementation) : value;
      },
      construct() {
        const instance = new registration.current.implementation(
          defineQuery(registration.current.components)
        );
        const live: LiveSystem = {
          registration,
          instance,
          version: registration.current,
        };
        const proxy = new Proxy(instance, {
          getPrototypeOf() {
            return registration.stable.prototype;
          },
          get(_object, property) {
            if (property === "constructor") return stable;
            const value = Reflect.get(live.instance, property);
            return typeof value === "function"
              ? value.bind(live.instance)
              : value;
          },
          set(_object, property, value) {
            return Reflect.set(live.instance, property, value);
          },
        });
        liveSystems.set(proxy, live);
        return proxy;
      },
    });
    registration.stable = stable;
    hotConstructors.add(stable);
    registrations.set(key, registration);
    System(categoryOrSchema, ...schemas)(stable);
    return stable;
  };
}

/** Class-set and simulation/drawing-kind edits need a fresh registration graph. */
export function finishHotSystems(file: string, updating: boolean): boolean {
  if (!updating) return true;
  const seen = moduleClasses.get(file);
  if (!seen) return false;
  const entries = [...registrations].filter(([key]) =>
    key.startsWith(`${file}:`)
  );
  if (entries.some(([key, entry]) => !seen.has(key) || !entry.pending)) {
    for (const [, entry] of entries) entry.pending = undefined;
    return false;
  }
  for (const [, entry] of entries) {
    entry.ready = entry.pending;
    entry.pending = undefined;
  }
  return true;
}

/** Applied before simulation or presentation runs, never during a system iteration. */
export function applyHotReload(world: World): boolean {
  if (!registrations.size && !pendingEntities.size && !defaultsPatches.length)
    return false;
  for (const entry of registrations.values()) {
    if (!entry.ready) continue;
    entry.current = entry.ready;
    entry.ready = undefined;
  }
  const entities = [...pendingEntities.values()];
  pendingEntities.clear();
  for (const { definition, invalidate } of entities) {
    try {
      entityReload?.(definition);
    } catch (error) {
      invalidate(error instanceof Error ? error.message : String(error));
      return false;
    }
  }
  let changed = false;
  const applied = appliedDefaults.get(world) ?? 0;
  for (let index = applied; index < defaultsPatches.length; index++)
    defaultsPatches[index](world);
  appliedDefaults.set(world, defaultsPatches.length);
  for (const system of [...world.systems, ...world.drawSystems]) {
    const live = liveSystems.get(system);
    if (!live) continue;
    const revision = live.registration.current;
    const queryKey = revision.implementation.queryKey;
    const mapped = world.systemQueryMap.get(queryKey)?.includes(system);
    if (live.version === revision && mapped) continue;
    changed = true;
    const oldEntities = [...live.instance.query(world)];
    const query = defineQuery(revision.components);
    const entities = [...query(world)];
    for (const [key, systems] of world.systemQueryMap) {
      const remaining = systems.filter((entry) => entry !== system);
      if (remaining.length) world.systemQueryMap.set(key, remaining);
      else world.systemQueryMap.delete(key);
    }
    world.systemQueryMap.set(queryKey, [
      ...(world.systemQueryMap.get(queryKey) ?? []),
      system,
    ]);
    if (live.version === revision) continue;
    const next = new revision.implementation(query);
    if (world.drawSystems.includes(system)) {
      for (const entity of oldEntities) live.instance.cleanup?.(world, entity);
      live.instance = next;
      for (const entity of entities) next.init?.(world, entity);
    } else {
      for (const entity of oldEntities) {
        if (!entities.includes(entity)) live.instance.cleanup?.(world, entity);
      }
      // Simulation-owned fields survive; functions close over the fresh instance.
      for (const key of Object.keys(live.instance)) {
        const value = Reflect.get(live.instance, key);
        if (typeof value !== "function" && key !== "query")
          Reflect.set(next, key, value);
      }
      live.instance = next;
      for (const entity of entities) {
        if (!oldEntities.includes(entity)) next.init?.(world, entity);
      }
    }
    live.version = revision;
  }
  if (changed) {
    const ordered = (a: SystemImpl, b: SystemImpl) => {
      const left = a.constructor as SystemClass,
        right = b.constructor as SystemClass;
      return (
        left.depth - right.depth || left.queryKey.localeCompare(right.queryKey)
      );
    };
    world.systems.sort(ordered);
    world.drawSystems.sort(ordered);
  }
  return changed;
}

export function hasHotSystems(world: World): boolean {
  if (!registrations.size) return false;
  return world.systems.some((system) => liveSystems.has(system));
}

export function getHotSystem<T extends SystemClass>(
  world: World,
  implementation: T
): InstanceType<T> | undefined {
  if (!hotConstructors.has(implementation)) return undefined;
  return [...world.systems, ...world.drawSystems].find(
    (system) => system.constructor === implementation
  );
}

/** MineCS's global execution list cannot be reordered through its public interface. */
export function stepHotWorld(world: World, timing: boolean): void {
  world.frame++;
  const report: World["timing"] = timing ? { systems: [], totalTime: 0 } : null;
  if (report) world.timing = report;
  for (const system of world.systems) {
    const implementation = system.constructor as SystemClass;
    if (implementation.depth < 0) continue;
    const mod = Math.max(1, Math.min(60, implementation.frameMod ?? 1));
    const offset = Math.max(
      0,
      Math.min(mod - 1, implementation.frameModOffset ?? 0)
    );
    if (world.frame <= offset || (world.frame - 1 - offset) % mod !== 0)
      continue;
    const entities = system.query(world);
    if (!entities.length) continue;
    const start = timing ? performance.now() : 0;
    system.runAll(world);
    if (report) {
      const elapsed = performance.now() - start;
      report.totalTime += elapsed;
      report.systems.push({
        name: implementation.name,
        totalTime: elapsed,
        totalCalls: entities.length,
        averageTime: elapsed / entities.length,
      });
    }
  }
}
