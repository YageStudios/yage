import { DEPTHS, registerEditorComponent, registerSystem } from "@/components/ComponentRegistry";
import type { GameModel } from "@/game/GameModel";
import type { System } from "../../components/System";
import { ComponentCategory } from "../../components/types";
import DescriptionSchema from "@/schemas/core/Description";
import { ParentSchema } from "@/schemas/entity/Parent";

class ParentSystem implements System {
  type = "Parent";
  category: ComponentCategory = ComponentCategory.BEHAVIOR;
  schema = ParentSchema;
  depth = DEPTHS.LOCOMOTION + 10;
  run(entity: number, gameModel: GameModel) {
    const parentData = gameModel.getTypedUnsafe(entity, ParentSchema);

    for (let i = 0; i < parentData.children.length; i++) {
      const child = parentData.children[i];
      if (!gameModel.isActive(child)) {
        parentData.children.splice(i, 1);
        i--;
        continue;
      }
    }
    if (parentData.children.length == 0) {
      gameModel.removeComponent(entity, "Parent");
    }
  }
}

registerSystem(ParentSystem);

registerEditorComponent("Parent", (el, entity, gameModel) => {
  const children = gameModel.getTypedUnsafe(entity, ParentSchema).children;
  const getText = (child: number) => {
    if (gameModel.hasComponent(child, DescriptionSchema)) {
      const description = gameModel.getTypedUnsafe(child, DescriptionSchema).description;
      return `${child} ${description}`;
    }
    return `${child}`;
  };
  const nextHtml = `
    <h1>Parent</h1>
    <h3>Children</h3>
    <ul>
      ${children.map((child: number) => `<li data-entity="${child}">${getText(child)}</li>`).join("")}
    </ul>
  `;
  if (el.innerHTML != nextHtml) {
    el.innerHTML = nextHtml;
  }
});
