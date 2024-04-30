import { Schema, Component, type, defaultValue } from "minecs";
@Component()
export class Collisions extends Schema {
  @type("object")
  collisions: { [eid: number]: { [eid: number]: boolean; filters?: { [filter: number]: number[] } } };

  @type("object")
  @defaultValue({})
  collisionMap: {
    [eid1: number]: {
      [eid2: number]: boolean;
    };
  };
}

@Component()
export class CollisionFilters extends Schema {
  @type(["number"])
  @defaultValue([])
  filters: number[];
}
