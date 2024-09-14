import { UIService } from "yage/ui/UIService";
import { ComponentCategory } from "../types";
import type { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import { FrameRate, Frame, FrameEnd } from "yage/schemas/core/FrameRate";
import type { QueryInstance } from "minecs";
import { DrawSystemImpl, System, SystemImpl } from "minecs";
import { DEPTHS } from "yage/constants/enums";
import type { UIElement } from "yage/ui/UIElement";
import AssetLoader from "yage/loader/AssetLoader";
import type { UiMap } from "yage/ui/UiMap";
import { buildUiMap } from "yage/ui/UiMap";

@System(FrameRate, Frame)
class FrameStartSystem extends SystemImpl<GameModel> {
  type = "FrameStart";
  static category: ComponentCategory = ComponentCategory.CORE;
  static depth = DEPTHS.CORE;

  run = (gameModel: GameModel, entity: number) => {
    gameModel(Frame, entity).frame = gameModel.frame;
    const data = gameModel.getSystem(FrameRateSystem).get(entity);

    const startFrameStamp = performance.now();
    data.frameRate = 1000 / (startFrameStamp - data.startFrameStamp);
    data.startFrameStamp = startFrameStamp;
  };
}

@System(FrameEnd, Frame)
class FrameEndSystem extends SystemImpl<GameModel> {
  static category: ComponentCategory = ComponentCategory.CORE;
  static depth = DEPTHS.DRAW + 100000;

  run = (gameModel: GameModel, entity: number) => {
    const data = gameModel.getSystem(FrameRateSystem).get(entity);
    data.stopFrameStamp = performance.now();

    data.averageFrameRate = data.averageFrameRate - data.averageFrameRate / 100 + data.frameRate / 100;
  };
  cleanup = () => {
    if (ui) {
      UIService.getInstance().removeFromUI(ui);
      ui = null;
    }
  };
}

@System(FrameRate)
export class FrameRateSystem extends SystemImpl<GameModel> {
  static category: ComponentCategory = ComponentCategory.CORE;

  entities: {
    [key: number]: {
      startFrameStamp: number;
      frameRate: number;
      stopFrameStamp: number;
      averageFrameRate: number;
      bodies: number;
    };
  } = {};
  init = (gameModel: GameModel, entity: number) => {
    this.entities[entity] = {
      startFrameStamp: performance.now(),
      frameRate: 0,
      stopFrameStamp: 0,
      averageFrameRate: 60,
      bodies: 0,
    };

    gameModel.addComponent("Frame", entity);
    gameModel.addComponent("FrameStart", entity);
    gameModel.addComponent("FrameEnd", entity);
  };

  get(entity: number) {
    return (
      this.entities[entity] ||
      (this.entities[entity] = {
        startFrameStamp: 0,
        frameRate: 0,
        stopFrameStamp: 0,
        averageFrameRate: 60,
        bodies: 0,
      })
    );
  }
}

let ui: UIElement[] | null = null;

@System(FrameRate)
export class RenderFramerateSystem extends DrawSystemImpl<ReadOnlyGameModel> {
  ui: UIElement[] | null = null;
  uiService: UIService;
  uiMap: UiMap;

  constructor(query: QueryInstance) {
    super(query);
    this.uiService = UIService.getInstance();
  }

  init = (gameModel: ReadOnlyGameModel, entity: number) => {
    const uiMap = gameModel(FrameRate, entity).uiMap;
    if (uiMap) {
      this.uiMap = buildUiMap(AssetLoader.getInstance().getUi(uiMap));
      this.ui = [];
      this.ui.push(...Object.values(this.uiMap.build({ frame: 0, frameRate: 0, bodies: 0, ping: 0 }, () => {})));
      for (const ui of this.ui) {
        this.uiService.addToUI(ui);
      }
    }
  };

  run = (gameModel: ReadOnlyGameModel, entity: number) => {
    if (this.ui === null) {
      return;
    }
    const data = gameModel.getSystem(FrameRateSystem).get(entity);
    this.uiMap.update({
      frame: gameModel(Frame, entity).frame,
      frameRate: data.averageFrameRate.toFixed(0),
      bodies: data.bodies,
      ping: gameModel.ping,
    });
  };

  cleanup = (gameModel: ReadOnlyGameModel, entity: number) => {
    if (this.ui) {
      this.uiService.removeFromUI(this.ui);
      this.ui = null;
    }
  };
}

// registerUIComponent("FrameRate", (uiService, entity, renderModel) => {
//   if (!ui) {
//     ui = [];

//     const currentFrame = new Text(new Rectangle(1600, 35, 1, 1), {
//       label: "Frame: 0",
//       style: {
//         textTransform: "uppercase",
//       },
//       fontSize: 16,
//     });
//     ui.push(currentFrame);
//     uiService.addToUI(currentFrame);

//     const frameTime = new Text(new Rectangle(1600, 55, 1, 1), {
//       label: "000.0MS",
//       style: {
//         textTransform: "uppercase",
//       },
//       fontSize: 16,
//     });
//     ui.push(frameTime);
//     uiService.addToUI(frameTime);
//     const frameRate = new Text(new Rectangle(1600, 70, 1, 1), {
//       label: "00FPS",
//       style: {
//         textTransform: "uppercase",
//       },
//       fontSize: 16,
//     });
//     ui.push(frameRate);
//     uiService.addToUI(frameRate);
//     const activeEntities = new Text(new Rectangle(1600, 85, 1, 1), {
//       label: "0000ENT",
//       style: {
//         textTransform: "uppercase",
//       },
//       fontSize: 16,
//     });
//     ui.push(activeEntities);
//     uiService.addToUI(activeEntities);
//     const activeBodies = new Text(new Rectangle(1600, 100, 1, 1), {
//       label: "0000BOD",
//       style: {
//         textTransform: "uppercase",
//       },
//       fontSize: 16,
//     });
//     ui.push(activeBodies);
//     uiService.addToUI(activeBodies);

//     const playerPos = new Text(new Rectangle(1600, 115, 1, 1), {
//       label: "0X 0Y",
//       fontSize: 16,
//       style: {
//         textTransform: "uppercase",
//       },
//     });
//     ui.push(playerPos);
//     uiService.addToUI(playerPos);

//     const ping = new Text(new Rectangle(1600, 130, 1, 1), {
//       label: "0MS PING",
//       fontSize: 16,
//       style: {
//         textTransform: "uppercase",
//       },
//     });
//     ui.push(ping);
//     uiService.addToUI(ping);
//   }
//   const data = renderModel.gameModel.getSystem(FrameRateSystem).get(entity);

//   const fps = data.stopFrameStamp - data.startFrameStamp;

//   ui[0].config.label = `Frame: ${Frame.store.frame[0]}`;
//   ui[1].config.label = fps.toFixed(1).padStart(4, "0") + "MS";
//   ui[3].config.label =
//     (renderModel.gameModel.bitecsWorld?.entitySparseSet.dense || []).length.toString().padStart(4, "0") + "ENT";

//   ui[4].config.label = data.bodies.toString().padStart(4, "0") + "BOD";

//   ui[6].config.label = renderModel.gameModel.ping + "MS PING";

//   const player = renderModel.gameModel.players[0];
//   const transform = renderModel.getTypedUnsafe(player, Transform);
//   const pos = transform.position;
//   ui[5].config.label = `${pos.x.toFixed(0)}X ${pos.y.toFixed(0)}Y`;
// });

// class PixiFrameRate implements PixiDrawSystem {
//   ids: Set<number>;
//   init: (entity: number, renderModel: RenderModel) => void;
//   run(entity: number, renderModel: RenderModel) {
//     const data = renderModel.gameModel.getSystem(FrameRateSystem).get(entity);

//     if (ui) {
//       ui[2].config.label = data.averageFrameRate.toFixed(0) + "FPS";
//     }
//   }
//   cleanup: (entity: number, renderModel: RenderModel) => void;
// }

// registerPixiComponent("FrameRate", PixiFrameRate);
