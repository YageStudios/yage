import { registerUIComponent, registerSchema } from "@/components/ComponentRegistry";
import { ComponentCategory } from "@/components/types";
import { Component, defaultValue, Schema, type } from "@/decorators/type";
import { TransformSchema } from "@/schemas/entity/Transform";

@Component("EntityCamera")
export class EntityCameraSchema extends Schema {
  @type("Entity")
  @defaultValue(-1)
  entity: number;

  @type("number")
  @defaultValue(1)
  zoom: number;
}

registerSchema(ComponentCategory.CORE, EntityCameraSchema);

registerUIComponent("EntityCamera", (uiService, entity, gameModel, viewport) => {
  const data = gameModel.getTypedUnsafe(entity, EntityCameraSchema);
  if (data.entity > -1) {
    const transformSchema = gameModel.getTypedUnsafe(data.entity, TransformSchema);
    const position = transformSchema.position;
    viewport.moveCenter(position.x, position.y);
  }
});
