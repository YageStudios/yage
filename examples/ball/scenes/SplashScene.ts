import type { SceneTimestep } from "yage/game/Scene";
import { Scene } from "yage/game/Scene";
import { EntityFactory } from "yage/entity/EntityFactory";
import { UIService } from "yage/ui/UIService";
import { Text, TextConfig } from "yage/ui/Text";
import type { UIElement } from "yage/ui/UIElement";
import { Position, Rectangle } from "yage/ui/Rectangle";
import { GameCoordinator } from "yage/game/GameCoordinator";
import AssetLoader from "yage/loader/AssetLoader";
import { SingleplayerConnectionInstance } from "yage/connection/SingleplayerConnectionInstance";
import { ConnectionInstance } from "yage/connection/ConnectionInstance";
import { Button, ButtonConfig } from "yage/ui/Button";
import { ImageBox } from "yage/ui/ImageBox";
import { TextInputConfig, TextInput } from "yage/ui/TextInput";

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
  style: {
    borderColor: "pink",
    backgroundColor: "green",
    textTransform: "uppercase",
  },
  fontSize: 32,
  ...config,
});

export class BallSplashScene extends Scene {
  static sceneName = "BallSplash";

  timestep: SceneTimestep = "continuous";
  dt = 4;

  paused = false;
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
