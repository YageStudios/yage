import { addComponent, addEntity, Component, System, SystemImpl, type World } from "minecs";
import { describe, expect, test } from "vitest";
import { createLeanGameModel } from "yage/game/LeanGameModel";
import { Commands, drainCommands, pushCommand } from "yage/world/commands";

type Order = { kind: "add" | "mul"; value: number };

@Component("CommandsTestQueue")
class Orders extends Commands<Order> {}

@Component("CommandsTestOther")
class OtherOrders extends Commands<Order> {}

@System(Orders)
class Calculator extends SystemImpl<World> {
  static depth = 1;
  total = 1;
  run = (world: World, eid: number) => {
    drainCommands(world(Orders, eid), (order) => {
      this.total = order.kind === "add" ? this.total + order.value : this.total * order.value;
    });
  };
}

describe("command queues", () => {
  test("the owner drains in push order once, and the queue is empty after", () => {
    const model = createLeanGameModel({ world: { components: [Orders], systems: [Calculator] } });
    const eid = model.addEntity();
    model.addComponent(Orders, eid);
    const queue = model.single(Orders);
    pushCommand(queue, { kind: "add", value: 2 });
    pushCommand(queue, { kind: "mul", value: 4 });
    model.step();
    expect(model.getSystem(Calculator).total).toBe(12);
    expect(queue.commands).toEqual([]);
    model.step();
    expect(model.getSystem(Calculator).total).toBe(12);
    model.destroy();
  });

  test("commands pushed while draining run in the same drain", () => {
    const model = createLeanGameModel({ world: { components: [OtherOrders] } });
    const eid = model.addEntity();
    addComponent(model, OtherOrders, eid);
    const queue = model.single(OtherOrders);
    const seen: number[] = [];
    pushCommand(queue, { kind: "add", value: 1 });
    drainCommands(queue, (order) => {
      seen.push(order.value);
      if (order.value < 3) pushCommand(queue, { kind: "add", value: order.value + 1 });
    });
    expect(seen).toEqual([1, 2, 3]);
    expect(queue.commands).toEqual([]);
    model.destroy();
  });

  test("each entity gets its own queue", () => {
    const model = createLeanGameModel({ world: { components: [Orders] } });
    const a = model.addEntity();
    const b = model.addEntity();
    model.addComponent(Orders, a);
    model.addComponent(Orders, b);
    pushCommand(model.getTypedUnsafe(Orders, a), { kind: "add", value: 1 });
    expect(model.getTypedUnsafe(Orders, b).commands).toEqual([]);
    model.destroy();
  });
});
