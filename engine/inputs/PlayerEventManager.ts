const EMPTY_ARRAY: string[] = [];

export class PlayerEventManager {
  private queue: string[] = [];

  public getLastQueue() {
    return [this.queue[this.queue.length - 1], this.queue.length];
  }

  public addEvent(event: string) {
    this.queue.push(event);
  }

  public getEvents() {
    if (Object.keys(this.queue).length === 0) {
      return EMPTY_ARRAY;
    }
    const changes = this.queue;
    this.queue = [];
    return changes;
  }
}
