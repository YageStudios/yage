import type { SceneTimestep } from "yage/game/Scene";
import { Scene } from "yage/game/Scene";
import { EntityFactory } from "yage/entity/EntityFactory";
import { UIService } from "yage/ui/UIService";
import { Text } from "yage/ui/Text";
import type { UIElement } from "yage/ui/UIElement";
import { Rectangle } from "yage/ui/Rectangle";
import { GameCoordinator } from "yage/game/GameCoordinator";
import AssetLoader from "yage/loader/AssetLoader";
import { SingleplayerConnectionInstance } from "yage/connection/SingleplayerConnectionInstance";
import { ConnectionInstance } from "yage/connection/ConnectionInstance";

export class BallLoadingScene extends Scene {
  static sceneName = "BallLoading";

  timestep: SceneTimestep = "continuous";
  dt = 4;

  paused = false;
  gameCanvasContext: CanvasRenderingContext2D;

  public initialize = async (args: any[]): Promise<void> => {
    UIService.configureUi(document.getElementById("uicanvas") as HTMLCanvasElement);

    const [connection, winner] = (args ?? []) as [ConnectionInstance<any>, string];

    this.connection = connection;
    this.winner = winner;

    const uiService = UIService.getInstance();
    const ui: UIElement[] = [];
    const frameTime = new Text(new Rectangle(250, 255, 1, 1), {
      label: "Loading...",
      style: {
        textTransform: "uppercase",
      },
      fontSize: 32,
    });
    ui.push(frameTime);
    uiService.addToUI(frameTime);
    this.load();
  };

  load = async () => {
    await import("../components");
    const entityDefinitions = (await import("../entities")).default;
    EntityFactory.configureEntityFactory(entityDefinitions);

    await AssetLoader.getInstance().load();
    if (this.connection) {
      this.changeScene("BallLobby", this.connection);
    } else {
      this.changeScene("BallLobby");
    }
    // this.changeScene("BallGame", {
    //   connection: new SingleplayerInstance(),
    //   hosting: true,
    //   sprite: "elf1",
    // });
  };

  run = () => {};
  connection: ConnectionInstance<any>;
  winner: string;

  public destroy() {
    super.destroy();
    console.log("MinMediator: destroy");
  }
}
