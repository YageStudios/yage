import { registerUIComponent, registerSchema } from "@/components/ComponentRegistry";
import { ComponentCategory } from "@/components/types";
import { Component, defaultValue, Schema, type } from "@/decorators/type";
import { PlayerInputSchema } from "@/schemas/core/PlayerInput";
import { TransformSchema } from "@/schemas/entity/Transform";

@Component("SelfCamera")
export class SelfCameraSchema extends Schema {
  @type("number")
  @defaultValue(1)
  zoom: number;
}

registerSchema(ComponentCategory.CORE, SelfCameraSchema);

registerUIComponent("SelfCamera", (uiService, entity, gameModel, viewport) => {
  const data = gameModel.getTypedUnsafe(entity, SelfCameraSchema);
  const selfId = gameModel.getTypedUnsafe(entity, PlayerInputSchema).id;
  if (selfId === gameModel.localNetIds[0]) {
    const transformSchema = gameModel.getTypedUnsafe(entity, TransformSchema);
    const position = transformSchema.position;
    viewport.moveCenter(position.x, position.y);
    // viewport.setZoom(data.zoom);
  }
});
