import type { InputManager } from "./InputManager";
import { InputEventType } from "./InputManager";
import type { GamepadRegion } from "./InputRegion";

const haveEvents = "ongamepadconnected" in window;
const controllers: {
  [key: number]: Gamepad;
} = {};

const previousStates: {
  [key: number]: {
    buttons: number[];
    axes: number[];
  };
} = {};

function connecthandler(e: GamepadEvent) {
  addgamepad(e.gamepad);
}

// eslint-disable-next-line @typescript-eslint/ban-types
const listeners: Function[] = [];

function addGamepadListener(listener: (padIndex: number, isAxis: boolean, index: number, value: number) => void) {
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    listeners.splice(index, 1);
  };
}

function addgamepad(gamepad: Gamepad) {
  controllers[gamepad.index] = gamepad;
  requestAnimationFrame(updateStatus);
}

function disconnecthandler(e: GamepadEvent) {
  removegamepad(e.gamepad);
}

function removegamepad(gamepad: Gamepad) {
  const d = document.getElementById(`controller${gamepad.index}`);
  d && document.body.removeChild(d);
  delete controllers[gamepad.index];
}

function updateStatus() {
  if (!haveEvents) {
    scangamepads();
  }

  Object.entries(controllers).forEach(([i, controller]) => {
    const prevState = previousStates[controller.index] || {
      buttons: Array(controller.buttons.length).fill(0),
      axes: Array(controller.axes.length).fill(0),
    };

    controller.buttons.forEach((button, i) => {
      let pressed = false;
      let val = 0;

      if (typeof button === "object") {
        pressed = button.pressed;
        val = button.value;
      } else {
        pressed = button === 1.0;
        val = button;
      }
      const pressChange = val !== (prevState.buttons[i] ?? 0);
      if (pressChange) {
        listeners.forEach((listener) => listener(controller.index, false, i, val));
      }
      prevState.buttons[i] = val;
    });

    controller.axes.forEach((axis, i) => {
      const prevAxis = prevState.axes[i];
      // truncate the axis value to 2 decimal places
      axis = Math.round(axis * 100) / 100;
      const axisChange = axis !== prevAxis;
      if (axisChange) {
        listeners.forEach((listener) => listener(controller.index, true, i, axis));
      }

      prevState.axes[i] = axis;
    });

    previousStates[controller.index] = prevState;
  });

  requestAnimationFrame(updateStatus);
}

function scangamepads() {
  const gamepads = navigator.getGamepads();

  for (const gamepad of gamepads) {
    if (gamepad) {
      // Can be null if disconnected during the session
      if (gamepad.index in controllers) {
        controllers[gamepad.index] = gamepad;
      } else {
        addgamepad(gamepad);
      }
    }
  }
}

window.addEventListener("gamepadconnected", connecthandler);
window.addEventListener("gamepaddisconnected", disconnecthandler);

if (!haveEvents) {
  setInterval(scangamepads, 500);
}

export const StandardGamepadRegions: GamepadRegion[] = [
  {
    id: {
      type: "button",
      index: [12, 13, 14, 15],
    },
    type: "tap",
    key: ["up", "down", "left", "right"],
  },
  {
    id: {
      type: "axis",
      index: [0, 1],
      deadzone: 0.25,
    },
    type: "joystick",
    key: ["a", "d", "w", "s"],
    skew: {
      zone: [10, 30],
      keys: ["↖️", "↘️"],
    },
  },
  {
    id: {
      type: "button",
      index: 0,
    },
    type: "tap",
    key: "space",
  },
  {
    id: {
      type: "button",
      index: 1,
    },
    type: "tap",
    key: "q",
  },
];

export class GamepadListener {
  registry: {
    [controllerIndex: number]: { [key: string]: [number, number, number] };
  } = {};
  constructor(public inputManager: InputManager) {}
  // eslint-disable-next-line @typescript-eslint/ban-types
  unsubscribe: Function | null = null;

  init(gamepadRegions: GamepadRegion[]) {
    this.unsubscribe = addGamepadListener((padIndex, isAxis, index, value) => {
      // console.log(padIndex, isAxis, index, value);
      if (isAxis) {
        gamepadRegions.forEach((region) => {
          if (
            region.id.type === "axis" &&
            ((typeof region.id.index === "number" && region.id.index === index) ||
              (Array.isArray(region.id.index) && region.id.index.includes(index)))
          ) {
            const axisIndexIndex = Array.isArray(region.id.index) ? region.id.index.indexOf(index) : 0;
            if (region.skew && Array.isArray(region.id.index) && region.id.index.length === 2) {
              const angle =
                Math.atan2(
                  Math.abs(controllers[padIndex].axes[region.id.index[0]]),
                  Math.abs(controllers[padIndex].axes[region.id.index[1]])
                ) *
                (180 / Math.PI);
              let baseIndex = 1;
              let relativeAngle = angle;
              if (angle > 45) {
                baseIndex = 0;
                relativeAngle = 90 - angle;
              }
              const altIndex = baseIndex === 0 ? 1 : 0;
              let inactiveKeys = [...region.key, ...region.skew.keys];
              const activeKeys: string[] = [];
              const onlyOneKey = false;
              const value = controllers[padIndex].axes[region.id.index[baseIndex]];
              const altValue = controllers[padIndex].axes[region.id.index[altIndex]];

              if (relativeAngle < region.skew.zone[1]) {
                const index = value < 0 ? baseIndex * 2 : baseIndex * 2 + 1;
                const key = region.key[index];
                if (Math.abs(value) > (region.id.deadzone ?? 0)) {
                  activeKeys.push(key);
                }
                // this.handleKeySimulation()
                if (relativeAngle > region.skew.zone[0]) {
                  if (Math.abs(altValue) > (region.id.deadzone ?? 0)) {
                    activeKeys.push(region.skew.keys[altValue < 0 ? 0 : 1]);
                  }
                }
              } else {
                if (Math.abs(value) > (region.id.deadzone ?? 0)) {
                  activeKeys.push(region.key[value < 0 ? baseIndex * 2 : baseIndex * 2 + 1]);
                }
                if (Math.abs(altValue) > (region.id.deadzone ?? 0)) {
                  activeKeys.push(region.key[altValue < 0 ? altIndex * 2 : altIndex * 2 + 1]);
                }
              }

              inactiveKeys = inactiveKeys.filter((key) => !activeKeys.includes(key));
              activeKeys.forEach((key) => {
                this.handleKeySimulation(key, true, padIndex);
              });
              inactiveKeys.forEach((key) => {
                this.handleKeySimulation(key, false, padIndex);
              });
            } else {
              const pressed = Math.abs(value) > (region.id.deadzone ?? 0);
              const key = region.key[axisIndexIndex * 2 + (value > 0 ? 1 : 0)];
              const otherKey = region.key[axisIndexIndex * 2 + (value > 0 ? 0 : 1)];
              this.handleKeySimulation(key, pressed, padIndex);
              this.handleKeySimulation(otherKey, false, padIndex);
            }
          }
        });
      } else {
        gamepadRegions.forEach((region) => {
          if (
            region.id.type === "button" &&
            ((typeof region.id.index === "number" && region.id.index === index) ||
              (Array.isArray(region.id.index) && region.id.index.includes(index)))
          ) {
            const buttonIndexIndex = Array.isArray(region.id.index) ? region.id.index.indexOf(index) : 0;
            const pressed = value > (region.id.deadzone ?? 0);
            if (Array.isArray(region.key)) {
              this.handleKeySimulation(region.key[buttonIndexIndex], pressed, padIndex);
            } else {
              this.handleKeySimulation(region.key, pressed, padIndex);
            }
          }
        });
      }
    });
  }

  destroy() {
    this.unsubscribe && this.unsubscribe();
    this.unsubscribe = null;
    for (const padIndex in this.registry) {
      const registry = this.registry[padIndex];
      for (const key in registry) {
        clearInterval(registry[key][2]);
      }
    }
  }

  intitialDelay = 600;
  multiDelay = 80;

  handleKeySimulation(key: string, pressed: boolean, padIndex: number) {
    if (!this.registry[padIndex]) {
      this.registry[padIndex] = {};
    }
    const registry = this.registry[padIndex];
    if (!registry[key]) {
      registry[key] = [0, 0, 0];
    }
    if (!pressed) {
      if (registry[key][0]) {
        clearInterval(registry[key][2]);
        this.inputManager.dispatchEvent(key, pressed, InputEventType.GAMEPAD);
        registry[key] = [0, 0, 0];
      }
    } else {
      const triggerTime = +new Date();
      if (registry[key][0] === 0) {
        clearInterval(registry[key][2]);
        registry[key] = [
          triggerTime,
          triggerTime,
          setInterval(() => {
            this.handleKeySimulation(key, true, padIndex);
          }, this.multiDelay / 4) as any,
        ];
        this.inputManager.dispatchEvent(key, pressed, InputEventType.GAMEPAD);
      } else if (registry[key][0] + this.intitialDelay < triggerTime) {
        if (registry[key][1] + this.multiDelay < triggerTime) {
          registry[key][1] = triggerTime;
          this.inputManager.dispatchEvent(key, pressed, InputEventType.GAMEPAD, padIndex);
        }
      }
    }
  }
}
