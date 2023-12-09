import { Schema, Component, type, defaultValue } from "@/decorators/type";
@Component("Collisions")
export class CollisionsSchema extends Schema {
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

@Component("CollisionFilters")
export class CollisionFiltersSchema extends Schema {
  @type(["number"])
  @defaultValue([])
  filters: number[];
}
