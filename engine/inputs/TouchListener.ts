import { InputManager } from "./InputManager";

export type TouchRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  deadzone?: number;
  type: "tap" | "joystick" | "dpad" | "longpress" | "doubletap";
  key: string | string[];
};

const LeftStick: TouchRegion = {
  x: 0,
  y: 0,
  width: 960,
  height: 1080,
  type: "joystick",
  key: ["w", "a", "s", "d"],
};

const RightStick: TouchRegion = {
  x: 960,
  y: 0,
  width: 960,
  height: 1080,
  type: "joystick",
  key: ["i", "j", "k", "l"],
};

const LeftDoubleTap: TouchRegion = {
  x: 0,
  y: 0,
  width: 960,
  height: 1080,
  type: "doubletap",
  key: "space",
};

const RightDoubleTap: TouchRegion = {
  x: 960,
  y: 0,
  width: 960,
  height: 1080,
  type: "doubletap",
  key: "space",
};

const TwinStickDoubleTap: TouchRegion[] = [LeftStick, RightStick, LeftDoubleTap, RightDoubleTap];

export const PreconfiguredTouchRegions = {
  TwinStickDoubleTap,
};

export class TouchListener {
  regions: TouchRegion[] = [];

  touchStart: TouchEvent | null = null;
  lastTouch: TouchEvent | null = null;
  lastTap: TouchEvent | null = null;

  activeTouches = new Map();
  lastTouchs = new Map();
  lastTouchTimes = new Map();
  touchStarts = new Map();
  touchStartTimes = new Map();
  lastTapTimes = new Map();

  constructor(public inputManager: InputManager) {
    const interactionDiv = document.getElementById("interaction") as HTMLElement;

    interactionDiv.addEventListener("touchstart", this.handleTouchStart);
    interactionDiv.addEventListener("touchend", this.handleTouchEnd);
    interactionDiv.addEventListener("touchmove", this.handleTouchMove);

    interactionDiv.addEventListener("contextmenu", this.noContext);
  }

  assignRegion(region: TouchRegion) {
    this.regions.push(region);

    return () => {
      this.regions = this.regions.filter((r) => r !== region);
    };
  }

  replaceRegions(regions: TouchRegion[]) {
    this.regions = regions;
  }

  destroy() {
    const interactionDiv = document.getElementById("interaction") as HTMLElement;

    interactionDiv.removeEventListener("touchstart", this.handleTouchStart);
    interactionDiv.removeEventListener("touchend", this.handleTouchEnd);
    interactionDiv.removeEventListener("touchmove", this.handleTouchMove);
    interactionDiv.removeEventListener("contextmenu", this.noContext);
  }

  noContext = (e: Event) => {
    e.preventDefault();
  };

  handleTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    for (const touch of Array.from(e.changedTouches)) {
      this.activeTouches.set(touch.identifier, touch);
      // Handle the start of each touch
      this.handletouch(e.timeStamp, touch, "move");
    }
  };

  handleTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    for (const touch of Array.from(e.changedTouches)) {
      this.activeTouches.set(touch.identifier, touch);
      // Handle the start of each touch
      this.handletouch(e.timeStamp, touch, "start");
    }
  };

  handleTouchEnd = (e: TouchEvent) => {
    e.preventDefault();
    for (const touch of Array.from(e.changedTouches)) {
      this.activeTouches.set(touch.identifier, touch);
      // Handle the start of each touch
      this.handletouch(e.timeStamp, touch, "end");
    }
  };

  handletouch(timestamp: number, touch: Touch, prefix: string) {
    if (prefix === "start") {
      this.touchStarts.set(touch.identifier, touch);
      this.touchStartTimes.set(touch.identifier, timestamp);
      // this.lastTouchs = null;
    }

    this.regions.forEach((region) => {
      if (region.type === "tap") {
        this.handleTap(region, touch, timestamp, prefix);
      } else if (region.type === "joystick") {
        this.handleJoystick(region, touch, timestamp, prefix);
      } else if (region.type === "dpad") {
        // this.handleDpad(region, e, prefix);
      } else if (region.type === "longpress") {
        this.handleLongPress(region, touch, timestamp, prefix);
      } else if (region.type === "doubletap") {
        this.handleDoubleTap(region, touch, timestamp, prefix);
      }
    });

    this.lastTouchs.set(touch.identifier, touch);
    this.lastTouchTimes.set(touch.identifier, timestamp);

    if (prefix === "end") {
      this.activeTouches.delete(touch.identifier);
      this.touchStarts.delete(touch.identifier);
      this.lastTouchs.delete(touch.identifier);
      this.lastTouchTimes.delete(touch.identifier);
      this.touchStartTimes.delete(touch.identifier);
    }
  }

  inRegion(region: TouchRegion, touch: Touch) {
    const normalizedX = touch.clientX * (1920 / window.innerWidth);
    const normalizedY = touch.clientY * (1080 / window.innerHeight);

    return (
      normalizedX >= region.x &&
      normalizedX <= region.x + region.width &&
      normalizedY >= region.y &&
      normalizedY <= region.y + region.height
    );
  }

  handleTap(region: TouchRegion, touch: Touch, timestamp: number, prefix: string) {
    if (prefix === "start") {
      return;
    }
    if (prefix === "end") {
      if (this.inRegion(region, this.lastTouchs.get(touch.identifier)!)) {
        if (timestamp! - this.touchStartTimes.get(touch.identifier)! < 500) {
          this.inputManager.dispatchEvent(region.key as string, true);
          setTimeout(() => this.inputManager.dispatchEvent(region.key as string, false), 100);
        }
      }
    }
  }

  handleDoubleTap(region: TouchRegion, touch: Touch, timestamp: number, prefix: string) {
    if (prefix === "start") {
      return;
    }
    const tapKey = `${region.x}_${region.y}_${region.width}_${region.height}`;
    if (prefix === "end") {
      if (this.inRegion(region, this.lastTouchs.get(touch.identifier)!)) {
        if (
          !this.lastTapTimes.has(tapKey) ||
          this.lastTouchTimes.get(touch.identifier)! - this.lastTapTimes.get(tapKey) > 500
        ) {
          this.lastTapTimes.set(tapKey, timestamp);
          return;
        }

        if (timestamp - this.touchStartTimes.get(touch.identifier)! < 500) {
          this.inputManager.dispatchEvent(region.key as string, true);
          setTimeout(() => this.inputManager.dispatchEvent(region.key as string, false), 100);
          this.lastTapTimes.delete(tapKey);
        }
      }
    }
  }

  handleLongPress(region: TouchRegion, touch: Touch, timestamp: number, prefix: string) {
    if (prefix === "start") {
      return;
    }
    if (prefix === "end") {
      if (this.inRegion(region, this.lastTouchs.get(touch.identifier)!)) {
        if (timestamp! - this.touchStartTimes.get(touch.identifier)! > 500) {
          this.inputManager.dispatchEvent(region.key as string, true);
          setTimeout(() => this.inputManager.dispatchEvent(region.key as string, false), 100);
        }
      }
    }
  }

  handleJoystick(region: TouchRegion, touch: Touch, timestamp: number, prefix: string) {
    if (prefix === "start") {
      return;
    }

    const angleToKey = (angle: number, region: TouchRegion) => {
      while (angle < 0) {
        angle += Math.PI * 2;
      }
      const a = angle / (Math.PI * 2);
      const UP = region.key[0];
      const LEFT = region.key[1];
      const DOWN = region.key[2];
      const RIGHT = region.key[3];
      if (a > 0.9375 || a < 0.0625) {
        return [RIGHT];
      } else if (a < 0.1875) {
        return [DOWN, RIGHT];
      } else if (a < 0.3125) {
        return [DOWN];
      } else if (a < 0.4375) {
        return [DOWN, LEFT];
      } else if (a < 0.5625) {
        return [LEFT];
      } else if (a < 0.6875) {
        return [UP, LEFT];
      } else if (a < 0.8125) {
        return [UP];
      } else {
        return [UP, RIGHT];
      }
    };

    const keysFromTouch = (touch: Touch, touchStart: Touch, region: TouchRegion) => {
      const dx = touch.clientX - touchStart.clientX;
      const dy = touch.clientY - touchStart.clientY;
      const angle = Math.atan2(dy, dx);
      const distance = Math.sqrt(dx * dx + dy * dy);
      const maxDistance = Math.min(region.width, region.height) / 2;
      const normalizedDistance = Math.min(distance / maxDistance, 1);
      // const normalizedAngle = angle / (Math.PI * 2);
      if (normalizedDistance > (region.deadzone ?? 0)) {
        if (Array.isArray(region.key)) {
          // map angle to arrow keys
          const keys = angleToKey(angle, region);
          return keys;
        }
        return [region.key];
      }
      return [];
    };

    const touchStart = this.touchStarts.get(touch.identifier)!;
    const lastTouch = this.lastTouchs.get(touch.identifier)!;
    if (this.inRegion(region, touchStart) || prefix === "end") {
      const lastKeys = lastTouch ? keysFromTouch(lastTouch, touchStart, region) : [];
      const keys = keysFromTouch(touch, touchStart, region);
      let keysDown = keys.filter((k) => !lastKeys.includes(k));
      let keysUp = lastKeys.filter((k) => !keys.includes(k));

      if (prefix === "end") {
        keysUp = lastKeys;
        keysDown = [];
      }

      keysDown.forEach((key) => {
        this.inputManager.dispatchEvent(key, true);
      });
      keysUp.forEach((key) => {
        this.inputManager.dispatchEvent(key, false);
      });
      return;
    }
  }
}
