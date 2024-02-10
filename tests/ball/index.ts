import "@/schemas/index";
import "@/console/preload";

import { GameCoordinator } from "@/game/GameCoordinator";
import { BallGameScene } from "./scenes/GameScene";
import { BallLobbyScene } from "./scenes/LobbyScene";
import { BallSplashScene } from "./scenes/SplashScene";

//@ts-ignore
window.useHTML = true;

export const initialize = (gameCoordinator: GameCoordinator) => {
  gameCoordinator.registerScene(BallGameScene);
  gameCoordinator.registerScene(BallLobbyScene);
  gameCoordinator.registerScene(BallSplashScene);
  gameCoordinator.initialize("BallSplash");
};
const coordinator = GameCoordinator.GetInstance();

initialize(coordinator);
console.log("intialized");
