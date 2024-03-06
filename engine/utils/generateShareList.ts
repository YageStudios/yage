import { ComponentCategory } from "@/constants/enums";
import { Schema } from "@/decorators/type";
import { GameModel } from "@/game/GameModel";

export const generateShareList = (
  entity: number,
  schema: typeof Schema,
  category: ComponentCategory,
  gameModel: GameModel
): [number, number[]][] => {
  const shareList: { [key: number]: number[] } = {};
  const components = gameModel.getComponentIdsByCategory(entity, category);

  if (!gameModel.hasComponent(entity, schema)) {
    return components.map((component) => [component, [entity]]);
  }

  components.forEach((component) => {
    if (!shareList[component]) {
      shareList[component] = [];
    }
    shareList[component].push(entity);
  });
  const data = gameModel.getComponentUnsafe(entity, schema);
  if (data.entities) {
    for (let i = 0; i < data.entities.length; i++) {
      const entity = data.entities[i];
      const components = gameModel.getComponentIdsByCategory(entity, category);

      components.forEach((component) => {
        if (!shareList[component]) {
          shareList[component] = [];
        }
        shareList[component].push(entity);
      });
    }
  }

  return Object.entries(shareList)
    .reduce((acc, [key, value]) => {
      acc.push([parseInt(key), value]);
      return acc;
    }, [] as [number, number[]][])
    .sort((a, b) => {
      const aDepth = gameModel.getDepth(a[0]);
      const bDepth = gameModel.getDepth(b[0]);
      return aDepth - bDepth;
    });
};
