const EMPTY_ARRAY: string[] = [];

export class PlayerEventManager {
  private queue: { [netId: string]: string[] } = {};

  public addEvent(netId: string, event: string) {
    if (!this.queue[netId]) {
      this.queue[netId] = [];
    }
    this.queue[netId].push(event);
  }

  public getEvents(netId: string) {
    if (Object.keys(this.queue[netId] ?? []).length === 0) {
      return EMPTY_ARRAY;
    }
    const changes = this.queue[netId];
    this.queue[netId] = [];
    return changes;
  }
}
