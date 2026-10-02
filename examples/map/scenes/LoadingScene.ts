import type { SceneTimestep } from "yage/game/Scene";
import { Scene } from "yage/game/Scene";
import { EntityFactory } from "yage/entity/EntityFactory";
import { Panel, Text } from "yage/ui/final";
import AssetLoader from "yage/loader/AssetLoader";
import type { ConnectionInstance } from "yage/connection/ConnectionInstance";

export class BallLoadingScene extends Scene {
  static sceneName = "BallLoading";

  timestep: SceneTimestep = "continuous";
  dt = 4;

  public initialize = async (args: any[]): Promise<void> => {
    const [connection, winner] = (args ?? []) as [ConnectionInstance<any>, string];
    this.connection = connection;
    this.winner = winner;

    this.mountUIFinal(
      Panel({ style: { position: "absolute", inset: 0, display: "grid", placeItems: "center" } },
        Text("Loading...", {
          style: { fontSize: 32, color: "#ffffff", textTransform: "uppercase" },
        })));

    await this.load();
  };

  load = async () => {
    const entityDefinitions = (await import("../entities")).default;
    EntityFactory.configureEntityFactory(entityDefinitions);

    await AssetLoader.getInstance().load();
    if (this.connection) {
      this.changeScene("BallLobby", this.connection);
    } else {
      this.changeScene("BallLobby");
    }
  };

  run = () => {};
  connection: ConnectionInstance<any>;
  winner: string;
}
