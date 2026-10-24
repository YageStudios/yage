/**
 * Typed command queues: one system asks another for something by pushing a command onto the
 * target entity's queue component, instead of calling the other system. The owning system drains
 * the queue in push order once per run (drainCommands), and it is empty afterwards. One system
 * owns each queue type: only it drains.
 *
 * A game declares its queue as a component:
 *
 *   @Component("DoorCommands")
 *   class DoorCommands extends Commands<DoorCommand> {}
 *
 * Import as `yage/world/commands`. Queues hold plain objects (type "object"): they are runtime
 * hand-offs, not saved state.
 */
import { defaultValue, Schema, type } from "minecs";

export class Commands<T> extends Schema {
  @type(["object"])
  @defaultValue([])
  commands: T[];
}

/** Asks the queue's owner for `command`; it runs on the owner's next drain. */
export const pushCommand = <T>(queue: Commands<T>, command: T): void => {
  queue.commands.push(command);
};

/**
 * Runs `each` over the queued commands in push order (commands pushed while draining run in the
 * same drain), then empties the queue. Call it from the queue's one owning system.
 */
export const drainCommands = <T>(queue: Commands<T>, each: (command: T) => void): void => {
  const list = queue.commands;
  try {
    for (let i = 0; i < list.length; i++) each(list[i]);
  } finally {
    list.length = 0;
  }
};
