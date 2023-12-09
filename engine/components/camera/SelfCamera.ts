import { registerUIComponent, registerSchema } from "@/components/ComponentRegistry";
import { ComponentCategory } from "@/components/types";
import { Component, defaultValue, Schema, type } from "@/decorators/type";
import { TransformSchema } from "@/schemas/entity/Transform";
import { PlayerInputSchema } from "../core";

@Component("SelfCamera")
export class SelfCameraSchema extends Schema {
  @type("number")
  @defaultValue(1)
  zoom: number;
}

registerSchema(ComponentCategory.CORE, SelfCameraSchema);

registerUIComponent("SelfCamera", (uiService, entity, gameModel, viewport) => {
  const data = gameModel.getTyped(entity, SelfCameraSchema);
  const selfId = gameModel.getTyped(entity, PlayerInputSchema).id;
  if (selfId === gameModel.netId) {
    const transformSchema = gameModel.getTyped(entity, TransformSchema);
    const position = transformSchema.position;
    viewport.moveCenter(position.x, position.y);
    // viewport.setZoom(data.zoom);
  }
});
