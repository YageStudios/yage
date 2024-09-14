import type { Schema } from "minecs";
import type { ComponentCategory } from "yage/constants/enums";
import type { GameModel } from "yage/game/GameModel";

export const generateShareList = (
  entity: number,
  schema: typeof Schema,
  category: ComponentCategory,
  gameModel: GameModel
): [typeof Schema, number[]][] => {
  const shareList: { [key: string]: number[] } = {};
  const components = gameModel.getComponentSchemasByCategory(category, entity);

  if (!gameModel.hasComponent(schema, entity)) {
    return components.map((component) => [component, [entity]]);
  }

  const componentMap = components.reduce((acc, component) => {
    acc[component.type] = component;
    return acc;
  }, {} as { [key: string]: typeof Schema });

  components.forEach((component) => {
    if (!shareList[component.type]) {
      shareList[component.type] = [];
    }
    shareList[component.type].push(entity);
  });
  const data = gameModel.getComponent(schema, entity);
  if (data.entities) {
    for (let i = 0; i < data.entities.length; i++) {
      const entity = data.entities[i];
      const components = gameModel.getComponentSchemasByCategory(entity, category);

      components.forEach((component) => {
        if (!shareList[component.type]) {
          shareList[component.type] = [];
        }
        shareList[component.type].push(entity);
      });
    }
  }

  return Object.entries(shareList).reduce((acc, [key, value]) => {
    acc.push([componentMap[key], value]);
    return acc;
  }, [] as [typeof Schema, number[]][]);
};
