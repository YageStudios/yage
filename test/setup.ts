import { vi } from "vitest";

vi.mock("@pixi/sound", () => ({
  sound: {
    disableAutoPause: false,
    add: vi.fn(),
    play: vi.fn(),
    stop: vi.fn(),
    volume: 1,
  },
  Sound: class {},
}));

vi.mock("pixi.js", () => {
  const Container = class {
    children: any[] = [];

    addChild(child: any) {
      this.children.push(child);
      return child;
    }

    removeChild(child: any) {
      this.children = this.children.filter((item) => item !== child);
      return child;
    }
  };

  return {
    Container,
    Application: class {
      renderer = {
        view: new FakeElement(),
        events: {},
        resize: vi.fn(),
        render: vi.fn(),
      };
      view = this.renderer.view;
      stage = new Container();

      destroy() {}
    },
    Sprite: class extends Container {},
    Texture: { from: vi.fn(), EMPTY: {} },
    Graphics: class extends Container {},
    Text: class extends Container {},
    BaseTexture: class {},
    Spritesheet: class {
      parse() {
        return Promise.resolve();
      }
    },
    SCALE_MODES: { NEAREST: 0 },
    Assets: { load: vi.fn(() => Promise.resolve({})) },
    settings: {},
    Rectangle: class {},
  };
});

vi.mock("pixi-spine", () => ({
  Spine: class {},
  SkeletonData: class {},
}));

vi.mock("pixi-viewport", () => ({
  Viewport: class {
    worldWidth = 0;
    worldHeight = 0;
    visible = true;
    sortableChildren = false;

    resize() {}
    setZoom() {}
    drag() {
      return this;
    }
    pinch() {
      return this;
    }
    wheel() {
      return this;
    }
    decelerate() {
      return this;
    }
    moveCenter() {}
    addChild() {}
    removeChild() {}
    destroy() {}
    on() {
      return this;
    }
  },
}));

vi.mock("@dimforge/rapier2d-compat", () => ({
  default: {},
  init: vi.fn(),
}));

class FakeClassList {
  private values = new Set<string>();

  add(...tokens: string[]) {
    tokens.forEach((token) => this.values.add(token));
  }

  remove(...tokens: string[]) {
    tokens.forEach((token) => this.values.delete(token));
  }

  contains(token: string) {
    return this.values.has(token);
  }
}

class FakeElement {
  id = "";
  style: Record<string, any> = {};
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  classList = new FakeClassList();
  innerHTML = "";
  innerText = "";
  value = "";
  scrollLeft = 0;
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  clientWidth = 0;
  offsetWidth = 0;
  offsetHeight = 0;
  onclick: ((e: any) => void) | null = null;
  onmousedown: ((e: any) => void) | null = null;
  onmouseup: ((e: any) => void) | null = null;
  onmouseenter: ((e: any) => void) | null = null;
  onmouseleave: ((e: any) => void) | null = null;
  onscroll: ((e: any) => void) | null = null;

  appendChild(child: FakeElement) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeElement) {
    this.children = this.children.filter((item) => item !== child);
    child.parentElement = null;
    return child;
  }

  remove() {
    this.parentElement?.removeChild(this);
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      right: this.clientWidth || this.offsetWidth || 0,
      bottom: this.clientHeight || this.offsetHeight || 0,
      width: this.clientWidth || this.offsetWidth || 0,
      height: this.clientHeight || this.offsetHeight || 0,
    };
  }

  addEventListener() {}

  removeEventListener() {}

  focus() {}
}

const createStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
};

const body = new FakeElement();
body.clientWidth = 1920;
body.clientHeight = 1080;
body.offsetWidth = 1920;
body.offsetHeight = 1080;

const documentStub = {
  body,
  createElement: () => new FakeElement(),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
};

const windowStub = {
  innerWidth: 1920,
  innerHeight: 1080,
  outerWidth: 1920,
  outerHeight: 1080,
  addEventListener: () => {},
  removeEventListener: () => {},
  location: {
    reload: () => {},
  },
  localStorage: createStorage(),
  sessionStorage: createStorage(),
  performanceUpdate: undefined,
  navigator: {
    getGamepads: () => [],
  },
  __YAGE__: {
    EntityFactory: {
      generateEntity: (gameModel: { coreEntity: number }) => gameModel.coreEntity,
    },
  },
};

vi.stubGlobal("window", windowStub);
vi.stubGlobal("document", documentStub);
vi.stubGlobal("navigator", windowStub.navigator);
vi.stubGlobal("localStorage", windowStub.localStorage);
vi.stubGlobal("sessionStorage", windowStub.sessionStorage);
vi.stubGlobal("HTMLElement", FakeElement);
vi.stubGlobal("HTMLDivElement", FakeElement);
vi.stubGlobal("HTMLSpanElement", FakeElement);
vi.stubGlobal("HTMLInputElement", FakeElement);
vi.stubGlobal("HTMLCanvasElement", FakeElement);
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
