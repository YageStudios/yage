import { Bitecs, BitecsSchema, Component, defaultValue, type } from "@/decorators/type";
import type { Vector2d } from "@/utils/vector";

@Bitecs()
@Component("Transform")
export class TransformSchema extends BitecsSchema {
  @type("float32")
  @defaultValue(0)
  _x: number;

  @type("float32")
  @defaultValue(0)
  _y: number;

  @type("float32")
  @defaultValue(0)
  _z: number;

  @type("float32")
  @defaultValue(0)
  _previousX: number;

  @type("float32")
  @defaultValue(0)
  _previousY: number;

  @type("float32")
  @defaultValue(0)
  _previousZ: number;

  static get x() {
    return TransformSchema.store.x[this.id];
  }

  get x() {
    return TransformSchema.x;
  }

  static set x(value: number) {
    if (TransformSchema.store.x[this.id] !== value) {
      TransformSchema.store.x[this.id] = value;
      TransformSchema.store.__changes[this.id] |= 1;
    }
  }

  set x(value: number) {
    TransformSchema.x = value;
  }

  static get y() {
    return TransformSchema.store.y[this.id];
  }

  get y() {
    return TransformSchema.y;
  }

  static set y(value: number) {
    if (TransformSchema.store.y[this.id] !== value) {
      TransformSchema.store.y[this.id] = value;
      TransformSchema.store.__changes[this.id] |= 2;
    }
  }

  set y(value: number) {
    TransformSchema.y = value;
  }

  static get position(): Vector2d {
    return { x: TransformSchema.x, y: TransformSchema.y };
  }

  get position(): Vector2d {
    return TransformSchema.position;
  }

  static set position(value: Vector2d) {
    TransformSchema.x = value.x;
    TransformSchema.y = value.y;
  }

  set position(value: Vector2d) {
    TransformSchema.position = value;
  }

  static get previousPosition(): Vector2d {
    return { x: TransformSchema.previousX, y: TransformSchema.previousY };
  }

  get previousPosition(): Vector2d {
    return TransformSchema.previousPosition;
  }

  static get z() {
    return TransformSchema.store.z[this.id];
  }

  get z() {
    return TransformSchema.z;
  }

  static set z(value: number) {
    if (TransformSchema.store.z[this.id] !== value) {
      TransformSchema.store.z[this.id] = value;
      TransformSchema.store.__changes[this.id] |= 4;
    }
  }

  set z(value: number) {
    TransformSchema.z = value;
  }

  static get previousX() {
    return TransformSchema.store.previousX[this.id];
  }

  get previousX() {
    return TransformSchema.previousX;
  }

  static set previousX(value: number) {
    if (TransformSchema.store.previousX[this.id] !== value) {
      TransformSchema.store.previousX[this.id] = value;
      TransformSchema.store.__changes[this.id] |= 8;
    }
  }

  set previousX(value: number) {
    TransformSchema.previousX = value;
  }

  static get previousY() {
    return TransformSchema.store.previousY[this.id];
  }

  get previousY() {
    return TransformSchema.previousY;
  }

  static set previousY(value: number) {
    if (TransformSchema.store.previousY[this.id] !== value) {
      TransformSchema.store.previousY[this.id] = value;
      TransformSchema.store.__changes[this.id] |= 16;
    }
  }

  set previousY(value: number) {
    TransformSchema.previousY = value;
  }

  static get previousZ() {
    return TransformSchema.store.previousZ[this.id];
  }

  get previousZ() {
    return TransformSchema.previousZ;
  }

  static set previousZ(value: number) {
    if (TransformSchema.store.previousZ[this.id] !== value) {
      TransformSchema.store.previousZ[this.id] = value;
      TransformSchema.store.__changes[this.id] |= 32;
    }
  }

  set previousZ(value: number) {
    TransformSchema.previousZ = value;
  }
}
