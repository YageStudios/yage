import { addComponent, addEntity, Component, createWorld, defaultValue, deleteWorld, Schema, stepWorld, System, SystemImpl, type, type World } from "minecs";
import { describe, expect, test } from "vitest";
import { assertStackOrder } from "yage/testing/order";
import { forgetStacks, runStack, stackSystems } from "yage/world/stacks";

@Component("StacksTestTally")
class Tally extends Schema {
  @type("number") @defaultValue(0) value: number;
}

@Component("StacksTestUnused")
class Unused extends Schema {
  @type("number") @defaultValue(0) value: number;
}

const ran: string[] = [];

@System(Tally)
class MainStep extends SystemImpl<World> {
  static depth = 5;
  runAll() { ran.push("main"); }
}

// Listed out of order on purpose: the stack runs by stackDepth, not by declaration or list order.
@System(Tally)
class Late extends SystemImpl<World> {
  static depth = -1;
  static stack = "present";
  static stackDepth = 20;
  runAll() { ran.push("late"); }
}

@System(Tally)
class Early extends SystemImpl<World> {
  static depth = -1;
  static stack = "present";
  static stackDepth = 10;
  runAll(world: World) {
    ran.push("early");
    for (const eid of this.query(world)) world(Tally).store.value[eid]++;
  }
}

@System(Tally)
class Other extends SystemImpl<World> {
  static depth = -1;
  static stack = "restore";
  static stackDepth = 1;
  runAll() { ran.push("restore"); }
}

@System(Unused)
class EmptyQuery extends SystemImpl<World> {
  static depth = -1;
  static stack = "present";
  static stackDepth = 15;
  runAll() { ran.push("empty"); }
}

@System(Unused)
class EmptyButRuns extends SystemImpl<World> {
  static depth = -1;
  static stack = "present";
  static stackDepth = 16;
  static runEmpty = true;
  runAll() { ran.push("runEmpty"); }
}

@System(Tally)
class Misplaced extends SystemImpl<World> {
  static depth = 3;
  static stack = "broken";
}

const make = (systems: (typeof SystemImpl<any>)[]) => {
  const world = createWorld(16, { components: [Tally, Unused], systems }) as World;
  const eid = addEntity(world);
  addComponent(world, Tally, eid);
  return { world, eid };
};

describe("named system stacks", () => {
  test("a stack runs its systems by stackDepth, with the main step's query rule", () => {
    const { world } = make([Late, MainStep, Other, EmptyButRuns, Early, EmptyQuery]);
    expect(stackSystems(world, "present").map((s) => s.constructor.name)).toEqual(["Early", "EmptyQuery", "EmptyButRuns", "Late"]);
    ran.length = 0;
    runStack(world, "present");
    expect(ran).toEqual(["early", "runEmpty", "late"]);
    ran.length = 0;
    runStack(world, "restore");
    expect(ran).toEqual(["restore"]);
    deleteWorld(world);
  });

  test("the main step runs only the default stack", () => {
    const { world, eid } = make([Late, MainStep, Other, Early]);
    ran.length = 0;
    stepWorld(world);
    stepWorld(world);
    expect(ran).toEqual(["main", "main"]);
    expect(world(Tally).store.value[eid]).toBe(0);
    runStack(world, "present");
    expect(world(Tally).store.value[eid]).toBe(1);
    deleteWorld(world);
  });

  test("an unknown stack is empty, and a stack system with a step depth is refused", () => {
    const { world } = make([MainStep]);
    expect(stackSystems(world, "nothing")).toEqual([]);
    runStack(world, "nothing");
    const bad = make([Misplaced]).world;
    expect(() => runStack(bad, "broken")).toThrow(/Misplaced.*depth -1/);
    deleteWorld(world);
    deleteWorld(bad);
  });

  test("teardown: each world runs its own instances, and forgetStacks rebuilds the list", () => {
    const first = make([Early]);
    const second = make([Early]);
    const firstEarly = stackSystems(first.world, "present")[0];
    expect(stackSystems(second.world, "present")[0]).not.toBe(firstEarly);
    runStack(first.world, "present");
    expect(first.world(Tally).store.value[first.eid]).toBe(1);
    expect(second.world(Tally).store.value[second.eid]).toBe(0);
    deleteWorld(first.world);
    forgetStacks(first.world);
    const rebuilt = stackSystems(first.world, "present");
    expect(rebuilt).not.toBe(stackSystems(second.world, "present"));
    expect(rebuilt[0]).toBe(firstEarly);
    deleteWorld(second.world);
  });

  test("assertStackOrder checks a list against runStack's order and membership", () => {
    expect(() => assertStackOrder([Early, EmptyQuery, EmptyButRuns, Late], "present")).not.toThrow();
    expect(() => assertStackOrder([Late, Early], "present")).toThrow(/listed Late \(stackDepth 20\) at 0, but Early/);
    expect(() => assertStackOrder([Early, Other], "present")).toThrow(/Other is not a "present" stack system/);
    expect(() => assertStackOrder([MainStep], "present")).toThrow(/MainStep/);
  });
});
