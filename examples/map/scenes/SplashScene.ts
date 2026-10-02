import type { SceneTimestep } from "yage/game/Scene";
import { Scene } from "yage/game/Scene";
import { EntityFactory } from "yage/entity/EntityFactory";
import { Column, Panel, Text } from "yage/ui/final";
import AssetLoader from "yage/loader/AssetLoader";
import type { ConnectionInstance } from "yage/connection/ConnectionInstance";

export class BallSplashScene extends Scene {
  static sceneName = "BallSplash";

  timestep: SceneTimestep = "continuous";
  dt = 4;

  public initialize = async (): Promise<void> => {
    // Scene-owned presentation UI; Scene.destroy disposes it.
    this.mountUIFinal(
      Panel({ style: { position: "absolute", inset: 0, display: "grid", placeItems: "center" } },
        Column({ style: { alignItems: "center", gap: 18 } },
          Text("Ball", {
            role: "heading",
            attrs: { "aria-level": 1 },
            style: { fontSize: 96, color: "#ffffff", textShadow: "2px 2px 4px #000000" },
          }),
          Text("Loading…", { style: { fontSize: 28, color: "#aaaaaa" } }))));

    await this.load();
  };

  load = async () => {
    const entityDefinitions = (await import("../entities")).default;
    EntityFactory.configureEntityFactory(entityDefinitions);

    await AssetLoader.getInstance().load();
    this.changeScene("BallLobby");
  };

  run = () => {};
  connection: ConnectionInstance<any>;
  winner: string;
}
