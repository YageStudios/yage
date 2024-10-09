import { System, SystemImpl } from "minecs";
import type { GameModel } from "yage/game/GameModel";
import { Owned } from "yage/schemas/core/Owned";
import { Owner } from "yage/schemas/core/Owner";

@System(Owned)
export class OwnedSystem extends SystemImpl<GameModel> {
  cleanup = (gameModel: GameModel, entity: number) => {
    const owned = gameModel.getTypedUnsafe(Owned, entity);
    owned.owned.forEach((ownedEntity) => {
      if (!gameModel.isActive(ownedEntity)) return;
      gameModel.getTypedUnsafe(Owner, ownedEntity).owner = null;
    });
  };
}
