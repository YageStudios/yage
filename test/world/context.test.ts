import { Component, Schema, addComponent, addEntity, defaultValue, type } from "minecs";
import { describe, expect, test } from "vitest";
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
}
const context: WorldContextSpec = {
  components: [Memory],
  initialize(world, entity) { world(Memory, entity).counts = new Map(); },
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
    const back = host.chunks.values().next().value!.world;
    expect(worldContext(back, Memory).tick).toBe(7);
    expect(host.unload(0, 0)).toBeInstanceOf(Uint8Array);
    expect(() => worldContext(back, Memory)).toThrow(/no live context/);
  });
});
