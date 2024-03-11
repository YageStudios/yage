import { DEPTHS, registerUIComponent, registerPixiComponent, registerSystem } from "@/components/ComponentRegistry";
import { Rectangle } from "@/ui/Rectangle";
import type { UIElement } from "@/ui/UIElement";
import { Text } from "@/ui/Text";
import { UIService } from "@/ui/UIService";
import { ComponentCategory } from "../types";
import type { GameModel, GameState } from "@/game/GameModel";
import type { System } from "../System";
import type { PixiDrawSystem } from "../PixiDrawSystem";
import { FrameRateSchema, FrameSchema } from "@/schemas/core/FrameRate";
import { TransformSchema } from "@/schemas/entity/Transform";

class FrameStartSystem implements System {
  type = "FrameStart";
  category: ComponentCategory = ComponentCategory.CORE;
  depth = DEPTHS.CORE;
  schema = FrameRateSchema;

  run(entity: number, gameModel: GameModel) {
    FrameSchema.store.frame[0] = gameModel.frame;
    FrameSchema.store.__changes[0] = 1;

    const data = gameModel.getTypedUnsafe(entity, FrameRateSchema);
    const startFrameStamp = performance.now();
    data.frameRate = 1000 / (startFrameStamp - data.startFrameStamp);
    data.startFrameStamp = startFrameStamp;
  }
}

class FrameEndSystem implements System {
  type = "FrameEnd";
  category: ComponentCategory = ComponentCategory.CORE;
  depth = DEPTHS.DRAW + 100000;
  schema = FrameRateSchema;

  run(entity: number, gameModel: GameModel) {
    const data = gameModel.getTypedUnsafe(entity, FrameRateSchema);
    data.stopFrameStamp = performance.now();

    data.averageFrameRate = data.averageFrameRate - data.averageFrameRate / 100 + data.frameRate / 100;
  }
  cleanup() {
    if (ui) {
      UIService.getInstance().removeFromUI(ui);
      ui = null;
    }
  }
}

class FrameRateSystem implements System {
  type = "FrameRate";
  category: ComponentCategory = ComponentCategory.CORE;
  schema = FrameRateSchema;
  init(entity: number, gameModel: GameModel) {
    gameModel.addComponent(entity, "Frame");
    gameModel.addComponent(entity, "FrameStart");
    gameModel.addComponent(entity, "FrameEnd");
  }
}

registerSystem(FrameStartSystem);
registerSystem(FrameEndSystem);
registerSystem(FrameRateSystem);

let ui: UIElement[] | null = null;

registerUIComponent("FrameRate", (uiService, entity, gameModel) => {
  if (!ui) {
    ui = [];

    const currentFrame = new Text(new Rectangle(1600, 35, 1, 1), {
      label: "Frame: 0",
      style: {
        textTransform: "uppercase",
      },
      fontSize: 16,
    });
    ui.push(currentFrame);
    uiService.addToUI(currentFrame);

    const frameTime = new Text(new Rectangle(1600, 55, 1, 1), {
      label: "000.0MS",
      style: {
        textTransform: "uppercase",
      },
      fontSize: 16,
    });
    ui.push(frameTime);
    uiService.addToUI(frameTime);
    const frameRate = new Text(new Rectangle(1600, 70, 1, 1), {
      label: "00FPS",
      style: {
        textTransform: "uppercase",
      },
      fontSize: 16,
    });
    ui.push(frameRate);
    uiService.addToUI(frameRate);
    const activeEntities = new Text(new Rectangle(1600, 85, 1, 1), {
      label: "0000ENT",
      style: {
        textTransform: "uppercase",
      },
      fontSize: 16,
    });
    ui.push(activeEntities);
    uiService.addToUI(activeEntities);
    const activeBodies = new Text(new Rectangle(1600, 100, 1, 1), {
      label: "0000BOD",
      style: {
        textTransform: "uppercase",
      },
      fontSize: 16,
    });
    ui.push(activeBodies);
    uiService.addToUI(activeBodies);

    const playerPos = new Text(new Rectangle(1600, 115, 1, 1), {
      label: "0X 0Y",
      fontSize: 16,
      style: {
        textTransform: "uppercase",
      },
    });
    ui.push(playerPos);
    uiService.addToUI(playerPos);

    const ping = new Text(new Rectangle(1600, 130, 1, 1), {
      label: "0MS PING",
      fontSize: 16,
      style: {
        textTransform: "uppercase",
      },
    });
    ui.push(ping);
    uiService.addToUI(ping);
  }
  const data = gameModel.getTypedUnsafe(entity, FrameRateSchema);

  const fps = data.stopFrameStamp - data.startFrameStamp;

  ui[0].config.label = `Frame: ${FrameSchema.store.frame[0]}`;
  ui[1].config.label = fps.toFixed(1).padStart(4, "0") + "MS";
  ui[3].config.label = ((gameModel.state as GameState).activeEntities || []).length.toString().padStart(4, "0") + "ENT";

  ui[4].config.label = data.bodies.toString().padStart(4, "0") + "BOD";

  ui[6].config.label = gameModel.ping + "MS PING";

  const player = gameModel.players[0];
  const transformSchema = gameModel.getTypedUnsafe(player, TransformSchema);
  const pos = transformSchema.position;
  if (pos.x && pos.y) {
    ui[5].config.label = `${pos.x.toFixed(0)}X ${pos.y.toFixed(0)}Y`;
  }
});

class PixiFrameRate implements PixiDrawSystem {
  ids: Set<number>;
  init: (entity: number, gameModel: GameModel) => void;
  run(entity: number, gameModel: GameModel) {
    const data = gameModel.getTypedUnsafe(entity, FrameRateSchema);

    if (ui) {
      ui[2].config.label = data.averageFrameRate.toFixed(0) + "FPS";
    }
  }
  cleanup: (entity: number, gameModel: GameModel) => void;
}

registerPixiComponent("FrameRate", PixiFrameRate);
