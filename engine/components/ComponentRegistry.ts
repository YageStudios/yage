import type { Schema } from "@/decorators/type";
import { componentSchemaString } from "@/decorators/type";
import type { System } from "@/components/System";
import type { ComponentData } from "@/components/types";
import { ComponentCategory } from "@/components/types";
import type { GameModel } from "@/game/GameModel";
import { ByteArray } from "@/utils/byteArray";
import type { PixiDrawSystem } from "@/components/PixiDrawSystem";
import type { UIService } from "@/ui/UIService";
import { Viewport } from "pixi-viewport";
import { assignGlobalSingleton, getGlobalSingleton, setGlobalSingleton } from "@/global";

/* 
    DEPTH MODEL FOLLOWS THE FOLLOWING PATTERN:
    Each enum is separated by 1000

    DEFAULT Depth of -1 means it won't run and must be a manually called system

    DEPTHS.ENUM - 0.00001 -- Should occur right before ENUM - Special cases only
    DEPTHS.ITEMS + 0.00001 -- Should occur right after ENUM - Special cases only 
    DEPTHS.ITEMS + 1 -- Anything that directly relates to the ENUM
    DEPTHS.ITEMS + 10 -- Anything that is tangentially related to the ENUM
    DEPTHS.ITEMS + 100 -- Anything that should occur after the ENUM but not related to it
*/

export enum DEPTHS {
  NORUN = -10000000,
  CORE = 0,
  KILLSTATS = 1,
  HEALTH = 1000,
  PLAYER_MOVEMENT = 2000,
  LOCOMOTION = 3000,
  COLLISION = 4000,
  DAMAGE = 5000,
  ITEMS = 6000,
  TRIGGERS = 7000,
  PREDRAW = 8000,
  DRAW = 9000,
}
export const getIndex = (type: typeof Schema | string | number): number => {
  let index: number;
  if (typeof type === "function") {
    // @ts-ignore
    index = componentIndexMap[type.__type];
  } else if (typeof type === "string") {
    index = componentIndexMap[type];
  } else {
    index = type as number;
  }
  return index;
};

assignGlobalSingleton("canRegisterComponents", () => true);

export const canRegisterComponents = (set?: boolean): boolean => {
  if (set !== undefined) {
    setGlobalSingleton("canRegisterComponents", set);
  }
  return getGlobalSingleton("canRegisterComponents");
};

export type RegistryComponent = {
  category: number;
  type: string;
  schema: any;
  depth: number;
};

type Constructor<T> = {
  new (...args: any[]): T;
};

export const componentList: RegistryComponent[] = assignGlobalSingleton("componentList", () => []);
export const componentIndexMap: { [key: string]: number } = assignGlobalSingleton("componentIndexMap", () => ({}));
export const componentsByCategory: { [key: string | number]: number[] } = assignGlobalSingleton(
  "componentsByCategory",
  () => ({})
);
export const systems: Constructor<System>[] = assignGlobalSingleton("systems", () => []);

export const uiComponents: {
  type: string;
  id: number;
  system: any;
  sort: any;
  cleanup?: (uiService: UIService, entity: number, gameModel: GameModel, ejecting: boolean) => void;
  debug?: boolean;
}[] = assignGlobalSingleton("uiComponents", () => []);

export const uiComponentsById: { [key: number]: number } = assignGlobalSingleton("uiComponentsById", () => ({}));

export const pixiDrawComponents: {
  type: string;
  id: number;
  system: any;
  zIndex: number;
}[] = assignGlobalSingleton("pixiDrawComponents", () => []);

export const editorComponents: {
  [key: string | number]: {
    type: string;
    id: number;
    system: any;
  };
} = assignGlobalSingleton("editorComponents", () => ({}));

function _registerSchema(category: ComponentCategory, schema: typeof Schema): void;
function _registerSchema(schema: typeof Schema): void;
function _registerSchema(category: ComponentCategory | typeof Schema, schema?: typeof Schema) {
  if (schema === undefined) {
    schema = category as typeof Schema;
    category = ComponentCategory.NONE;
  }
  const type = componentSchemaString.get(schema);
  if (!type) {
    throw new Error("Schema not registered as a component" + schema);
  }
  if (componentIndexMap[type]) {
    return;
  }
  componentIndexMap[type] = componentList.length;
  componentsByCategory[category as ComponentCategory] = componentsByCategory[category as ComponentCategory] ?? [];
  componentsByCategory[category as ComponentCategory].push(componentList.length);

  componentList.push({
    category: category as ComponentCategory,
    type,
    schema,
    depth: -1,
  });

  componentsByCategory[category as ComponentCategory].sort((a, b) => {
    const aDepth = componentList[a].depth;
    const bDepth = componentList[b].depth;
    if (aDepth === bDepth) {
      return a - b;
    } else {
      return aDepth - bDepth;
    }
  });
}

export const registerSchema = _registerSchema;

export const registerSystem = (system: Constructor<System>) => {
  if (!canRegisterComponents()) {
    throw new Error("Cannot register components after game has started");
  }
  systems.push(system);

  // if (componentIndexMap[system.type] !== undefined) {
  //   throw new Error(`Component ${system.type} already registered`);
  // }
  // componentIndexMap[system.type] = componentList.length;
  // componentsByCategory[system.category] =
  //   componentsByCategory[system.category] ?? [];
  // componentsByCategory[system.category].push(componentList.length);
  // componentList.push({
  //   category: system.category,
  //   type: system.type,
  //   schema: system.schema,
  //   system: system.run?.bind(system),
  //   cleanup: system.cleanup?.bind(system),
  //   init: system.init?.bind(system),
  //   depth: system.depth ?? -1,
  // });
};

export const generateSystems = (gameModel: GameModel) => {
  const modelSystems: { [key: string]: System } = {};
  systems.forEach((systemConstructor) => {
    const system = new systemConstructor(gameModel);
    const type = system.type;
    // @ts-ignore
    system.constructor.__type = type;
    if (!componentIndexMap[type]) {
      componentIndexMap[type] = componentList.length;
      // @ts-ignore
      const category = system.category ?? system.schema.__category ?? ComponentCategory.NONE;
      componentsByCategory[category] = componentsByCategory[category] ?? [];
      componentsByCategory[category].push(componentList.length);
      componentList.push({
        category: category,
        type: type,
        schema: system.schema,
        depth: system.depth ?? -1,
      });
      const pixiDrawComponent = pixiDrawComponents.find((c) => c.type === type);
      if (pixiDrawComponent !== undefined) {
        pixiDrawComponent.id = componentIndexMap[type];
      }
      const drawComponent = uiComponents.find((c) => c.type === type);
      if (drawComponent !== undefined) {
        drawComponent.id = componentIndexMap[type];
      }
    }

    modelSystems[type] = system;
  });
  return modelSystems;
};

export const generateRunList = (systems: System[]) => {
  const runList = systems
    .slice()
    .filter((system) => (system.depth ?? -1) >= 0)
    .sort((a, b) => {
      const diff = (a.depth ?? 0) - (b.depth ?? 0);
      if (diff === 0) {
        return a.type.localeCompare(b.type);
      } else {
        return diff;
      }
    });
  return [
    runList.filter((system) => (system.depth ?? 0) < DEPTHS.PREDRAW).map((c) => c.type),
    runList.filter((system) => (system.depth ?? 0) >= DEPTHS.PREDRAW).map((c) => c.type),
  ];
};

export const registerPixiComponent = (type: string, system: new () => PixiDrawSystem, zIndex = 0) => {
  if (!canRegisterComponents()) {
    throw new Error("Cannot register component after game has started");
  }
  // if (componentIndexMap[type] === undefined) {
  //   throw new Error(`Component ${type} not registered`);
  // }
  system.prototype.__type = type;
  pixiDrawComponents.push({
    type: type,
    id: -1,
    system,
    zIndex,
  });
};

export const registerUIComponent = (
  type: string,
  system: (uiService: UIService, id: number, gameModel: GameModel, viewport: Viewport) => void,
  options: {
    sort?: any;
    debug?: boolean;
    cleanup?: (uiService: UIService, id: number, gameModel: GameModel, ejecting: boolean) => void;
  } = { sort: undefined, debug: false, cleanup: undefined }
) => {
  if (!canRegisterComponents()) {
    throw new Error("Cannot register component after game has started");
  }
  // if (componentIndexMap[type] === undefined) {
  //   throw new Error(`Component ${type} not registered`);
  // }
  uiComponents.push({
    type,
    id: -1,
    system,
    cleanup: options.cleanup,
    sort: options.sort,
    debug: options.debug,
  });
};

export const registerEditorComponent = (
  type: string,
  system: (el: HTMLElement, id: number, gameModel: GameModel, editorFunctions: any) => void
) => {
  if (!canRegisterComponents()) {
    throw new Error("Cannot register component after game has started");
  }
  // if (componentIndexMap[type] === undefined) {
  //   throw new Error(`Component ${type} not registered`);
  // }
  editorComponents[type] = {
    type,
    id: componentIndexMap[type],
    system,
  };
};

export const componentRegistered = (type: string) => {
  if (canRegisterComponents()) {
    throw new Error("Cannot check if component is registered before game has started");
  }
  return componentIndexMap[type] !== undefined;
};

export const generateComponentIndexArray = (initialComponents: ComponentData[] = []): ByteArray => {
  const byteArray = new ByteArray();
  for (let i = 0; i < initialComponents.length; i++) {
    byteArray.enable(componentIndexMap[initialComponents[i].type]);
  }
  return byteArray;
};
