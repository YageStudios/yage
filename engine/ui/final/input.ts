import { composedContains, deepActiveElement, eventElement } from "./dom";
import { InputEventType, type InputManager } from "../../inputs/InputManager";
import { isEditable } from "./focus";
import type { UIFinal } from "./runtime";
import type { NavigationAction } from "./nodes";
import type { Dispose } from "./reactive";

export interface InputBridgeOptions {
  /** Explicit menu ownership is recommended. By default, an active modal or native focus in the root owns input. */
  active?: () => boolean;
  playerForDevice?: (type: InputEventType, device: number) => number | undefined;
  keys?: Readonly<Record<string, NavigationAction>>;
  repeatDelayMs?: number;
  repeatIntervalMs?: number;
  captureUnmapped?: boolean;
}
const defaults: Readonly<Record<string, NavigationAction>> = {
  left: "left", a: "left", right: "right", d: "right", up: "up", w: "up", down: "down", s: "down",
  e: "accept", enter: "accept", space: "accept", q: "cancel", escape: "cancel", tab: "next",
};
/** Installs ahead of legacy UI listeners; key releases ALWAYS pass through to clear previously-held gameplay inputs. */
export function connectInput(manager: InputManager, ui: UIFinal, options: InputBridgeOptions = {}): Dispose {
  const delay = options.repeatDelayMs ?? 350, interval = options.repeatIntervalMs ?? 90;
  if (!Number.isFinite(delay) || delay < 0 || !Number.isFinite(interval) || interval <= 0) throw new Error("UIF_INPUT_REPEAT: invalid repeat timing");
  const map = options.keys ?? defaults;
  const active = options.active ?? (() => !!ui.focus.currentModal || composedContains(ui.root, deepActiveElement(ui.root.ownerDocument)));
  const held = new Map<string, { action?: NavigationAction; player: number; remaining: number }>();
  const unlisten = manager.addKeyListener((key, pressed, type, device, native) => {
    if (type !== InputEventType.GAMEPAD && type !== InputEventType.KEYBOARD) return;
    const identity = `${type}:${device}:${key}`;
    if (!pressed) { held.delete(identity); return; }
    if (!ui.acceptsInput || !active()) return;
    const player = options.playerForDevice ? options.playerForDevice(type, device) : type === InputEventType.GAMEPAD ? device : 0;
    if (player === undefined) return;
    if (!Number.isInteger(player) || player < 0) throw new Error("UIF_INPUT_PLAYER: player mapping must return a non-negative integer or undefined");
    const keyboard = native as KeyboardEvent | undefined;
    if (type === InputEventType.KEYBOARD && (keyboard?.isComposing || isEditable(keyboard ? eventElement(keyboard) : deepActiveElement(ui.root.ownerDocument)))) return false;
    const action = map[key.toLowerCase()];
    if (!action) return options.captureUnmapped !== false ? false : undefined;
    if (!held.has(identity)) {
      held.set(identity, { action, player, remaining: delay });
      ui.focus.navigate(action, player);
    }
    native?.preventDefault();
    return false;
  }, 1000);
  const removeFrame = ui.addFrameTask(dtMs => {
    if (!ui.acceptsInput || !active()) { held.clear(); return; }
    for (const press of held.values()) {
      if (!press.action || !["left", "right", "up", "down", "next", "previous"].includes(press.action)) continue;
      press.remaining -= dtMs;
      if (press.remaining <= 0) {
        ui.focus.navigate(press.action, press.player);
        // One repeat per render frame; no catch-up burst after suspension.
        press.remaining = interval;
      }
    }
  });
  let disposed = false;
  const unregister = ui.scope.add(() => dispose());
  const dispose = () => {
    if (disposed) return;
    disposed = true; unlisten(); removeFrame(); held.clear(); unregister();
  };
  return dispose;
}
