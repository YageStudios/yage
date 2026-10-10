import { createWorld } from "minecs";
import { describe, expect, test } from "vitest";
import { EntityFactory, type FlexibleEntityDefinition } from "yage/entity/EntityFactory";
import { GameModel } from "yage/game/GameModel";
import { InputManager } from "yage/inputs/InputManager";
import { PlayerEventManager } from "yage/inputs/PlayerEventManager";
import { Transform } from "yage/schemas/entity/Transform";
import { stageEntityDefinition } from "yage/dev/hotReload";

const files = {
  tree: "factory-hot-reload/entities/Tree.json5",
  leaf: "factory-hot-reload/entities/Leaf.json5",
  baseTree: "factory-hot-reload/entities/BaseTree.json5",
  baseLeaf: "factory-hot-reload/entities/BaseLeaf.json5",
};

const registerDefinitions = (definitions: FlexibleEntityDefinition[]) => {
  for (const [key, definition] of Object.entries({
    tree: definitions.find(item => item.name === "Tree")!,
    leaf: definitions.find(item => item.name === "Leaf")!,
    baseTree: definitions.find(item => item.name === "BaseTree")!,
    baseLeaf: definitions.find(item => item.name === "BaseLeaf")!,
  })) {
    stageEntityDefinition(files[key as keyof typeof files], definition, () => {});
  }
  EntityFactory.configureEntityFactory(definitions);
};

describe("EntityFactory hot defaults", () => {
  test("patches inherited root and child defaults in existing entities, then spawns from the updated factory", () => {
    const definitions: FlexibleEntityDefinition[] = [
      { name: "BaseTree", components: [{ type: "Transform", data: { x: 1, y: 5 } }] },
      { name: "Tree", inherits: "BaseTree", children: ["Leaf"] },
      { name: "BaseLeaf", components: [{ type: "Transform", data: { x: 10, y: 2 } }] },
      { name: "Leaf", inherits: "BaseLeaf", components: [{ type: "Child", data: { autoAttach: false } }] },
    ];
    registerDefinitions(definitions);

    const gameModel = GameModel({
      seed: "factory-hot-reload",
      roomId: "factory-hot-reload",
      world: createWorld(),
      inputManager: new InputManager(),
      playerEventManager: new PlayerEventManager(),
    });
    const initialFactory = EntityFactory.getInstance();
    const initialDTO = initialFactory.mapEntityComponent(gameModel, "Tree");
    const initialTree = initialFactory.createEntity(gameModel, initialDTO);
    const initialLeaf = gameModel.getEntityByDescription("Leaf")![0];
    gameModel(Transform, initialTree).y = 19;

    const updatedBaseTree = {
      name: "BaseTree",
      components: [{ type: "Transform", data: { x: 3, y: 6 } }],
    };
    const updatedBaseLeaf = {
      name: "BaseLeaf",
      components: [{ type: "Transform", data: { x: 20, y: 4 } }],
    };
    expect(stageEntityDefinition(files.baseTree, updatedBaseTree, () => {})).toBe(true);
    expect(stageEntityDefinition(files.baseLeaf, updatedBaseLeaf, () => {})).toBe(true);

    gameModel.step();

    expect(gameModel(Transform, initialTree).x).toBe(3);
    expect(gameModel(Transform, initialTree).y).toBe(19);
    expect(gameModel(Transform, initialLeaf).x).toBe(20);

    const updatedFactory = EntityFactory.getInstance();
    const spawnedTree = updatedFactory.createEntity(
      gameModel,
      updatedFactory.mapEntityComponent(gameModel, "Tree")
    );
    const spawnedLeaf = gameModel.getEntityByDescription("Leaf")!.find(entity => entity !== initialLeaf)!;
    expect(gameModel(Transform, spawnedTree).x).toBe(3);
    expect(gameModel(Transform, spawnedTree).y).toBe(6);
    expect(gameModel(Transform, spawnedLeaf).x).toBe(20);
  });
});
