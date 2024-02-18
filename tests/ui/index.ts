import "@/schemas/index";
import "@/console/preload";

import { GameCoordinator } from "@/game/GameCoordinator";
import { UiSplashScene } from "./scenes/SplashScene";

//@ts-ignore
window.useHTML = true;

export const initialize = (gameCoordinator: GameCoordinator) => {
  gameCoordinator.registerScene(UiSplashScene);
  gameCoordinator.initialize(UiSplashScene);
};
const coordinator = GameCoordinator.GetInstance();

initialize(coordinator);
console.log("intialized");
