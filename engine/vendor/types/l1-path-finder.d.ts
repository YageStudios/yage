declare module "l1-path-finder" {
  import type { NdArray } from "ndarray";
  interface Pathfinder {
    search: (srcX: number, srcY: number, dstX: number, dstY: number, pathOut: number[]) => number;
    map: NdArray;
  }

  export default function pathfinder(maze: NdArray): Pathfinder;
}
