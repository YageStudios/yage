import { UIElement } from "yage/ui/UIElement";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { Component, defaultValue, DrawSystemImpl, QueryInstance, Schema, System, type } from "minecs";
import { ReadOnlyGameModel } from "yage/game/GameModel";
import { UIService } from "yage/ui/UIService";
import AssetLoader from "yage/loader/AssetLoader";
import { UiMapNext } from "yage/ui/UiMapNext";
import { keyPressed } from "yage/utils/keys";
import { MappedKeys } from "yage/inputs/InputManager";

@Component()
class InventoryGrid extends Schema {
  @type("string")
  @defaultValue("core/InventoryGrid")
  uiMap: string;
}

@System(InventoryGrid)
export class InventoryGridDrawSystem extends DrawSystemImpl<ReadOnlyGameModel> {
  uiService: UIService;
  uiElements: UIElement[] = [];
  uiMaps: UiMapNext[] = [];
  static depth = 1;
  inventoryOpen: boolean[] = [false, false, false, false];

  constructor(query: QueryInstance) {
    super(query);
    this.uiService = UIService.getInstance();
  }

  run = (gameModel: ReadOnlyGameModel, runEntity: number) => {
    const selfId = gameModel.getTypedUnsafe(PlayerInput, runEntity)?.pid;
    const inventoryGrid = gameModel.getTypedUnsafe(InventoryGrid, runEntity);

    if (selfId !== gameModel.localNetIds[0]) {
      return;
    }

    const players = gameModel.getEntityByDescription("Player") ?? [];

    for (let i = 0; i < players.length; i++) {
      const selfId = gameModel.getTypedUnsafe(PlayerInput, players[i])?.pid;
      const localNetIndex = gameModel.localNetIds.indexOf(selfId);
      if (localNetIndex === -1) {
        continue;
      }
      const entity = players[i];
      const netData = gameModel.getTypedUnsafe(PlayerInput, entity);

      if (keyPressed([MappedKeys.TAB], netData.keyMap, netData.prevKeyMap)) {
        console.log("TOGGLING");
        this.inventoryOpen[localNetIndex] = !this.inventoryOpen[localNetIndex];
      }

      if (!this.inventoryOpen[localNetIndex]) {
        if (this.uiElements[localNetIndex]) {
          this.uiService.disableKeyCapture();
          console.log("destroying");
          this.uiService.removeFromUI(this.uiElements[localNetIndex]);
          this.uiElements[localNetIndex].onDestroy();
          delete this.uiElements[localNetIndex];
        }
        continue;
      }

      const items: any[] = [];

      for (let i = 0; i < 25; ++i) {
        items.push({
          name: "Empty",
          description: "This slot is empty",
          quantity: 0,
        });
      }

      if (!this.uiElements[localNetIndex]) {
        if (!this.uiMaps[localNetIndex]) {
          this.uiMaps[localNetIndex] = new UiMapNext(AssetLoader.getInstance().getHbs(inventoryGrid.uiMap));
        }

        this.uiElements[localNetIndex] = this.uiMaps[localNetIndex].build({
          items,
          localPlayer: localNetIndex,
        });
        this.uiService.addToUI(this.uiElements[localNetIndex]);
        this.uiService.enableKeyCapture(gameModel.inputManager);
      }

      this.uiMaps[localNetIndex].update({
        items,
      });
    }
  };
}
