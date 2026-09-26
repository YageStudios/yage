# Migrating Sky Harbor / YAGE to UI Final

This patch introduces a new retained runtime. It does not reinterpret old JSON5/HBS layouts or automatically rewrite game screens. Keep legacy APIs for screens that have not yet migrated; do not keep both implementations active for the same screen.

## 1. Apply and validate

From the repository root, with local changes committed or otherwise preserved:

```sh
git apply --check /path/to/UI_FINAL.patch
git apply /path/to/UI_FINAL.patch
npm run test:ui-final
# Set this to an installed Chromium/Chrome executable where auto-discovery is unavailable.
UI_FINAL_BROWSER=/path/to/chromium npm run test:ui-final:browser
npm run demo:ui-final:offline
```

Open `.ui-final-build/ui-final-demo.html` for the standalone equipment showcase. For the normal examples application, run `npm run examples` and select the `ui-final` example route. The standalone build needs TypeScript but not the rest of the engine's graphics/physics dependencies. The browser suite needs Playwright Core and a Chromium executable; it does not download a browser.

In a normal installed development environment, also run the original `npm run typecheck`, engine tests and `npm run build`. See `VALIDATION.md` for the distinction between checks performed for this delivery and full-engine checks that still require the repository's dependencies.

## 2. Create a scene-owned UI

```ts
import { Scene } from "yage/game/Scene";
import { Model, Column, Row, Text, Button, Progress, CommandQueue,
  connectInput } from "yage/ui/final";
import type { InputManager } from "yage/inputs/InputManager";

export class EquipmentScene extends Scene {
  static sceneName = "equipment";
  readonly commands = new CommandQueue();

  open(input: InputManager) {
    const ui = this.mountUIFinal(null);
    const state = new Model({ health: 80, maxHealth: 100, credits: 2400 });
    ui.scope.add(() => state.dispose());

    ui.mount(Column({ style: { padding: 24, gap: 16 } },
      Text("Equipment", { role: "heading", attrs: { "aria-level": 1 } }),
      Progress({ label: "Health", value: state.select<number>("health"),
        max: state.select<number>("maxHealth") }),
      Row({ style: { gap: 12 } },
        Text(() => `${state.get<number>("credits")} credits`),
        Button({ id: "equip", on: {
          activate: event => { this.commands.enqueue(event.player,
            "inventory:equip", { itemId: "aster-rifle" }); },
        } }, "Equip")
      )
    ));
    connectInput(input, ui, { active: () => true });
    ui.focus.focus("equip");
    return state;
  }
}
```

`mountUIFinal` starts presentation ticking and owns disposal. Do not add a second RAF loop for that root. Pass the actual game's InputManager; Final does not create another input manager or assume a singleton. An always-active bridge is appropriate only when this scene really owns the menu. A persistent HUD should use an explicit menu-open predicate.

The example exposes a queue, not an invented engine-network method. At your existing authoritative gameplay input point, drain the queue and validate/apply commands using your game systems. Keep the model, DOM, scopes and native events out of deterministic state and replay snapshots.

## 3. Replace context updates with explicit mutation

Old code commonly rebuilds a context object and calls a mapping update method. In Final, publish the changed presentation value:

```ts
state.set("health", 67);
state.patch({ health: 67, credits: 2500 });
```

The model updates only registered affected paths. Do not mutate `state.snapshot()` or a signal's array in place. Prefer a small projection from gameplay rather than mirroring the entire ECS world into the UI.

A binding must remain a live source:

```ts
Text(() => `${state.get<number>("credits")} credits`); // live
Text(`${state.get<number>("credits")} credits`);       // deliberate one-time literal
```

Computeds created outside a mounted/effect scope should be explicitly attached to `ui.scope`. Signals do not automatically make unrelated function calls reactive. Effects with side effects should have a block body and return only an optional cleanup function.

## 4. Convert layout instead of translating rectangles mechanically

| Legacy concept | Final equivalent |
|---|---|
| Mutable `Box` subclass | `Panel`, `Row`, `Column` or `Grid` descriptor |
| `new Text(rect, { label })` | `Text(valueSource, props)` |
| Global `UIService.addToUI` | `ui.mount` or scene-owned `mountUIFinal` |
| Expression string | Safe model path, computed or registered formatter |
| Full context update/deep diff | `signal.set`, `Model.set` or batched projection |
| Full inventory widget tree | `virtualList` with stable domain keys |
| Global selection/current widget | `ui.focus` with explicit player ownership |
| Unowned async callback | `Resource` owned by the screen scope |
| Direct gameplay mutation in click | Immutable command consumed by gameplay |
| Hand-maintained cleanup | Scope-owned listeners/effects/resources |

Use CSS flow/grid for responsive sections. Use absolute offsets only for intentional anchors or overlays. Preserve a single layout authority. Do not run old `ui/layout` measurement on the same Final tree.

In user stylesheets, load game styles after base styles or use appropriate scoped specificity. Avoid broad global `button`, `input` or `div` selectors that also affect old screens. A full-screen HUD root is pointer-transparent: add `interactive: true` only to surfaces intended to intercept pointer input.

## 5. Convert lists with stable identity

```ts
import { signal, virtualList, Button, Text } from "yage/ui/final";
const items = signal<readonly Item[]>(initialItems);
ui.mount(virtualList({
  items,
  itemKey: item => item.id,
  rowHeight: 56,
  height: 448,
  overscan: 2,
  props: { label: "Equipment inventory" },
  render: item => Button({ on: {
    activate: event => { commands.enqueue(event.player, "inspect", {
      id: item.peek().id,
    }); },
  } }, Text(() => item.get().name)),
}));
```

Do not use array index as identity for sortable data. Do not cache `item.get()` once and close over it forever. Replacing the object for the same ID should update the retained row, not continue to equip the old item.

Declared row height must hold across localized content and user text scaling. Variable-height rows are not implemented; use a layout that meets the fixed-height contract or a nonvirtual bounded collection until a measured-size virtualizer is implemented.

## 6. Use versioned assets and registered actions

The delivered `assets/ui/final/status.json5` uses the existing loader pipeline:

```ts
import { UiLoader } from "yage/loader/UiLoader";
import { Model, mountDocument } from "yage/ui/final";

const loader = UiLoader.getInstance();
const document = await loader.loadFinal("status", "final/status.json5");
const model = new Model({
  player: { name: "Pathfinder", health: 80, maxHealth: 100, credits: 2400 },
  connection: { pending: false },
});
ui.scope.add(() => model.dispose());
const handle = mountDocument(ui, document, {
  model,
  formatters: { credits: value => `${Number(value).toLocaleString()} CR` },
  actions: { openInventory: event => { commands.enqueue(event.player, "inventory:open"); } },
});
```

The application supplies formatter/action names. Assets cannot execute statements or call arbitrary object methods. Use a path binding for values, not `${...}` expression strings. For asset inputs, an `input` action receives `event.value`; explicitly update the model from that action.

`loadFinal` preserves the existing override and `$ref` resolver. It stores a separate validated library entry and never invokes the legacy template evaluator. `getFinal` returns the last validated document; failed validation does not overwrite it.

## 7. Hot reload through Vite, not gameplay polling

A source-first Vite application can import the asset as raw text. Adapt the import location to its own source tree:

```ts
import rawAsset from "./status.json5?raw";
loader.registerOverride("final/status.json5", rawAsset);
const initial = await loader.loadFinal("status", "final/status.json5");
const screen = mountDocument(ui, initial, { model, actions, formatters });
let reloadGeneration = 0;

if (import.meta.hot) {
  import.meta.hot.accept("./status.json5?raw", async next => {
    if (!next) return;
    const generation = ++reloadGeneration;
    try {
      loader.registerOverride("final/status.json5", next.default);
      const parsed = await loader.loadFinal("status", "final/status.json5");
      if (generation === reloadGeneration && !ui.scope.disposed) screen.reload(parsed);
    } catch (error) {
      ui.report(error);
    }
  });
  import.meta.hot.dispose(() => { reloadGeneration++; ui.dispose(); });
}
```

The generation check prevents a slower earlier reload from mounting over a newer one. Validation failures retain the running view. Exceptions inside trusted application formatters/refs during commit are not rollback-safe; fix those callbacks rather than relying on validation transactions to reverse arbitrary side effects.

## 8. Modal and input ownership

A true modal must use `ui.openModal`, not a high-z-index panel marked `aria-modal`. The native dialog owns the document's top layer and restores focus. Give it a meaningful label and visible dismiss action. Do not leave an old full-screen input capture overlay active above a migrated menu.

Connect the engine bridge once per owning root. Remap controller devices using `playerForDevice` according to the actual local-user system. An empty `players` array denies all players; undefined allows all. Player zero owns native keyboard/caret; other players have logical focus.

Do not “fix input leakage” by stopping every keyup. Releases must clear gameplay keys that were held before the screen opened. Final's bridge and DOM policy intentionally preserve those releases.

## 9. Remove the migrated legacy path

Once the screen is migrated, remove its old `UiMap`/`UiMapNext` construction, context-update call, old `UIService` registration and redundant input listener. Keep legacy infrastructure for other unconverted screens. Test opening/closing the new screen over existing gameplay, nested confirmations, changing scenes during a pending resource, and holding a direction while opening/closing the menu.

The release checklist is complete engine build, original tests, new suites, physical controller mapping, target-browser/device soak, localization/font coverage, accessibility review and actual UI performance captures. The patch's tests are evidence for its implemented contracts, not a substitute for these game-specific checks.
