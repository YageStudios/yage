import { Component, type, Bitecs, BitecsSchema } from "../../decorators/type";
import { registerSchema } from "@/components/ComponentRegistry";
import { ComponentCategory } from "../../components/types";

@Bitecs()
@Component("Radius")
export class RadiusSchema extends BitecsSchema {
  @type("uint16")
  _radius: number;

  static get radius() {
    return RadiusSchema.store.radius[this.id];
  }

  static set radius(value) {
    RadiusSchema.store.radius[this.id] = value;
    RadiusSchema.store.__changes[this.id] |= 1;
  }
}

registerSchema(ComponentCategory.BEHAVIOR, RadiusSchema);
