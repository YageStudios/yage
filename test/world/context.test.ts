import * as ecs from "minecs";
import { Component, Schema, addComponent, addEntity, defaultValue, type } from "minecs";
import { describe, expect, test, vi } from "vitest";
import { createLeanGameModel } from "yage/game/LeanGameModel";
import { ChunkHost } from "yage/streaming";
import { deleteWorld, disposeWorldContext, initializeWorldContext, leanWorldType, resetWorldContext, SerialMode, serializeWorld, worldContext, type WorldContextSpec } from "yage/world/lean";

@Component("ContextPerson")
class Person extends Schema {
  @type("number") @defaultValue(0) x: number;
  @type("number") @defaultValue(0) y: number;
  @type("number") @defaultValue(0) gid: number;
}
@Component("ContextMemory")
class Memory extends Schema {
  @type("number") @defaultValue(7) tick: number;
  @type("object") counts: Map<number, number>;
  @type("object") buffer: Uint8Array | null;
  @type("object") tags: Set<number>;
}
const context: WorldContextSpec = {
  components: [Memory],
  initialize(world, entity) { world(Memory, entity).counts = new Map(); world(Memory, entity).buffer = null; world(Memory, entity).tags = new Set(); },
};
const shape = leanWorldType({ components: [Person], systems: [], context });
const bytes = (world: ReturnType<typeof shape.create>) => new Uint8Array(serializeWorld(SerialMode.BINARY, world) as ArrayBuffer);

describe("schema-backed transient world context", () => {
  test("owns isolated real schema defaults and object fields without changing person ids or saves", () => {
    const a = shape.create(4);
    const b = shape.create(4);
    const first = addEntity(a);
    expect(first).toBe(0);
    addComponent(a, Person, first, { gid: 9 });
    const before = bytes(a);
    const memory = worldContext(a, Memory);
    expect(memory.tick).toBe(7);
    memory.tick = 99;
    memory.counts.set(1, 12);
    memory.buffer = new Uint8Array([1]);
    memory.buffer = new Uint8Array([2, 3]);
    expect([...memory.buffer]).toEqual([2, 3]);
    memory.buffer = null;
    expect(memory.buffer).toBeNull();
    expect(worldContext(b, Memory).tick).toBe(7);
    expect(worldContext(b, Memory).counts.size).toBe(0);
    expect([...a.componentMap.keys()]).toEqual([Person]);
    expect(bytes(a)).toEqual(before);
    const restored = shape.deserialize(before);
    expect(bytes(restored)).toEqual(before);
    expect(worldContext(restored, Memory).tick).toBe(7);
    expect(worldContext(restored, Memory).counts.size).toBe(0);
    initializeWorldContext(a, context);
    expect(worldContext(a, Memory).tick).toBe(99);
    for (const world of [a, b, restored]) shape.dispose(world);
  });

  test("failed context initialization releases both worlds, and subsequent defaults stay fresh", () => {
    const freed = vi.spyOn(ecs, "deleteWorld");
    try {
      const broken = leanWorldType({ components: [Person], systems: [], context: {
        components: [Memory], initialize() { throw new Error("bad context"); },
      } });
      expect(() => broken.create(4)).toThrow("bad context");
      expect(freed.mock.calls).toHaveLength(2);
      expect(freed.mock.calls[0][0].componentMap.has(Memory)).toBe(true);
      expect(freed.mock.calls[1][0].componentMap.has(Person)).toBe(true);
      const good = shape.create(4);
      expect(worldContext(good, Memory).tick).toBe(7);
      shape.dispose(good);
    } finally { freed.mockRestore(); }
  });

  test("context accessors address schema slots and retire when context resets or disposes", () => {
    let storage: ReturnType<typeof shape.create> | undefined;
    const owner = leanWorldType({ context: { components: [Memory], initialize(world, entity) {
      storage = world;
      world(Memory, entity).counts = new Map();
      world(Memory, entity).tags = new Set();
      world(Memory, entity).buffer = null;
    } }, systems: [] }).create(1);
    const old = worldContext(owner, Memory);
    const buffer = new Uint8Array([1, 2, 3]);
    const map = new Map([[1, 2]]);
    const set = new Set([3]);
    old.buffer = buffer; old.counts = map; old.tags = set;
    if (!storage) throw new Error("Context initializer did not supply storage");
    expect(storage(Memory).store.buffer[0]).toBe(buffer);
    expect(storage(Memory).store.counts[0]).toBe(map);
    expect(storage(Memory).store.tags[0]).toBe(set);
    expect(old.buffer).toBe(buffer);
    expect(old.counts).toBe(map);
    expect(old.tags).toBe(set);
    resetWorldContext(owner);
    expect(() => old.tick).toThrow(/disposed context/);
    expect(() => { old.buffer = null; }).toThrow(/disposed context/);
    map.set(8, 9); set.add(10); buffer[0] = 5;
    const fresh = worldContext(owner, Memory);
    expect(fresh.counts.size).toBe(0);
    expect(fresh.tags.size).toBe(0);
    expect(fresh.buffer).toBeNull();
    disposeWorldContext(owner);
    expect(() => fresh.counts).toThrow(/disposed context/);
    deleteWorld(owner);
  });

  test("reset/dispose are explicit and repeat-safe, and deletion prevents recreation", () => {
    const world = shape.create(4);
    worldContext(world, Memory).counts.set(1, 2);
    resetWorldContext(world);
    resetWorldContext(world);
    expect(worldContext(world, Memory).counts.size).toBe(0);
    disposeWorldContext(world);
    disposeWorldContext(world);
    expect(() => worldContext(world, Memory)).toThrow(/no live context/);
    resetWorldContext(world);
    expect(worldContext(world, Memory).tick).toBe(7);
    expect(() => worldContext(world, Person)).toThrow(/unregistered schema/);
    deleteWorld(world);
    deleteWorld(world);
    expect(() => initializeWorldContext(world, context)).toThrow(/disposed/);
    expect(() => resetWorldContext(world)).toThrow(/disposed/);
  });

  test("LeanGameModel destroys companion storage with its world", () => {
    const game = createLeanGameModel({ world: shape });
    expect(worldContext(game, Memory).tick).toBe(7);
    game.destroy();
    game.destroy();
    expect(() => worldContext(game, Memory)).toThrow(/no live context/);
  });

  test("ChunkHost replacement and unload dispose contexts; restoring makes fresh state", () => {
    const made: ReturnType<typeof shape.create>[] = [];
    const host = new ChunkHost({
      chunkSize: 100, tickRate: 10, warmEvery: 8, margin: 2, components: [Person],
      position: { component: Person, x: "x", y: "y" }, gid: { component: Person, field: "gid" }, world: shape,
      generate() { const world = shape.create(4); made.push(world); return world; },
      step() {}, render() {},
    });
    host.generate(0, 0, 1);
    const first = made[0];
    const payload = bytes(first);
    host.load(0, 0, payload);
    expect(() => worldContext(first, Memory)).toThrow(/no live context/);
    const restored = host.chunks.values().next();
    if (restored.done) throw new Error("Loaded chunk is missing");
    const back = restored.value.world;
    expect(worldContext(back, Memory).tick).toBe(7);
    expect(host.unload(0, 0)).toBeInstanceOf(Uint8Array);
    expect(() => worldContext(back, Memory)).toThrow(/no live context/);
  });
});
