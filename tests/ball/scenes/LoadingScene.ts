import type { SceneTimestep } from "@/game/Scene";
import { Scene } from "@/game/Scene";
import { EntityFactory } from "@/entity/EntityFactory";
import { UIService } from "@/ui/UIService";
import { Text } from "@/ui/Text";
import type { UIElement } from "@/ui/UIElement";
import { Rectangle } from "@/ui/Rectangle";
import { GameCoordinator } from "@/game/GameCoordinator";
import AssetLoader from "@/loader/AssetLoader";
import { SingleplayerInstance } from "@/connection/SingleplayerInstance";
import { ConnectionInstance } from "@/connection/ConnectionInstance";

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
