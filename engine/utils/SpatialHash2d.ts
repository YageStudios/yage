export class SpatialHash2d {
  private readonly cellSize: number;
  private readonly cells = new Map<string, Set<number>>();
  private readonly entityCells = new Map<number, string>();

  constructor(cellSize = 256) {
    this.cellSize = Math.max(1, cellSize);
  }

  private toCell(value: number): number {
    return Math.floor(value / this.cellSize);
  }

  private getKey(cellX: number, cellY: number): string {
    return `${cellX}:${cellY}`;
  }

  private getPointKey(x: number, y: number): string {
    return this.getKey(this.toCell(x), this.toCell(y));
  }

  insert(entity: number, x: number, y: number): void {
    const key = this.getPointKey(x, y);
    const cell = this.cells.get(key) ?? new Set<number>();
    cell.add(entity);
    this.cells.set(key, cell);
    this.entityCells.set(entity, key);
  }

  update(entity: number, x: number, y: number): void {
    const nextKey = this.getPointKey(x, y);
    const prevKey = this.entityCells.get(entity);
    if (prevKey === nextKey) {
      return;
    }
    if (prevKey) {
      const prevCell = this.cells.get(prevKey);
      if (prevCell) {
        prevCell.delete(entity);
        if (prevCell.size === 0) {
          this.cells.delete(prevKey);
        }
      }
    }
    const nextCell = this.cells.get(nextKey) ?? new Set<number>();
    nextCell.add(entity);
    this.cells.set(nextKey, nextCell);
    this.entityCells.set(entity, nextKey);
  }

  remove(entity: number): void {
    const key = this.entityCells.get(entity);
    if (!key) {
      return;
    }
    const cell = this.cells.get(key);
    if (cell) {
      cell.delete(entity);
      if (cell.size === 0) {
        this.cells.delete(key);
      }
    }
    this.entityCells.delete(entity);
  }

  query(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const minCellX = this.toCell(minX);
    const maxCellX = this.toCell(maxX);
    const minCellY = this.toCell(minY);
    const maxCellY = this.toCell(maxY);
    const result = new Set<number>();

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const cell = this.cells.get(this.getKey(cx, cy));
        if (!cell) {
          continue;
        }
        for (const entity of cell) {
          result.add(entity);
        }
      }
    }
    return Array.from(result);
  }
}
