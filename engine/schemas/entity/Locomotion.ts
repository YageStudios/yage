import { Bitecs, BitecsSchema, Component, defaultValue, type } from "@/decorators/type";
import type { Vector2d } from "@/utils/vector";

@Bitecs()
@Component("Locomotion")
export class LocomotionSchema extends BitecsSchema {
  @type("float32")
  @defaultValue(0)
  _velocityX: number;

  @type("float32")
  @defaultValue(0)
  _velocityY: number;

  @type("float32")
  @defaultValue(6)
  _speed: number;

  @type("float32")
  @defaultValue(0)
  _directionX: number;

  @type("float32")
  @defaultValue(1)
  _directionY: number;

  @type("float32")
  @defaultValue(0)
  _decayingVelocityX: number;

  @type("float32")
  @defaultValue(0)
  _decayingVelocityY: number;

  @type("float32")
  @defaultValue(0)
  _decayingVelocityTime: number;

  @type("float32")
  @defaultValue(1)
  _decayingVelocityScale: number;

  @type("uint8")
  @defaultValue(0)
  _fixedDirection: number;

  static get velocity(): Vector2d {
    return { x: this.velocityX, y: this.velocityY };
  }

  get velocity(): Vector2d {
    return LocomotionSchema.velocity;
  }

  static get velocityX() {
    return LocomotionSchema.store.velocityX[this.id];
  }

  get velocityX() {
    return LocomotionSchema.velocityX;
  }

  static set velocityX(value: number) {
    LocomotionSchema.store.velocityX[this.id] = value;
    LocomotionSchema.store.__changes[this.id] |= 1;
  }

  set velocityX(value: number) {
    LocomotionSchema.velocityX = value;
  }

  static get velocityY() {
    return LocomotionSchema.store.velocityY[this.id];
  }

  get velocityY() {
    return LocomotionSchema.velocityY;
  }

  static set velocityY(value: number) {
    LocomotionSchema.store.velocityY[this.id] = value;
    LocomotionSchema.store.__changes[this.id] |= 2;
  }

  set velocityY(value: number) {
    LocomotionSchema.velocityY = value;
  }

  static get speed() {
    return LocomotionSchema.store.speed[this.id];
  }

  get speed() {
    return LocomotionSchema.speed;
  }

  static set speed(value: number) {
    LocomotionSchema.store.speed[this.id] = value;
    LocomotionSchema.store.__changes[this.id] |= 4;
  }

  set speed(value: number) {
    LocomotionSchema.speed = value;
  }

  static get directionX() {
    return LocomotionSchema.store.directionX[this.id];
  }

  get directionX() {
    return LocomotionSchema.directionX;
  }

  static set directionX(value: number) {
    LocomotionSchema.store.directionX[this.id] = value;
    LocomotionSchema.store.__changes[this.id] |= 8;
  }

  set directionX(value: number) {
    LocomotionSchema.directionX = value;
  }

  static get directionY() {
    return LocomotionSchema.store.directionY[this.id];
  }

  get directionY() {
    return LocomotionSchema.directionY;
  }

  static set directionY(value: number) {
    LocomotionSchema.store.directionY[this.id] = value;
    LocomotionSchema.store.__changes[this.id] |= 16;
  }

  set directionY(value: number) {
    LocomotionSchema.directionY = value;
  }

  static get decayingVelocityX() {
    return LocomotionSchema.store.decayingVelocityX[this.id];
  }

  get decayingVelocityX() {
    return LocomotionSchema.decayingVelocityX;
  }

  static set decayingVelocityX(value: number) {
    LocomotionSchema.store.decayingVelocityX[this.id] = value;
    LocomotionSchema.store.__changes[this.id] |= 32;
  }

  set decayingVelocityX(value: number) {
    LocomotionSchema.decayingVelocityX = value;
  }

  static get decayingVelocityY() {
    return LocomotionSchema.store.decayingVelocityY[this.id];
  }

  get decayingVelocityY() {
    return LocomotionSchema.decayingVelocityY;
  }

  static set decayingVelocityY(value: number) {
    LocomotionSchema.store.decayingVelocityY[this.id] = value;
    LocomotionSchema.store.__changes[this.id] |= 64;
  }

  set decayingVelocityY(value: number) {
    LocomotionSchema.decayingVelocityY = value;
  }

  static get decayingVelocityTime() {
    return LocomotionSchema.store.decayingVelocityTime[this.id];
  }

  get decayingVelocityTime() {
    return LocomotionSchema.decayingVelocityTime;
  }

  static set decayingVelocityTime(value: number) {
    LocomotionSchema.store.decayingVelocityTime[this.id] = value;
    LocomotionSchema.store.__changes[this.id] |= 128;
  }

  set decayingVelocityTime(value: number) {
    LocomotionSchema.decayingVelocityTime = value;
  }

  static get decayingVelocityScale() {
    return LocomotionSchema.store.decayingVelocityScale[this.id];
  }

  get decayingVelocityScale() {
    return LocomotionSchema.decayingVelocityScale;
  }

  static set decayingVelocityScale(value: number) {
    LocomotionSchema.store.decayingVelocityScale[this.id] = value;
    LocomotionSchema.store.__changes[this.id] |= 256;
  }

  set decayingVelocityScale(value: number) {
    LocomotionSchema.decayingVelocityScale = value;
  }

  static get fixedDirection() {
    return LocomotionSchema.store.fixedDirection[this.id] === 1;
  }

  get fixedDirection() {
    return LocomotionSchema.fixedDirection;
  }

  static set fixedDirection(value: boolean) {
    LocomotionSchema.store.fixedDirection[this.id] = value ? 1 : 0;
    LocomotionSchema.store.__changes[this.id] |= 512;
  }

  set fixedDirection(value: boolean) {
    LocomotionSchema.fixedDirection = value;
  }
}
