import { Component, Schema, addEntity, createWorld, defaultValue, type } from "minecs";
import { describe, expect, test } from "vitest";
import {
  EntityDefinitionRegistry,
  compileEntityDefinition,
  definitionsFromModules,
  mapDefinitionValues,
  orderComponents,
  resolveDefinitions,
  systemDependencies,
} from "yage/entity/definitions";

@Component("DefsTestPos")
class DefsTestPos extends Schema {
  @type("number") @defaultValue(0) x: number;
  @type("number") @defaultValue(0) y: number;
}

@Component("DefsTestBag")
class DefsTestBag extends Schema {
  @type(["string"]) @defaultValue([]) items: string[];
  @type("number") @defaultValue(0) tint: number;
}

const seq = (values: number[]) => {
  let i = 0;
  return { number: () => values[i++ % values.length], int: (min: number, max?: number) => (max ?? min) - 1 };
};

describe("resolveDefinitions", () => {
  test("merges components by type, concatenates children, keeps input order with parents later", () => {
    const map = resolveDefinitions([
      { name: "Child", inherits: "Base", children: ["c"], components: ["Tag", { type: "Pos", data: { x: 2 } }] },
      { name: "Base", type: "enemy", children: ["b"], components: [{ type: "Pos", data: { x: 1, y: 1 } }, { type: "Hp" }] },
    ]);
    expect([...map.keys()]).toEqual(["child", "base"]);
    const child = map.get("child")!;
    expect(child.type).toBe("enemy");
    expect(child.children).toEqual(["b", "c"]);
    expect(child.components).toEqual([{ type: "Pos", data: { x: 2 } }, { type: "Hp" }, { type: "Tag" }]);
  });

  test("folds several parents left to right and reports unknown parents and cycles", () => {
    const map = resolveDefinitions([
      { name: "A", components: [{ type: "P", v: 1 }] },
      { name: "B", components: [{ type: "P", v: 2 }, { type: "Q" }] },
      { name: "C", inherits: ["A", "B"] },
    ]);
    expect(map.get("c")!.components).toEqual([{ type: "P", v: 2 }, { type: "Q" }]);
    expect(() => resolveDefinitions([{ name: "X", inherits: "Nope" }])).toThrow(/unknown definition "nope"/);
    expect(() => resolveDefinitions([{ name: "X", inherits: "Y" }, { name: "Y", inherits: "X" }])).toThrow(/cycle/);
  });

  test("does not mutate the input", () => {
    const input = [{ name: "A", components: ["T" as const] }];
    resolveDefinitions(input);
    expect(input[0].components).toEqual(["T"]);
  });

  test("definitionsFromModules sorts by path, unwraps default and flattens arrays", () => {
    const defs = definitionsFromModules({
      "./b.json5": { default: [{ name: "b1" }, { name: "b2" }] },
      "./a.json5": { default: { name: "a" } },
    });
    expect(defs.map((d) => d.name)).toEqual(["a", "b1", "b2"]);
  });
});

describe("value mappers", () => {
  test("maps rand, randint, enum, rgb, playercount and keys", () => {
    const enums = (name: string) => (name === "Color" ? { RED: 3 } : undefined);
    const out = mapDefinitionValues(
      { a: "rand:10:20", b: "randint:5", c: "enum:Color.red", d: "rgb:#ff0080", e: "playercount:2", ["enum:Color.RED"]: 1, f: ["rand:"] },
      { rand: seq([0.5]), enums, playerCount: 3 }
    );
    expect(out).toEqual({ a: 15, b: 4, c: 3, d: 0xff0080, e: 6, 3: 1, f: [0.5] });
  });

  test("a random value without a random source is a clear error", () => {
    expect(() => mapDefinitionValues({ a: "rand:" })).toThrow(/needs a random source/);
  });
});

describe("orderComponents", () => {
  test("puts dependency-free components first and dependents after their dependencies", () => {
    const deps = (t: string) => ({ Child: ["Transform"], Attach: ["Child", "Transform"] } as Record<string, string[]>)[t];
    const order = orderComponents([{ type: "Attach" }, { type: "Child" }, { type: "Transform" }, { type: "Sprite" }], deps);
    expect(order.map((c) => c.type)).toEqual(["Transform", "Sprite", "Child", "Attach"]);
  });

  test("systemDependencies reads instance dependencies per query component", () => {
    class Sys {
      static queryKey = "Child|Other";
      dependencies = ["Transform"];
    }
    const resolver = systemDependencies([Sys]);
    expect(resolver("Child")).toEqual(["Transform"]);
    expect(resolver("Other")).toEqual(["Transform"]);
    expect(resolver("None")).toBeUndefined();
  });
});

describe("registry and compile", () => {
  const registry = new EntityDefinitionRegistry([
    { name: "Npc", components: [{ type: "DefsTestPos", data: { x: "randint:10", y: 2 } }, { type: "DefsTestBag", items: ["a"], tint: "rgb:#000010" }] },
    { name: "Static", components: [{ type: "DefsTestPos", data: { x: 1, y: 2 } }] },
  ]);

  test("lookups are case-insensitive and copies are independent", () => {
    expect(registry.has("NPC")).toBe(true);
    const a = registry.get("npc");
    a.components![0].data.y = 99;
    expect(registry.peek("npc")!.components![0].data.y).toBe(2);
    expect(registry.withComponent("DefsTestBag").map((d) => d.name)).toEqual(["Npc"]);
    expect(registry.component("Static", "DefsTestPos")).toEqual({ type: "DefsTestPos", data: { x: 1, y: 2 } });
    expect(() => registry.get("missing")).toThrow(/unknown entity definition/);
  });

  test("spawns into a world with per-spawn random values and unshared arrays", () => {
    const world = createWorld(16);
    const spawn = registry.compile("Npc");
    expect(registry.compile("npc")).toBe(spawn);
    const a = spawn.spawn(world, { rand: seq([0]) });
    const b = addEntity(world);
    spawn.apply(world, b, { rand: seq([0]), overrides: { DefsTestPos: { y: 7 } } });
    expect(world(DefsTestPos, a).x).toBe(9);
    expect(world(DefsTestPos, b).y).toBe(7);
    expect(world(DefsTestBag, a).tint).toBe(0x10);
    world(DefsTestBag, a).items.push("z");
    expect(world(DefsTestBag, b).items).toEqual(["a"]);
  });

  test("an unknown component is an error unless skipped", () => {
    const def = { name: "Bad", components: [{ type: "NoSuchSchema" }] };
    expect(() => compileEntityDefinition(def)).toThrow(/no registered schema/);
    expect(compileEntityDefinition(def, { unknownComponents: "skip" }).components).toEqual([]);
  });
});
