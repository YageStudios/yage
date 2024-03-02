import { Schema } from "@/decorators/type";
import { GameModel } from "@/game/GameModel";
import { System } from "../System";
import { OwnedSchema } from "@/schemas/core/Owned";
import { registerSystem } from "../ComponentRegistry";
import { OwnerSchema } from "@/schemas/core/Owner";

class OwnerSystem implements System {
  schema = OwnerSchema;
  type = "Owner";

  init(entity: number, gameModel: GameModel) {
    const owner = gameModel.getTypedUnsafe(entity, OwnerSchema).owner;
    if (owner === null) return;
    if (!gameModel.isActive(owner)) {
      gameModel.getTypedUnsafe(entity, OwnerSchema).owner = null;
      return;
    }
    if (!gameModel.hasComponent(owner, "Owned")) {
      gameModel.setComponent(owner, "Owned", { owned: [entity] });
    } else {
      const owned = gameModel.getTypedUnsafe(owner, OwnedSchema);
      if (!owned.owned.includes(entity)) {
        owned.owned.push(entity);
      }
    }
  }

  cleanup(entity: number, gameModel: GameModel, ejecting: boolean) {
    if (ejecting) return;
    const owner = gameModel.getTypedUnsafe(entity, OwnerSchema).owner;
    if (owner === null) return;
    if (!gameModel.isActive(owner)) return;
    if (!gameModel.hasComponent(owner, "Owned")) {
      return;
    }
    const owned = gameModel.getTypedUnsafe(owner, OwnedSchema);
    owned.owned = owned.owned.filter((ownedEntity) => {
      if (ownedEntity === entity) return false;
      if (!gameModel.isActive(ownedEntity)) return false;
      return true;
    });
  }
}

registerSystem(OwnerSystem);
