import { EVENT_TYPE, InputManager } from "./InputManager";
import { GamepadRegion } from "./InputRegion";

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
];

export class GamepadListener {
  registry: { [key: string]: [number, number, number] } = {};
  constructor(public inputManager: InputManager) {}
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
              let angle =
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
              let altIndex = baseIndex === 0 ? 1 : 0;
              let inactiveKeys = [...region.key, ...region.skew.keys];
              let activeKeys: string[] = [];
              let onlyOneKey = false;
              let value = controllers[padIndex].axes[region.id.index[baseIndex]];
              let altValue = controllers[padIndex].axes[region.id.index[altIndex]];

              if (relativeAngle < region.skew.zone[1]) {
                let index = value < 0 ? baseIndex * 2 : baseIndex * 2 + 1;
                let key = region.key[index];
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
                this.handleKeySimulation(key, true);
              });
              inactiveKeys.forEach((key) => {
                this.handleKeySimulation(key, false);
              });
            } else {
              let pressed = Math.abs(value) > (region.id.deadzone ?? 0);
              let key = region.key[axisIndexIndex * 2 + (value > 0 ? 1 : 0)];
              let otherKey = region.key[axisIndexIndex * 2 + (value > 0 ? 0 : 1)];
              this.handleKeySimulation(key, pressed);
              this.handleKeySimulation(otherKey, false);
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
            console.log(
              "pressed",
              region,
              pressed,
              value,
              region.id.deadzone,
              Array.isArray(region.key) ? region.key[buttonIndexIndex] : region.key
            );
            if (Array.isArray(region.key)) {
              this.handleKeySimulation(region.key[buttonIndexIndex], pressed);
            } else {
              this.handleKeySimulation(region.key, pressed);
            }
          }
        });
      }
    });
  }

  destroy() {
    this.unsubscribe && this.unsubscribe();
    this.unsubscribe = null;
    for (const key in this.registry) {
      clearInterval(this.registry[key][2]);
    }
  }

  intitialDelay = 500;
  multiDelay = 50;

  handleKeySimulation(key: string, pressed: boolean) {
    if (!this.registry[key]) {
      this.registry[key] = [0, 0, 0];
    }
    if (!pressed) {
      if (this.registry[key][0]) {
        clearInterval(this.registry[key][2]);
        this.inputManager.dispatchEvent(key, pressed, EVENT_TYPE.GAMEPAD);
        this.registry[key] = [0, 0, 0];
      }
    } else {
      let triggerTime = +new Date();
      if (this.registry[key][0] === 0) {
        clearInterval(this.registry[key][2]);
        this.registry[key] = [
          triggerTime,
          triggerTime,
          setInterval(() => {
            this.handleKeySimulation(key, true);
          }, this.multiDelay / 4) as any,
        ];
        this.inputManager.dispatchEvent(key, pressed, EVENT_TYPE.GAMEPAD);
      } else if (this.registry[key][0] + this.intitialDelay < triggerTime) {
        if (this.registry[key][1] + this.multiDelay < triggerTime) {
          this.registry[key][1] = triggerTime;
          this.inputManager.dispatchEvent(key, pressed, EVENT_TYPE.GAMEPAD);
        }
      }
    }
  }
}
