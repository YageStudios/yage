import { DEPTHS, registerEditorComponent, registerSystem } from "@/components/ComponentRegistry";
import type { GameModel } from "@/game/GameModel";
import type { System } from "../../components/System";
import { ComponentCategory } from "../../components/types";
import DescriptionSchema from "@/schemas/core/Description";
import { ParentSchema } from "@/schemas/entity/Parent";
import { ChildSchema } from "@/schemas/entity/Child";

class ParentSystem implements System {
  type = "Parent";
  category: ComponentCategory = ComponentCategory.BEHAVIOR;
  schema = ParentSchema;
  depth = DEPTHS.LOCOMOTION + 10;
  run(entity: number, gameModel: GameModel) {
    const parentData = gameModel.getTypedUnsafe(entity, ParentSchema);
    let modIds: number[] | undefined;

    for (let i = 0; i < parentData.children.length; i++) {
      const child = parentData.children[i];
      if (!gameModel.isActive(child) || gameModel.getTyped(child, ChildSchema)?.parent !== entity) {
        modIds = modIds?.length
          ? modIds
          : gameModel.getComponentIdsByCategory(entity, ComponentCategory.ON_REMOVE_FROM_PARENT);
        for (let i = 0; i < modIds.length; i++) {
          const mod = gameModel.getComponent(entity, modIds[i]) as any;
          if (mod.parent !== undefined) {
            mod.parent = entity;
          }
          if (mod.child !== undefined) {
            mod.child = child;
          }

          const system: System = gameModel.getSystem(modIds[i]);
          system.run?.(entity, gameModel);
        }

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
