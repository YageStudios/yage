import { Schema } from "@/decorators/type";
import { GameModel } from "@/game/GameModel";
import { System } from "../System";
import { OwnedSchema } from "@/schemas/core/Owned";
import { registerSystem } from "../ComponentRegistry";
import { OwnerSchema } from "@/schemas/core/Owner";

class OwnedSystem implements System {
  schema = OwnedSchema;
  type = "Owned";
  cleanup(entity: number, gameModel: GameModel, ejecting: boolean) {
    const owned = gameModel.getTyped(entity, OwnedSchema);
    owned.owned.forEach((ownedEntity) => {
      if (!gameModel.isActive(ownedEntity)) return;
      gameModel.getTyped(ownedEntity, OwnerSchema).owner = null;
    });
  }
}

registerSystem(OwnedSystem);
