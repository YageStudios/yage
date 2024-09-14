import { System, SystemImpl } from "minecs";
import type { GameModel } from "yage/game/GameModel";
import { Owned } from "yage/schemas/core/Owned";
import { Owner } from "yage/schemas/core/Owner";

@System(Owner)
class OwnerSystem extends SystemImpl<GameModel> {
  schema = Owner;
  type = "Owner";

  init = (gameModel: GameModel, entity: number) => {
    const owner = gameModel.getTypedUnsafe(Owner, entity).owner;
    if (owner === null) return;
    if (!gameModel.isActive(owner)) {
      gameModel.getTypedUnsafe(Owner, entity).owner = null;
      return;
    }
    if (!gameModel.hasComponent(Owned, owner)) {
      gameModel.addComponent(Owned, owner, { owned: [entity] });
    } else {
      const owned = gameModel.getTypedUnsafe(Owned, owner);
      if (!owned.owned.includes(entity)) {
        owned.owned.push(entity);
      }
    }
  };

  cleanup = (gameModel: GameModel, entity: number) => {
    const owner = gameModel.getTypedUnsafe(Owner, entity).owner;
    if (owner === null) return;
    if (!gameModel.isActive(owner)) return;
    if (!gameModel.hasComponent(Owned, owner)) {
      return;
    }
    const owned = gameModel.getTypedUnsafe(Owned, owner);
    owned.owned = owned.owned.filter((ownedEntity) => {
      if (ownedEntity === entity) return false;
      if (!gameModel.isActive(ownedEntity)) return false;
      return true;
    });
  };
}
