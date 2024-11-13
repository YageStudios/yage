/* eslint-disable @typescript-eslint/adjacent-overload-signatures */
import { Component, Schema, defaultValue, type } from "minecs";
// import type { Vector2d } from "yage/utils/vector";
// import { WORLD_WIDTH, HALF_WORLD_WIDTH } from "yage/constants";

// const xToWorldSpace = (entity: number, value: number) => {
//   const world = World.store.world[entity];
//   if (value < world * WORLD_WIDTH - HALF_WORLD_WIDTH || value > world * WORLD_WIDTH + HALF_WORLD_WIDTH) {
//     if (value > HALF_WORLD_WIDTH) {
//       const worldOffset = Math.floor(value + HALF_WORLD_WIDTH / WORLD_WIDTH);
//       value -= worldOffset * WORLD_WIDTH;
//     }
//     value = world * WORLD_WIDTH + value;
//   }
//   return value;
// };

@Component()
export class Transform extends Schema {
  @type("float32")
  @defaultValue(0)
  x: number;

  @type("float32")
  @defaultValue(0)
  y: number;

  @type("float32")
  @defaultValue(0)
  z: number;

  @type("float32")
  @defaultValue(0)
  previousX: number;

  @type("float32")
  @defaultValue(0)
  previousY: number;

  @type("float32")
  @defaultValue(0)
  previousZ: number;

  // static set x(value: number) {
  //   value = xToWorldSpace(this.id, value);
  //   if (Transform.store.x[this.id] !== value) {
  //     Transform.store.x[this.id] = value;
  //   }
  // }

  // static get x(): number {
  //   return Transform.store.x[this.id];
  // }

  // static get position(): Vector2d {
  //   // @ts-ignore
  //   return { x: Transform.x, y: Transform.y };
  // }
  // static set position(value: Vector2d) {
  //   // @ts-ignore
  //   Transform.x = value.x;
  //   // @ts-ignore
  //   Transform.y = value.y;
  // }

  // get position(): Vector2d {
  //   return Transform.position;
  // }

  // set position(value: Vector2d) {
  //   Transform.position = value;
  // }

  // static get previousPosition(): Vector2d {
  //   // @ts-ignore
  //   return { x: Transform.previousX, y: Transform.previousY };
  // }

  // get previousPosition(): Vector2d {
  //   return Transform.previousPosition;
  // }
}
