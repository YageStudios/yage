import { Component, defaultValue, QueryInstance, Schema, System, SystemImpl, type } from "minecs";
import { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import { ComponentCategory } from "yage/constants/enums";
import { UIElement } from "yage/ui/UIElement";
import { UiMapNext } from "yage/ui/UiMapNext";
import { UIService } from "yage/ui/UIService";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { keyPressed } from "yage/utils/keys";
import { MappedKeys } from "yage/inputs/InputManager";
import AssetLoader from "yage/loader/AssetLoader";
import { EntityFactory } from "yage/entity/EntityFactory";

class ItemType extends Schema {
  @type("string")
  imageKey: string;
}

class ShopItem extends Schema {
  @type("string")
  name: string;

  @type(ItemType)
  data: ItemType;
}

class ShopInventory extends Schema {
  @type([ShopItem])
  @defaultValue([])
  items: ShopItem[];
}

@Component()
export class Shop extends Schema {
  @type([ShopInventory])
  @defaultValue([])
  inventories: ShopInventory[];

  @type(["number"])
  @defaultValue([])
  playerIds: number[];

  @type("string")
  @defaultValue("core/ShopGrid")
  uiMap: string;
}

@Component()
export class ShopOpen extends Schema {}

@System(Shop)
export class ShopSystem extends SystemImpl<GameModel> {
  generateInventoryForPlayer(gameModel: GameModel, player: number, shop: Shop) {
    const inventory: ShopInventory = {
      items: [],
    };

    let playerIndex = shop.playerIds.indexOf(player);
    if (playerIndex === -1) {
      playerIndex = shop.playerIds.length;
      shop.playerIds.push(player);
      shop.inventories.push(inventory);
    } else {
      return;
    }

    const items = EntityFactory.getInstance().findEntityDefinitionsWithComponent("ItemType");

    items.forEach((item) => {
      const itemType = item.components?.find((c) => c.type === "ItemType") as unknown as ItemType;
      if (!itemType) return;

      for (let i = 0; i < 4; ++i) {
        inventory.items.push({
          name: item.name,
          data: itemType,
        });
      }
    });
  }

  init(gameModel: GameModel, entity: number) {
    gameModel.addComponent(ShopWatchJoin, entity);
    const players = gameModel.players;
    for (const player of players) {
      this.generateInventoryForPlayer(gameModel, player, gameModel.getTypedUnsafe(Shop, entity));
    }
  }

  run(gameModel: GameModel, entity: number) {
    const openEntities = gameModel.getComponentActives(ShopOpen);

    const stillOpenEntities = gameModel.getComponentActives(ShopOpen);
    for (const openEntity of stillOpenEntities) {
      this.handleShop(gameModel, openEntity);
    }
  }

  private handleShop(gameModel: GameModel, entity: number): void {}
}

@System(Shop)
export class ShopDrawSystem extends SystemImpl<ReadOnlyGameModel> {
  private readonly uiService: UIService;
  private readonly uiElements: UIElement[] = [];
  private readonly uiMaps: UiMapNext[] = [];
  private readonly selectedItems: (number | null)[] = [null, null, null, null];
  static readonly depth = 1;

  constructor(query: QueryInstance) {
    super(query);
    this.uiService = UIService.getInstance();
  }

  run(gameModel: ReadOnlyGameModel, runEntity: number): void {
    const players = gameModel.getEntityByDescription("Player") ?? [];

    for (const entity of players) {
      const selfId = gameModel.getTypedUnsafe(PlayerInput, entity)?.pid;
      const localNetIndex = gameModel.localNetIds.indexOf(selfId);
      if (localNetIndex === -1) continue;

      if (!gameModel.hasComponent(ShopOpen, entity)) {
        if (this.uiElements[localNetIndex]) {
          this.uiService.removeFromUI(this.uiElements[localNetIndex]);
          delete this.uiElements[localNetIndex];
          delete this.uiMaps[localNetIndex];
        }
        continue;
      }

      this.handleShopState(gameModel, runEntity, entity, localNetIndex);
    }
  }

  private handleShopState(
    gameModel: ReadOnlyGameModel,
    runEntity: number,
    entity: number,
    localNetIndex: number
  ): void {
    const shop = gameModel.getTypedUnsafe(Shop, runEntity);

    const playerIndex = shop.playerIds.indexOf(entity);
    const items = shop.inventories[playerIndex]?.items;
    if (!items) return;

    if (!this.uiElements[localNetIndex]) {
      if (!this.uiMaps[localNetIndex]) {
        this.uiMaps[localNetIndex] = new UiMapNext(AssetLoader.getInstance().getHbs(shop.uiMap));
      }
      this.uiElements[localNetIndex] = this.uiMaps[localNetIndex].build(
        {
          items,
          localPlayer: localNetIndex,
        },
        (pIndex, eventName, eventType, context, contextPath) =>
          this.handleEvent(gameModel, entity, pIndex, eventName, eventType, context, contextPath)
      );

      this.uiService.addToUI(this.uiElements[localNetIndex]);
      this.uiService.enableKeyCapture(gameModel.inputManager);
    } else {
      this.uiMaps[localNetIndex].update({
        items,
      });
    }
  }

  private handleEvent(
    gameModel: ReadOnlyGameModel,
    entity: number,
    playerIndex: number,
    eventName: string,
    eventType: string,
    context: any,
    contextPath: string[]
  ): void {
    const validEvents = [
      "selectItem",
      "selectAbility",
      "selectAbilitySupport1",
      "selectAbilitySupport2",
      "selectDash",
      "selectDashSupport1",
      "selectDashSupport2",
      "selectUltimate",
      "selectUltimateSupport1",
      "selectUltimateSupport2",
    ];
  }
}

@Component(ComponentCategory.ON_JOIN)
class ShopWatchJoin extends Schema {
  @type("number")
  @defaultValue(-1)
  joiningPlayer: number;
}

@System(ShopWatchJoin)
export class ShopWatchJoinSystem extends SystemImpl<GameModel> {
  static depth = -1;

  run(gameModel: GameModel, entity: number) {
    const shop = gameModel.getTypedUnsafe(Shop, entity);
    const shopWatch = gameModel.getTypedUnsafe(ShopWatchJoin, entity);
    const shopSystem = gameModel.getSystem(ShopSystem);
    shopSystem.generateInventoryForPlayer(gameModel, shopWatch.joiningPlayer, shop);
  }
}
