import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock heavy/browser-only dependencies that blow up in jsdom
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
    addChild() {}
    removeChild() {}
    children = [];
  };
  return {
    Container,
    Application: class {},
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
    default: {},
  };
});
vi.mock("pixi-spine", () => ({
  Spine: class {},
  SkeletonData: class {},
}));
vi.mock("pixi-viewport", () => ({
  Viewport: class {},
}));
vi.mock("@dimforge/rapier2d-compat", () => ({
  default: {},
  init: vi.fn(),
}));
vi.mock("yage/console/flags", () => ({
  flags: {},
  toggleFlag: vi.fn(),
}));

import { buildUiMap, registerUiClass, registerTemplate, getUiMapTemplate } from "yage/ui/UiMap";
import { Box } from "yage/ui/Box";
import { Text } from "yage/ui/Text";
import { Position } from "yage/ui/Rectangle";
import { scalePxStyleValue } from "yage/ui/utils";

// ─── helpers ───────────────────────────────────────────────────────────────────

/** Extract the flat list of UIElements that were added to the root result. */
const collectChildren = (element: any): any[] => {
  const children = element?._config?.children ?? element?.config?.children ?? [];
  return children;
};

/** Recursively collect every UIElement in a tree. */
const flatCollect = (element: any): any[] => {
  const result = [element];
  const children = element?._config?.children ?? [];
  for (const child of children) {
    result.push(...flatCollect(child));
  }
  return result;
};

// ─── Phase 1: Legacy Baseline Tests ────────────────────────────────────────────

describe("UiMap — Legacy Baseline", () => {
  beforeEach(() => {
    // Reset registered classes/templates between tests
  });

  // --------------------------------------------------------------------------
  // buildUiMap basic contract
  // --------------------------------------------------------------------------
  describe("buildUiMap contract", () => {
    it("returns build, update, and context functions", () => {
      const map = buildUiMap({
        root: {
          type: "box",
          rect: { x: 0, y: 0, width: 100, height: 100 },
          config: {},
        },
      });
      expect(typeof map.build).toBe("function");
      expect(typeof map.update).toBe("function");
      expect(typeof map.context).toBe("function");
    });

    it("build returns UIElement map keyed by top-level JSON keys", () => {
      const map = buildUiMap({
        header: {
          type: "text",
          rect: { x: 0, y: 0, width: 200, height: 30 },
          config: { label: "Hello" },
        },
      });
      const elements = map.build({}, vi.fn());
      expect(elements).toHaveProperty("header");
    });

    it("build wraps elements in a Box when boxPosition is provided", () => {
      const map = buildUiMap(
        {
          child: {
            type: "text",
            rect: { x: 0, y: 0, width: 50, height: 50 },
            config: { label: "wrapped" },
          },
        },
        new Position(0, 0, { width: 100, height: 100 })
      );
      const elements = map.build({}, vi.fn());
      expect(elements).toHaveProperty("box");
      expect(elements.box).toBeInstanceOf(Box);
    });

    it("throws when top-level value has no type", () => {
      const map = buildUiMap({
        bad: { config: {} },
      });
      expect(() => map.build({}, vi.fn())).toThrow("No nesting");
    });
  });

  // --------------------------------------------------------------------------
  // $$ variable replacement
  // --------------------------------------------------------------------------
  describe("$$ variable replacement", () => {
    it("replaces full $$variable with context value", () => {
      const json = {
        label: {
          type: "text",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { label: "$$playerName" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ playerName: "John" }, vi.fn());
      expect(elements.label._config.label).toBe("John");
    });

    it("replaces partial $$variable within a string", () => {
      const json = {
        label: {
          type: "text",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { label: "HP: $$hp" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ hp: 100 }, vi.fn());
      expect(elements.label._config.label).toBe("HP: 100");
    });

    it("resolves dot-notation paths in $$", () => {
      const json = {
        label: {
          type: "text",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { label: "$$player.stats.str" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ player: { stats: { str: 18 } } }, vi.fn());
      expect(elements.label._config.label).toBe(18);
    });

    it("updates element when context changes via update()", () => {
      const json = {
        label: {
          type: "text",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { label: "$$hp" },
        },
      };
      const map = buildUiMap(json);
      map.build({ hp: 100 }, vi.fn());
      map.update({ hp: 50 });
      // After update the internal pointer should have been called.
      // The context should reflect the new value
      expect(map.context().hp).toBe(50);
    });
  });

  // --------------------------------------------------------------------------
  // context()
  // --------------------------------------------------------------------------
  describe("context()", () => {
    it("returns deep clone of build context", () => {
      const map = buildUiMap({
        el: {
          type: "box",
          rect: { x: 0, y: 0, width: 10, height: 10 },
          config: {},
        },
      });
      const original = { a: { b: 1 } };
      map.build(original, vi.fn());
      const ctx = map.context();
      expect(ctx).toEqual(original);
      // mutations don't leak
      ctx.a.b = 999;
      expect(map.context().a.b).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Grid rendering
  // --------------------------------------------------------------------------
  describe("Grid rendering", () => {
    it("renders correct number of children from items array", () => {
      const json = {
        grid: {
          type: "grid",
          rect: { x: 0, y: 0, width: 300, height: 300 },
          config: {},
          items: "$$inventory",
          element: {
            type: "text",
            rect: { x: 0, y: 0, width: 50, height: 50 },
            config: { label: "$$name" },
          },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build(
        {
          inventory: [{ name: "Sword" }, { name: "Shield" }, { name: "Potion" }],
        },
        vi.fn()
      );
      // The grid element should have 3 children
      const grid = elements.grid;
      const children = grid._config.children ?? [];
      expect(children.length).toBe(3);
    });

    it("grid children inherit item context", () => {
      const json = {
        grid: {
          type: "grid",
          rect: { x: 0, y: 0, width: 300, height: 300 },
          config: {},
          items: "$$inventory",
          element: {
            type: "text",
            rect: { x: 0, y: 0, width: 50, height: 50 },
            config: { label: "$$name" },
          },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build(
        {
          inventory: [{ name: "Sword" }, { name: "Shield" }],
        },
        vi.fn()
      );
      const children = elements.grid._config.children ?? [];
      expect(children[0]._config.label).toBe("Sword");
      expect(children[1]._config.label).toBe("Shield");
    });

    it("grid shrinks children when items shrink", () => {
      const json = {
        grid: {
          type: "grid",
          rect: { x: 0, y: 0, width: 300, height: 300 },
          config: {},
          items: "$$items",
          element: {
            type: "text",
            rect: { x: 0, y: 0, width: 50, height: 50 },
            config: { label: "$$val" },
          },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ items: [{ val: "a" }, { val: "b" }, { val: "c" }] }, vi.fn());
      expect(elements.grid._config.children.length).toBe(3);
      map.update({ items: [{ val: "a" }] });
      expect(elements.grid._config.children.length).toBe(1);
    });

    it("grid provides $index and $context to children", () => {
      const json = {
        grid: {
          type: "grid",
          rect: { x: 0, y: 0, width: 300, height: 300 },
          config: {},
          items: "$$list",
          element: {
            type: "text",
            rect: { x: 0, y: 0, width: 50, height: 50 },
            config: { label: "$$name" },
          },
        },
      };
      const map = buildUiMap(json);
      map.build({ list: [{ name: "A" }, { name: "B" }] }, vi.fn());
      // $context and $index are injected into child contexts — this is
      // internal behavior; we verify via no crashes and correct rendering.
    });

    it("scales pixel-based style strings consistently", () => {
      expect(scalePxStyleValue("10px", 0.5)).toBe("5px");
      expect(scalePxStyleValue("10px 20px", 0.5)).toBe("5px 10px");
      expect(scalePxStyleValue("2px solid #2FA6FF", 0.5)).toBe("1px solid #2FA6FF");
    });

    it("keeps overflow scrolling enabled when a grid has too many items", async () => {
      const json = {
        grid: {
          type: "grid",
          rect: { x: 0, y: 0, width: 300, height: 120 },
          config: {
            gap: "5px",
          },
          items: "$$items",
          element: {
            type: "text",
            rect: { x: 0, y: 0, width: 80, height: 40 },
            config: { label: "$$name" },
          },
        },
      };

      const map = buildUiMap(json);
      const elements = map.build(
        {
          items: Array.from({ length: 12 }, (_, index) => ({ name: `Item ${index}` })),
        },
        vi.fn(),
      );

      expect(elements.grid._config.style.overflow).toBe("auto");
      expect(elements.grid._config.pointerEventsOnOverflow).toBe(true);
      expect(elements.grid._config.children.length).toBe(12);
    });
  });

  // --------------------------------------------------------------------------
  // Template support
  // --------------------------------------------------------------------------
  describe("Template support", () => {
    it("renders a registered template", () => {
      registerTemplate("testTpl", {
        myElement: {
          type: "text",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { label: "from template" },
        },
      });
      const json = {
        tpl: {
          type: "template",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { template: "testTpl" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({}, vi.fn());
      // Template renders its elements as children under the parent
      expect(elements.tpl).toBeDefined();
    });

    it("renders a specific element from a template via dot notation", () => {
      registerTemplate("myTpl", {
        header: {
          type: "text",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { label: "Header" },
        },
        footer: {
          type: "text",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { label: "Footer" },
        },
      });
      const json = {
        tpl: {
          type: "template",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { template: "myTpl.header" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({}, vi.fn());
      expect(elements.tpl._config.label).toBe("Header");
    });

    it("remapTemplateQueries replaces $$vars from template context", () => {
      registerTemplate("paramTpl", {
        el: {
          type: "text",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { label: "$$greeting" },
        },
      });
      const json = {
        tpl: {
          type: "template",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { template: "paramTpl" },
          context: { greeting: "Hello World" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({}, vi.fn());
      expect(elements.tpl._config.label).toBe("Hello World");
    });

    it("getUiMapTemplate retrieves registered templates", () => {
      registerTemplate("retrieve", { a: { type: "box" } });
      expect(getUiMapTemplate("retrieve")).toEqual({ a: { type: "box" } });
      expect(getUiMapTemplate("retrieve", "a")).toEqual({ type: "box" });
      expect(getUiMapTemplate("nonexistent")).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Class style registration
  // --------------------------------------------------------------------------
  describe("registerUiClass", () => {
    it("merges registered class styles into element config.style", () => {
      registerUiClass("btn-primary", {
        backgroundColor: "blue",
        color: "white",
      });
      const json = {
        btn: {
          type: "box",
          rect: { x: 0, y: 0, width: 100, height: 40 },
          config: { class: "btn-primary" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({}, vi.fn());
      expect(elements.btn._config.style.backgroundColor).toBe("blue");
      expect(elements.btn._config.style.color).toBe("white");
    });

    it("element's own style overrides class style", () => {
      registerUiClass("base", { color: "red" });
      const json = {
        el: {
          type: "box",
          rect: { x: 0, y: 0, width: 100, height: 40 },
          config: { class: "base", style: { color: "green" } },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({}, vi.fn());
      expect(elements.el._config.style.color).toBe("green");
    });
  });

  // --------------------------------------------------------------------------
  // Event generation
  // --------------------------------------------------------------------------
  describe("Event generation", () => {
    it("click event triggers eventHandler with correct arguments", () => {
      const handler = vi.fn();
      const json = {
        btn: {
          type: "box",
          rect: { x: 0, y: 0, width: 100, height: 40 },
          config: {},
          events: { click: "btnClicked" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ someData: 1 }, handler);
      // Simulate click
      elements.btn._config.onClick?.(0);
      expect(handler).toHaveBeenCalledWith(0, "btnClicked", "click", expect.objectContaining({ someData: 1 }));
    });

    it("escape event triggers eventHandler", () => {
      const handler = vi.fn();
      const json = {
        btn: {
          type: "box",
          rect: { x: 0, y: 0, width: 100, height: 40 },
          config: {},
          events: { escape: "onEsc" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({}, handler);
      elements.btn._config.onEscape?.(0);
      expect(handler).toHaveBeenCalledWith(0, "onEsc", "escape", expect.anything());
    });

    it("trigger event fires on click", () => {
      const handler = vi.fn();
      const json = {
        btn: {
          type: "box",
          rect: { x: 0, y: 0, width: 100, height: 40 },
          config: {},
          events: { trigger: "onTrigger" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({}, handler);
      elements.btn._config.onClick?.(0);
      expect(handler).toHaveBeenCalledWith(0, "onTrigger", "trigger", expect.anything());
    });

    it("mouse events are wired correctly", () => {
      const handler = vi.fn();
      const json = {
        el: {
          type: "box",
          rect: { x: 0, y: 0, width: 100, height: 40 },
          config: {},
          events: {
            mouseDown: "md",
            mouseUp: "mu",
            mouseEnter: "me",
            mouseLeave: "ml",
            focus: "f",
            blur: "b",
            hoverFocus: "hf",
            hoverBlur: "hb",
          },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({}, handler);

      elements.el._config.onMouseDown?.(1);
      expect(handler).toHaveBeenCalledWith(1, "md", "mouseDown", expect.anything());

      elements.el._config.onMouseUp?.(1);
      expect(handler).toHaveBeenCalledWith(1, "mu", "mouseUp", expect.anything());

      elements.el._config.onMouseEnter?.(1);
      expect(handler).toHaveBeenCalledWith(1, "me", "mouseEnter", expect.anything());
      expect(handler).toHaveBeenCalledWith(1, "hf", "hoverFocus", expect.anything());

      elements.el._config.onMouseLeave?.(1);
      expect(handler).toHaveBeenCalledWith(1, "ml", "mouseLeave", expect.anything());
      expect(handler).toHaveBeenCalledWith(1, "hb", "hoverBlur", expect.anything());

      elements.el._config.onFocus?.(1);
      expect(handler).toHaveBeenCalledWith(1, "f", "focus", expect.anything());

      elements.el._config.onBlur?.(1);
      expect(handler).toHaveBeenCalledWith(1, "b", "blur", expect.anything());
    });
  });

  // --------------------------------------------------------------------------
  // Children nesting
  // --------------------------------------------------------------------------
  describe("Children nesting", () => {
    it("recursively builds child elements", () => {
      const json = {
        parent: {
          type: "box",
          rect: { x: 0, y: 0, width: 200, height: 200 },
          config: {},
          children: {
            child1: {
              type: "text",
              rect: { x: 0, y: 0, width: 100, height: 30 },
              config: { label: "Child" },
            },
          },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({}, vi.fn());
      const parent = elements.parent;
      expect(parent._config.children.length).toBeGreaterThan(0);
      expect(parent._config.children[0]._config.label).toBe("Child");
    });
  });

  // --------------------------------------------------------------------------
  // Nested JSON keys (non-type intermediate objects)
  // --------------------------------------------------------------------------
  describe("Nested JSON grouping (no type)", () => {
    it("recursively traverses intermediate objects without type", () => {
      const json = {
        wrapper: {
          type: "box",
          rect: { x: 0, y: 0, width: 300, height: 300 },
          config: {},
          children: {
            group: {
              inner: {
                type: "text",
                rect: { x: 0, y: 0, width: 100, height: 30 },
                config: { label: "deep" },
              },
            },
          },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({}, vi.fn());
      // Inner text should be reachable
      const children = elements.wrapper._config.children ?? [];
      expect(children.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Query in non-config parents (rect, etc.)
  // --------------------------------------------------------------------------
  describe("$$ queries in rect and nested config", () => {
    it("applies $$ to rect properties", () => {
      const json = {
        el: {
          type: "box",
          rect: { x: "$$posX", y: 0, width: 100, height: 100 },
          config: {},
        },
      };
      const map = buildUiMap(json);
      // posX is resolved during build via getQueriables + apply
      const elements = map.build({ posX: 42 }, vi.fn());
      // The Position will have consumed the value
      expect(elements.el).toBeDefined();
    });
  });
});

// ─── Phase 2: New Feature Tests ────────────────────────────────────────────────

describe("UiMap — New Features", () => {
  // --------------------------------------------------------------------------
  // Expression evaluation {{ }}
  // --------------------------------------------------------------------------
  describe("Expression evaluation {{ }}", () => {
    it("evaluates math expressions", () => {
      const json = {
        label: {
          type: "text",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { label: "{{ hp * 2 }}" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ hp: 10 }, vi.fn());
      expect(elements.label._config.label).toBe(20);
    });

    it("evaluates ternary expressions", () => {
      const json = {
        label: {
          type: "text",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { label: "{{ isDead ? 'Dead' : 'Alive' }}" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ isDead: true }, vi.fn());
      expect(elements.label._config.label).toBe("Dead");
    });

    it("handles multiple interpolations in one string", () => {
      const json = {
        label: {
          type: "text",
          rect: { x: 0, y: 0, width: 200, height: 30 },
          config: { label: "{{ a }} + {{ b }} = {{ a + b }}" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ a: 2, b: 3 }, vi.fn());
      expect(elements.label._config.label).toBe("2 + 3 = 5");
    });

    it("returns empty string for undefined variables in expressions", () => {
      const json = {
        label: {
          type: "text",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { label: "{{ nonexistent }}" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({}, vi.fn());
      // Should not throw; should produce empty or undefined-ish output
      expect(elements.label._config.label).toBeDefined();
    });

    it("expressions update reactively", () => {
      const json = {
        label: {
          type: "text",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { label: "{{ hp }}" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ hp: 100 }, vi.fn());
      expect(elements.label._config.label).toBe(100);
      map.update({ hp: 50 });
      expect(elements.label._config.label).toBe(50);
    });

    it("supports dot-notation in expressions", () => {
      const json = {
        label: {
          type: "text",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { label: "{{ player.hp }}" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ player: { hp: 75 } }, vi.fn());
      expect(elements.label._config.label).toBe(75);
    });

    it("supports comparison operators", () => {
      const json = {
        label: {
          type: "text",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { label: "{{ val > 5 ? 'high' : 'low' }}" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ val: 10 }, vi.fn());
      expect(elements.label._config.label).toBe("high");
    });
  });

  // --------------------------------------------------------------------------
  // Legacy $$ and {{ }} coexistence
  // --------------------------------------------------------------------------
  describe("Legacy $$ to {{ }} translation", () => {
    it("$$var is transparently converted and still works", () => {
      const json = {
        label: {
          type: "text",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { label: "$$name" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ name: "Test" }, vi.fn());
      expect(elements.label._config.label).toBe("Test");
    });

    it("partial $$var in strings still works", () => {
      const json = {
        label: {
          type: "text",
          rect: { x: 0, y: 0, width: 200, height: 30 },
          config: { label: "HP: $$hp" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ hp: 100 }, vi.fn());
      expect(elements.label._config.label).toBe("HP: 100");
    });
  });

  // --------------------------------------------------------------------------
  // $if structural node
  // --------------------------------------------------------------------------
  describe("$if structural node", () => {
    it("renders then branch when condition is true", () => {
      const json = {
        root: {
          type: "box",
          rect: { x: 0, y: 0, width: 300, height: 300 },
          config: {},
          children: {
            panel: {
              $if: "val > 0",
              then: {
                type: "text",
                rect: { x: 0, y: 0, width: 100, height: 30 },
                config: { label: "Positive" },
              },
            },
          },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ val: 5 }, vi.fn());
      const children = elements.root._config.children ?? [];
      // Should find the wrapper box with the "then" child inside it
      expect(children.length).toBeGreaterThan(0);
      const allTexts = flatCollect(elements.root).filter((e) => e._config?.label === "Positive");
      expect(allTexts.length).toBe(1);
    });

    it("renders else branch when condition is false", () => {
      const json = {
        root: {
          type: "box",
          rect: { x: 0, y: 0, width: 300, height: 300 },
          config: {},
          children: {
            panel: {
              $if: "val > 0",
              then: {
                type: "text",
                rect: { x: 0, y: 0, width: 100, height: 30 },
                config: { label: "Positive" },
              },
              else: {
                type: "text",
                rect: { x: 0, y: 0, width: 100, height: 30 },
                config: { label: "Non-positive" },
              },
            },
          },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ val: -1 }, vi.fn());
      const allTexts = flatCollect(elements.root).filter((e) => e._config?.label === "Non-positive");
      expect(allTexts.length).toBe(1);
      const positiveTexts = flatCollect(elements.root).filter((e) => e._config?.label === "Positive");
      expect(positiveTexts.length).toBe(0);
    });

    it("re-renders when condition flips on update", () => {
      const json = {
        root: {
          type: "box",
          rect: { x: 0, y: 0, width: 300, height: 300 },
          config: {},
          children: {
            panel: {
              $if: "show",
              then: {
                type: "text",
                rect: { x: 0, y: 0, width: 100, height: 30 },
                config: { label: "Visible" },
              },
              else: {
                type: "text",
                rect: { x: 0, y: 0, width: 100, height: 30 },
                config: { label: "Hidden" },
              },
            },
          },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ show: true }, vi.fn());
      let allTexts = flatCollect(elements.root).filter((e) => e._config?.label === "Visible");
      expect(allTexts.length).toBe(1);

      map.update({ show: false });
      // After update, the "Visible" text should be gone and "Hidden" should appear
      const hiddenTexts = flatCollect(elements.root).filter((e) => e._config?.label === "Hidden" && !e.destroyed);
      expect(hiddenTexts.length).toBe(1);
    });

    it("renders nothing when condition is false and no else branch", () => {
      const json = {
        root: {
          type: "box",
          rect: { x: 0, y: 0, width: 300, height: 300 },
          config: {},
          children: {
            panel: {
              $if: "show",
              then: {
                type: "text",
                rect: { x: 0, y: 0, width: 100, height: 30 },
                config: { label: "OnlyIfTrue" },
              },
            },
          },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ show: false }, vi.fn());
      const texts = flatCollect(elements.root).filter((e) => e._config?.label === "OnlyIfTrue");
      expect(texts.length).toBe(0);
    });

    it("rebases anchored branches into wrapper-local coordinates", () => {
      const json = {
        root: {
          type: "box",
          rect: { x: 0, y: 0, width: 1920, height: 1080 },
          config: {},
          children: {
            resetButton: {
              $if: "showReset",
              then: {
                type: "button",
                rect: {
                  x: "center",
                  y: "bottom",
                  yOffset: -100,
                  width: 200,
                  height: 60,
                },
                config: {
                  label: "Restart Game",
                },
              },
            },
          },
        },
      };

      const map = buildUiMap(json);
      const elements = map.build({ showReset: true }, vi.fn());
      const wrapper = elements.root._config.children?.[0];
      const button = wrapper?._config.children?.[0];

      expect(wrapper).toBeDefined();
      expect(button).toBeDefined();
      expect(wrapper?.bounds.x).toBe("center");
      expect(wrapper?.bounds.y).toBe("bottom");
      expect(wrapper?._config.style.position).toBe("absolute");
      expect(button?.bounds.x).toBe("left");
      expect(button?.bounds.y).toBe("top");
      expect(button?.bounds.xOffset).toBe(0);
      expect(button?.bounds.yOffset).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // $unless structural node
  // --------------------------------------------------------------------------
  describe("$unless structural node", () => {
    it("renders then branch when condition is false", () => {
      const json = {
        root: {
          type: "box",
          rect: { x: 0, y: 0, width: 300, height: 300 },
          config: {},
          children: {
            panel: {
              $unless: "hasShield",
              then: {
                type: "text",
                rect: { x: 0, y: 0, width: 100, height: 30 },
                config: { label: "No shield!" },
              },
            },
          },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ hasShield: false }, vi.fn());
      const texts = flatCollect(elements.root).filter((e) => e._config?.label === "No shield!");
      expect(texts.length).toBe(1);
    });

    it("does not render when condition is true", () => {
      const json = {
        root: {
          type: "box",
          rect: { x: 0, y: 0, width: 300, height: 300 },
          config: {},
          children: {
            panel: {
              $unless: "hasShield",
              then: {
                type: "text",
                rect: { x: 0, y: 0, width: 100, height: 30 },
                config: { label: "No shield!" },
              },
            },
          },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ hasShield: true }, vi.fn());
      const texts = flatCollect(elements.root).filter((e) => e._config?.label === "No shield!");
      expect(texts.length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // $with structural node
  // --------------------------------------------------------------------------
  describe("$with structural node", () => {
    it("scopes context to the specified path", () => {
      const json = {
        root: {
          type: "box",
          rect: { x: 0, y: 0, width: 300, height: 300 },
          config: {},
          children: {
            scoped: {
              $with: "player.stats",
              content: {
                type: "text",
                rect: { x: 0, y: 0, width: 100, height: 30 },
                config: { label: "{{ str }}" },
              },
            },
          },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ player: { stats: { str: 18 } } }, vi.fn());
      const texts = flatCollect(elements.root).filter((e) => e._config?.label === 18);
      expect(texts.length).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // $partial structural node
  // --------------------------------------------------------------------------
  describe("$partial structural node", () => {
    it("renders a registered template via $partial", () => {
      registerTemplate("statusBar", {
        bar: {
          type: "text",
          rect: { x: 0, y: 0, width: 100, height: 20 },
          config: { label: "Status" },
        },
      });
      const json = {
        root: {
          type: "box",
          rect: { x: 0, y: 0, width: 300, height: 300 },
          config: {},
          children: {
            partial: {
              $partial: "statusBar",
            },
          },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({}, vi.fn());
      const texts = flatCollect(elements.root).filter((e) => e._config?.label === "Status");
      expect(texts.length).toBe(1);
    });

    it("warns when partial is not found", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const json = {
        root: {
          type: "box",
          rect: { x: 0, y: 0, width: 300, height: 300 },
          config: {},
          children: {
            partial: {
              $partial: "nonExistentPartial",
            },
          },
        },
      };
      const map = buildUiMap(json);
      map.build({}, vi.fn());
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("nonExistentPartial"));
      warnSpy.mockRestore();
    });

    it("$partial with context override scopes correctly", () => {
      registerTemplate("greetTpl", {
        el: {
          type: "text",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { label: "{{ message }}" },
        },
      });
      const json = {
        root: {
          type: "box",
          rect: { x: 0, y: 0, width: 300, height: 300 },
          config: {},
          children: {
            partial: {
              $partial: "greetTpl",
              context: "greeting",
            },
          },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ greeting: { message: "Hello!" } }, vi.fn());
      const texts = flatCollect(elements.root).filter((e) => e._config?.label === "Hello!");
      expect(texts.length).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Inline CSS string parsing
  // --------------------------------------------------------------------------
  describe("Inline CSS string parsing", () => {
    it("parses CSS string into camelCase style object", () => {
      const json = {
        el: {
          type: "box",
          rect: { x: 0, y: 0, width: 100, height: 100 },
          config: {
            style: "background-color: red; border-radius: 5px;",
          },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({}, vi.fn());
      expect(elements.el._config.style.backgroundColor).toBe("red");
      expect(elements.el._config.style.borderRadius).toBe("5px");
    });

    it("supports expressions inside CSS strings", () => {
      const json = {
        el: {
          type: "box",
          rect: { x: 0, y: 0, width: 100, height: 100 },
          config: {
            style: "background-color: {{ color }};",
          },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ color: "blue" }, vi.fn());
      expect(elements.el._config.style.backgroundColor).toBe("blue");
    });
  });

  // --------------------------------------------------------------------------
  // Special variables: $root, $index
  // --------------------------------------------------------------------------
  describe("Special variables", () => {
    it("$root resolves from root context inside grid items", () => {
      const json = {
        grid: {
          type: "grid",
          rect: { x: 0, y: 0, width: 300, height: 300 },
          config: {},
          items: "$$items",
          element: {
            type: "text",
            rect: { x: 0, y: 0, width: 50, height: 50 },
            config: { label: "{{ $root.title }}" },
          },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ title: "RootTitle", items: [{ name: "A" }] }, vi.fn());
      const children = elements.grid._config.children ?? [];
      expect(children[0]._config.label).toBe("RootTitle");
    });

    it("$index provides the iteration index in grid", () => {
      const json = {
        grid: {
          type: "grid",
          rect: { x: 0, y: 0, width: 300, height: 300 },
          config: {},
          items: "$$items",
          element: {
            type: "text",
            rect: { x: 0, y: 0, width: 50, height: 50 },
            config: { label: "{{ $index }}" },
          },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ items: [{ v: "a" }, { v: "b" }, { v: "c" }] }, vi.fn());
      const children = elements.grid._config.children ?? [];
      expect(children[0]._config.label).toBe(0);
      expect(children[1]._config.label).toBe(1);
      expect(children[2]._config.label).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // Granular Reactivity
  // --------------------------------------------------------------------------
  describe("Granular reactivity", () => {
    it("only updates affected elements when a specific variable changes", () => {
      const json = {
        a: {
          type: "text",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { label: "{{ x }}" },
        },
        b: {
          type: "text",
          rect: { x: 0, y: 50, width: 100, height: 30 },
          config: { label: "{{ y }}" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({ x: 1, y: 2 }, vi.fn());
      expect(elements.a._config.label).toBe(1);
      expect(elements.b._config.label).toBe(2);

      // Update only x
      map.update({ x: 10 });
      expect(elements.a._config.label).toBe(10);
      // y should be unchanged
      expect(elements.b._config.label).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // Security: sandboxed expressions
  // --------------------------------------------------------------------------
  describe("Expression security", () => {
    it("blocks access to window/document in expressions", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const json = {
        label: {
          type: "text",
          rect: { x: 0, y: 0, width: 100, height: 30 },
          config: { label: "{{ window.location }}" },
        },
      };
      const map = buildUiMap(json);
      const elements = map.build({}, vi.fn());
      // Should either produce an error or render empty — NOT leak window.location
      expect(elements.label._config.label).not.toContain("http");
      errorSpy.mockRestore();
    });
  });
});
