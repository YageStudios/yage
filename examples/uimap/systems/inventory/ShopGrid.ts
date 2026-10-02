import { Component, defaultValue, DrawSystemImpl, Schema, System, SystemImpl, type } from "minecs";
import type { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import { ComponentCategory } from "yage/constants/enums";
import { Column, Grid, Image, Panel, Text, UIFinal, signal, when } from "yage/ui/final";
import type { Child } from "yage/ui/final";
import AssetLoader from "yage/loader/AssetLoader";
import { EntityFactory } from "yage/entity/EntityFactory";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { canPresentUI } from "../../../shared/uiFinal";

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

// Shop panels are presentation-only: one UIFinal root, one reactive panel slot
// per local player (null = closed). Items come from the sim's Shop inventory.
interface ShopItemView { name: string; image: string; }

@System(Shop)
export class ShopDrawSystem extends DrawSystemImpl<ReadOnlyGameModel> {
  static readonly depth = 1;
  private ui?: UIFinal;
  /** Per-local-player item list; null while that player's shop is closed. */
  private panels = signal<readonly (readonly ShopItemView[] | null)[]>([null, null, null, null]);

  run(gameModel: ReadOnlyGameModel, runEntity: number): void {
    if (!this.ui && canPresentUI()) {
      this.ui = new UIFinal().mount(this.renderPanels());
    }
    if (!this.ui) return;

    const shop = gameModel.getTypedUnsafe(Shop, runEntity);
    const players = gameModel.getEntityByDescription("Player") ?? [];
    const next: (readonly ShopItemView[] | null)[] = this.panels.peek().map(() => null);

    for (const entity of players) {
      const selfId = gameModel.getTypedUnsafe(PlayerInput, entity)?.pid;
      const localNetIndex = gameModel.localNetIds.indexOf(selfId);
      if (localNetIndex === -1) continue;
      if (localNetIndex >= next.length) continue;

      if (!gameModel.hasComponent(ShopOpen, entity)) continue;

      const playerIndex = shop.playerIds.indexOf(entity);
      const items = shop.inventories[playerIndex]?.items;
      if (!items) continue;

      next[localNetIndex] = items.map(item => ({
        name: item.name,
        image: AssetLoader.getInstance().getImage(item.data.imageKey).url,
      }));
    }

    this.panels.set(next);
  }

  private renderPanels(): Child {
    // Closed panels render nothing; open panels rebuild from the replaced
    // items array each publish (the retained DOM is patched, not remounted).
    return [0, 1, 2, 3].map(player =>
      when(() => this.panels.get()[player] !== null, () =>
        this.shopPanel(player, this.panels.get()[player] as readonly ShopItemView[])));
  }

  private shopPanel(player: number, items: readonly ShopItemView[]): Child {
    const cards = items.map((item, index) =>
      Column({
        key: index,
        style: {
          width: 230, height: 600, border: "2px solid magenta", borderRadius: 5,
          alignItems: "center", gap: 10, padding: 10,
        },
      },
        Image({ src: item.image, alt: item.name, style: { width: "60%", height: "auto" } }),
        Text(item.name, { style: { fontSize: 22, color: "#ffffff" } })));
    return Panel({
      id: `shop-${player}`,
      label: `Player ${player + 1} shop`,
      style: {
        position: "absolute", inset: 0, display: "grid", placeItems: "center",
        background: "rgba(0,0,0,0.35)",
      },
    },
      Grid({
        style: {
          gridTemplateColumns: "repeat(4, 230px)", gap: 5, padding: 5,
          maxHeight: "90vh", overflow: "auto",
        },
      }, cards));
  }

  cleanup(): void {
    this.ui?.dispose();
    this.ui = undefined;
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
