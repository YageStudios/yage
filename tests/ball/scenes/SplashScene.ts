import type { SceneTimestep } from "@/game/Scene";
import { Scene } from "@/game/Scene";
import { EntityFactory } from "@/entity/EntityFactory";
import type { MouseManager } from "@/inputs/MouseManager";
import { UIService } from "@/ui/UIService";
import { Text, TextConfig } from "@/ui/Text";
import type { UIElement } from "@/ui/UIElement";
import { Position, Rectangle } from "@/ui/Rectangle";
import { GameCoordinator } from "@/game/GameCoordinator";
import AssetLoader from "@/loader/AssetLoader";
import { SingleplayerInstance } from "@/connection/SingleplayerInstance";
import { ConnectionInstance } from "@/connection/ConnectionInstance";
import { Button, ButtonConfig } from "@/ui/Button";
import { ImageBox } from "@/ui/ImageBox";
import { TextInputConfig, TextInput } from "@/ui/TextInput";
import { hacks } from "@/console/hacks";

const BigText = (config: Partial<TextConfig>): Partial<TextConfig> => ({
  style: {
    lineHeight: "1.5",
  },
  fontSize: 32,
  ...config,
});

const BigTextInput = (config: Partial<TextInputConfig>): Partial<TextInputConfig> => ({
  style: {
    lineHeight: "1.5",
    borderColor: "white",
  },
  fontSize: 20,
  ...config,
});

const CallToAction = (config: Partial<ButtonConfig>): Partial<ButtonConfig> => ({
  uppercase: true,
  style: {
    borderColor: "pink",
    backgroundColor: "green",
  },
  fontSize: 32,
  ...config,
});

export class BallSplashScene extends Scene {
  static sceneName = "BallSplash";

  timestep: SceneTimestep = "continuous";
  dt = 4;

  paused = false;
  mouseManager: MouseManager;
  gameCanvasContext: CanvasRenderingContext2D;

  public initialize = async (args: any[]): Promise<void> => {
    UIService.configureUi(document.getElementById("uicanvas") as HTMLCanvasElement);

    this.ui.background = new Text(
      new Position("center", "center", {
        width: 1920,
        height: 1080,
      }),
      {
        label: "Background",
      }
    );
    this.load();
  };

  splashScreen() {
    this.ui.chatBox = new Text(
      [3, 3],
      BigText({
        label: "Ball",
      })
    );

    const rect = new Rectangle(0, 0, 1920, 1080);
    rect.justify = "center";
    rect.align = "center";

    const centerLine = 60;

    this.ui.initLobby = new Button(
      new Position(50, centerLine, {
        width: 300,
        height: 100,
        yOffset: 150,
      }),
      CallToAction({
        label: "Start",
        onClick: () => {},
      })
    );
  }

  load = async () => {
    await import("../components");
    const entityDefinitions = (await import("../entities")).default;
    EntityFactory.configureEntityFactory(entityDefinitions);

    await AssetLoader.getInstance().load();
    this.changeScene("BallLobby");
  };

  run = () => {};
  connection: ConnectionInstance<any>;
  winner: string;

  public destroy() {
    super.destroy();
    console.log("MinMediator: destroy");
  }
}
