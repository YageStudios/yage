// A worker-shaped entry: only the lean world, the definitions core, and the game's own schemas
// and systems. The hygiene test bundles this and checks nothing else from the engine comes along.
import { Component, Schema, System, SystemImpl, defaultValue, type, type World } from "minecs";
import { EntityDefinitionRegistry } from "yage/entity/definitions";
import { leanWorldType } from "yage/world/lean";

@Component("HygienePos")
class HygienePos extends Schema {
  @type("number") @defaultValue(0) x: number;
}

@System(HygienePos)
class HygieneMove extends SystemImpl<World> {
  run = (world: World, eid: number) => {
    world(HygienePos, eid).x++;
  };
}

const Chunk = leanWorldType({ systems: [HygieneMove] });
const registry = new EntityDefinitionRegistry([{ name: "Dot", components: [{ type: "HygienePos", data: { x: 1 } }] }]);
self.onmessage = () => {
  const world = Chunk.create(16);
  registry.compile("Dot").spawn(world);
  postMessage(world.entitySparseSet.dense.length);
};
