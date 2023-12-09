import { Schema } from "../decorators/type";

const eqSet = <T>(xs: Set<T>, ys: Set<T>) => xs.size === ys.size && Array.from(xs).every((x) => ys.has(x));

export class ByteArray extends Schema {
  bytes: Set<number> = new Set<number>();

  constructor(values?: any) {
    super(values);
  }

  get(index: number) {
    return this.bytes.has(index);
  }

  set(index: number, active: boolean) {
    if (active) {
      this.bytes.add(index);
    } else {
      this.bytes.delete(index);
    }
  }

  has(index: number): boolean {
    return this.get(index);
  }

  equals(other: ByteArray | undefined | null): boolean {
    if (!other) {
      return false;
    }
    return eqSet(this.bytes, other.bytes);
  }

  compare(indexes: number[]) {
    return indexes.every((index) => this.get(index));
  }

  enable(index: number) {
    this.set(index, true);
  }

  disable(index: number) {
    this.set(index, false);
  }

  getEnabled(): number[] {
    return Array.from(this.bytes.values());
  }
}
