# UI Final: stateful HTML components and world surfaces

## Scope

This extension is built against the supplied **integrated** Sky Harbor engine archive, not the earlier UI Final prototype. It keeps the existing scene ownership, scheduler, asset compiler, input bridge, normal widgets, and package entry point. There is no second UI runtime, iframe, independent binding system, or new production dependency.

The two additions are independent:

- `defineHTMLComponent` turns project-authored HTML/CSS plus a small TypeScript adapter into a retained UI Final component.
- `WorldSurface` projects any retained UI Final content onto an affine surface. The included airport uses a true 30-degree isometric wall.

The airport is an interactive presentation demo, not a complete idle-game simulation. Its terminal is procedural SVG and its billboard is live DOM, both positioned with the same projection math. Its balance, passenger count, and gate capacity are illustrative values.

## 1. Author a custom component

```ts
import { defineHTMLComponent, signal, UIFinal } from "yage/ui/final";

interface GateState {
  name: string;
  passengers: number;
}
interface GateEvents {
  board: { gate: string };
}

const GatePanel = defineHTMLComponent<GateState, GateEvents>({
  name: "airport/gate-panel",
  template: `
    <section>
      <h2 id="name"></h2>
      <p><output id="count"></output> passengers waiting</p>
      <button id="board" type="button">Start boarding</button>
    </section>
  `,
  styles: `
    :host { display: block; color: #eee; }
    section { padding: 20px; background: #17242a; }
    button { margin-top: 12px; }
  `,
  setup(ctx) {
    const name = ctx.query("#name");
    const count = ctx.query("#count");
    ctx.bind(() => ctx.state.get().name, value => {
      name.textContent = value;
    });
    ctx.bind(() => ctx.state.get().passengers, value => {
      count.textContent = String(value);
    });
    ctx.listen(ctx.query("#board"), "click", () => {
      ctx.emit("board", { gate: ctx.state.peek().name });
    });
  },
});

const gate = signal<GateState>({ name: "A12", passengers: 26 });
const ui = new UIFinal();
ui.mount(GatePanel({
  id: "gate-a12",
  state: gate,
  events: { board: detail => console.log("Boarding requested", detail.gate) },
}));
gate.update(previous => ({ ...previous, passengers: 31 }));
// At the end of this screen: ui.dispose().
```

`GatePanel(...)` returns a `Child`, just like `Button(...)`. It works in normal containers, conditional regions, keyed lists, virtual lists, modal content, and world surfaces. An application signal, computed value, getter, or static state value can be supplied. The component receives a read-only `Readable<S>`, not ownership of the game's state.

Use immutable state updates. Mutating a field inside the object returned by `peek()` does not notify the reactive graph. The default standalone scheduler flushes on a microtask; a scene-owned manual runtime flushes through its existing presentation ticker. `ui.flush()` is available for deterministic tests and explicit synchronization.

### Retention contract

The definition object and key identify a mounted component. Changing its state, host properties, or event callbacks patches the existing instance. Setup runs once, and no HTML is reparsed for a normal state update. Changing the definition identity or key remounts it. Define components at module scope, not inside a repeatedly evaluated binding.

Templates are cached per definition and browser `Document`, then cloned for each instance. A runtime using an application-owned HTML policy parses through that policy instead of reusing a cache from another policy. An open shadow root gives each instance its own IDs and stylesheet scope. Inherited typography and CSS custom properties remain available for theming. Engine defaults occupy a lower-priority CSS layer inside the island, so component styles can override ordinary buttons without fighting engine selector specificity.

UI Final owns the host element. The component owns its shadow contents. Do not replace the host, attach another shadow root, or let a third-party renderer modify UI Final's surrounding child ranges.

## 2. Setup context and lifecycle

| API | Contract |
| --- | --- |
| `host`, `root`, `document` | The retained host, open `ShadowRoot`, and its owner document. |
| `state` | Read-only reactive state. `get()` tracks; `peek()` does not. |
| `query<T>(selector)` | Instance-local lookup; a missing reference throws `UIF_HTML_SELECTOR`. |
| `bind(source, update, equals?)` | Immediate initial update, then scheduler-owned changes with selector equality. The update callback is untracked. Returns an early-disposal function. |
| `effect(fn)` | An owned reactive effect, optionally returning cleanup per execution. |
| `listen(target, type, callback, options?)` | Owned native or custom DOM listener. Native callbacks are checked against the runtime's input ownership. |
| `emit(name, detail)` | Calls the latest typed component-event handler. An emission after disposal is ignored. |
| `onFrame(callback)` | Registers with `ui.frame(dtMs)`, not a private RAF. Returns cancellation. Remove idle work. |
| `onCleanup(callback)` | Registers cleanup and returns an idempotent early-disposal function. |
| `abortSignal` | Aborted when the component is removed; useful for fetches and external work. |
| `reducedMotion` | The same read-only preference used by the runtime. |
| `mount(target, child)` | Mounts an ordinary UI Final child into an owned interior element. Returns an updatable, disposable view. |
| `refreshFocus()` | Immediately rescans native controls after structural changes. |

Everything registered through this context belongs to the component scope. Removing an island stops its subscriptions, listeners, registered frame callbacks, focus entries, observers, nested UI views, and abortable operations. Setup can also return cleanup. A cleanup failure does not prevent the scope from attempting its remaining cleanup. Attempts to register a resource after disposal clean up that resource and report a disposed-scope error.

A third-party widget must still expose its own destruction function. Register it through `onCleanup`; UI Final cannot automatically discover private global timers or subscriptions created by arbitrary library code. For asynchronous work, use `abortSignal`, verify that the scope is still alive, and avoid updating detached DOM. A component listener throwing is reported through the runtime's normal error path. Author setup failures are cleaned up and rethrown; arbitrary user code is not transactionally reversible.

### Embedding normal UI inside HTML

```ts
setup(ctx) {
  ctx.mount(ctx.query(".controls"), Button({
    on: { activate: () => ctx.emit("confirm", { accepted: true }) },
  }, "Confirm"));
}
```

Import `Button` and declare the corresponding event type. Use this path for UI Final's existing two-way `TextInput` binding when preserving its IME behavior is preferable to writing a native-input adapter. With a directly authored input, use native input/composition events; do not assign `input.value` on unrelated state updates or interrupt composition.

## 3. Bring in an existing HTML design

`sky-harbor-splitflap.html` remains unchanged in this patch. Its split-cell geometry, perspective/rotation transform, falling flap, landing bounce, character advancement, and shading were adapted in `examples/ui-final-airport/split-flap.ts`. The page's demo controls, global IDs, global state, and per-cell callbacks were not executed inside the game.

For another project-authored HTML asset:

```ts
import source from "./artist-panel.html?raw"; // Vite raw asset import
import { extractHTMLComponent, defineHTMLComponent } from "yage/ui/final";

const fragment = extractHTMLComponent(source, ".artist-panel");
const ArtistPanel = defineHTMLComponent<GateState>({
  name: "airport/artist-panel",
  template: fragment.template,
  styles: fragment.styles,
  setup(ctx) {
    ctx.bind(() => ctx.state.get().name, value => {
      ctx.query(".gate-name").textContent = value;
    });
  },
});
```

Extraction requires a browser `Document`. It selects the requested fragment and returns stylesheet text without executing surrounding scripts. Selected active markup is rejected. It is not a whole-web-page importer and does not translate a page's JavaScript into a reactive component.

Adapt `body`, `html`, and `:root` CSS selectors to `:host` or a local wrapper. Remove fixed viewport sizing and page-only styling. Replace `document.getElementById` with `ctx.query`, port imperative startup into `setup`, expose dynamic data as state, and expose game interactions as typed events. The host `ref` refers to the normal UI host; use `setup` for access to initialized shadow contents.

Resolve image/font URLs through your application's asset pipeline. A raw HTML string's relative URLs resolve in the embedding document, not relative to the original source file. External stylesheets are not fetched by extraction; bundle them as component CSS. The delivered airport is entirely local and uses system fonts, not a copied font file.

### Trust boundary

These are **trusted project components**, not a sandbox for player-supplied HTML. Templates reject scripts, inline handlers, embedded browsing contexts, document metadata, reserved engine attributes, and hazardous URL schemes before connection. This is a guardrail, not an HTML/CSS sanitizer. Component setup executes with application privileges. Authored CSS can load resources allowed by the application's policy; custom elements can run registered application code. Do not interpolate untrusted data into templates or styles; bind text through `textContent`.

`UIFinalOptions.htmlPolicy` accepts an application-owned `createHTML` policy, including actual `TrustedHTML` objects. No permissive Trusted Types policy is created automatically. `styleNonce` is propagated to engine-owned shadow styles; your application must separately allow any inline styles or resources it uses. The offline demonstration permits inline script/style and disallows external resource loads; it is not an example of a nonce-only production CSP.

## 4. Input, focus, and accessibility

Native buttons, inputs, text areas, selects, links, and opted-in focusable elements are registered with UI Final. Their stable focus IDs are `hostId/localId`, using `data-focus`, an element ID, or a generated identity. For example:

```ts
ui.focus.focus("departure-board/flight-sh218");
ui.focus.navigate("accept");
```

The internal control is not added to `ui.element()`'s host-ID map. Use `ui.element("departure-board")!.shadowRoot` or `ctx.query` to retrieve it.

Composed-tree event targeting preserves the actual inner control rather than treating every event as a click on the host. Controller accept produces the native button/checkbox behavior once. Keyboard editing, caret movement, IME handling, pointer capture, inherited disabled/player restrictions, modal ownership, and scoped focus work across the shadow boundary. Key releases needed to clear held gameplay inputs retain the existing input-bridge behavior. Keyed host moves restore deep native focus. Virtual navigation realizes offscreen HTML controls before moving focus.

A scoped MutationObserver discovers native controls added or removed later, without rescanning on text-only glyph changes. Call `refreshFocus()` after synchronous structural changes that must be navigable immediately. Give controls stable local identifiers and avoid duplicates. A closed third-party shadow root's internals are not automatically discoverable; expose an appropriate host control or adapt that widget explicitly.

The split-flap board has semantic flight-row buttons with complete labels and selection state. The decorative animated character halves are hidden from assistive technology rather than announcing every intermediate glyph. This is behavior coverage, not a completed screen-reader certification. At small world scales, physical rows are too small for reliable finger targeting; the demo provides a front inspection view. The mobile test selects a flight through that view.

## 5. Register HTML components in UI assets

The existing `ui-final/1` schema gains a registered component node:

```json
{
  "schema": "ui-final/1",
  "root": {
    "component": "DepartureBoard",
    "state": { "$bind": "airport.board" },
    "props": { "id": "departure-board" },
    "events": { "selectFlight": "selectAirportFlight" }
  }
}
```

```ts
mountDocument(ui, asset, {
  model,
  components: { DepartureBoard: SplitFlapBillboard },
  componentActions: {
    selectAirportFlight: ({ id }) => commands.enqueue(0, "select-flight", { id }),
  },
});
```

`SplitFlapBillboard` is the included example module, not a game-specific engine export. `componentActions` receive component data; existing `actions` keep receiving `UIEvent` objects. Component code is registered in TypeScript, never evaluated from JSON. Registration/action references are checked before mounting or reload, including inactive branches. Normal host-property and repeated-ID restrictions apply. Static state is literal JSON; a top-level `$bind` selects the whole state object. Nested `$bind` objects inside literal state are not automatically expanded.

Parser/reference failures preserve the current document. A throwing component setup or other arbitrary application code is not a rollback transaction. Registry payloads cross a dynamically typed asset boundary: validate gameplay intent before applying authoritative changes.

## 6. Put the component on a wall

```ts
import { signal, WorldSurface, isometricSurface } from "yage/ui/final";
import {
  SplitFlapBillboard, BILLBOARD_WIDTH, BILLBOARD_HEIGHT,
  type BillboardState,
} from "./split-flap";

const board = signal<BillboardState>({
  title: "SKY HARBOR", message: "GATE A12 OPEN", powered: true,
  flights: [{
    id: "sh218", flight: "SH218", destination: "SEOUL",
    gate: "A12", status: "BOARDING",
  }],
});
const camera = signal({ origin: { x: 585, y: 225 }, zoom: 1 });

// scene is your existing Scene. It owns the presentation clock and disposal.
scene.mountUIFinal(WorldSurface({
  pose: () => isometricSurface({
    position: { x: 48, y: 1, z: 180 },
    width: BILLBOARD_WIDTH,
    height: BILLBOARD_HEIGHT,
    worldUnitsPerPixel: 0.535,
    plane: "wall-x",
    camera: camera.get(),
  }),
}, SplitFlapBillboard({
  id: "departure-board", state: board,
  events: { selectFlight: ({ id }) => commands.enqueue(0, "select-flight", { id }) },
})));

board.update(previous => ({ ...previous, message: "FINAL CALL FOR SEOUL" }));
```

For an already-mounted screen, compose the surface into that screen's tree; calling `mountUIFinal` again reconciles/replaces its content, rather than appending a second independent root. Use the existing application's overlay host and scene lifecycle.

`SurfacePose` provides the local width/height, projected origin, and projected displacement across each complete axis. The generated affine transform is `matrix(a,b,c,d,e,f)`, where `a,b = xAxis/width`, `c,d = yAxis/height`, and `e,f = origin`. Coordinates are CSS pixels in the positioned parent. Do not multiply them again by device pixel ratio. `surfaceToLocal` inverts this transform for engine-side coordinate conversion; normal browser hit-testing already handles the transformed DOM. Convert viewport coordinates into the surface parent's coordinate system before calling that helper.

`projectIsometric` uses `screenX = originX + (x-y)*sqrt(3)/2*zoom` and `screenY = originY + ((x+y)/2-z)*zoom`. `wall-x`, `wall-y`, and `floor` orientations are supported. Supply a custom `SurfacePose` to use another affine camera mapping. Projected axes must have nonzero area. Visibility and z-index are reactive pose properties; hide or remove a surface when gameplay requires it.

**Rendering boundary:** this is a DOM world overlay, not an HTML-to-Pixi texture, GPU mesh, or perspective camera renderer. It does not participate in Pixi's depth sorting, lighting, canvas capture, or a 3D depth buffer. The game must supply occlusion/visibility and overlay ordering. The airport draws foreground objects away from the board. Do not infer general 3D occlusion from that scene.

## 7. Split-flap implementation and verification

The sample exposes title, message, up to four keyed flights, selected flight ID, power, and milliseconds per flap. Its native dimensions are 940 × 316 CSS pixels. Fields contain 10 title characters, 24 announcement characters, and 5/12/3/9 characters per flight/destination/gate/status. Longer display strings are truncated to those fields; semantic row labels retain the supplied full values. Applications needing other board sizes should extend the component layout and state validation together.

Initial mount is settled. A changed field animates its retained cells; unchanged fields do not restart. Retargeting finishes the current physical flap and proceeds to the newest destination. One clock owns all active cells of a board. It unregisters when idle, on reduced motion, on power-off, or disposal. Reduced motion and offline updates snap to the latest target without pending animation work. Native row identity and focus survive flight reordering.

The board exposes `data-animated-cells`, `data-flips`, and `data-state-commits` for inspection. `ui.frameTaskCount` includes active HTML clocks and other runtime frame tasks. Existing renderer statistics count renderer-owned nodes/writes, not every DOM mutation inside a custom component; do not treat them as a complete GPU or layout profiler.

Run the demo and validation commands in `examples/ui-final-airport/README.md`. Detailed measured outcomes and explicit verification limits are in `HTML_COMPONENTS_VALIDATION.md`.

### Browser references

These references explain browser mechanics used by the implementation; they are not performance guarantees:

- MDN, `Event.composedPath`: https://developer.mozilla.org/en-US/docs/Web/API/Event/composedPath
- MDN, `Event.composed`: https://developer.mozilla.org/en-US/docs/Web/API/Event/composed
- MDN, `ShadowRoot.innerHTML` and injection concerns: https://developer.mozilla.org/en-US/docs/Web/API/ShadowRoot/innerHTML
- MDN, `matrix3d`: https://developer.mozilla.org/en-US/docs/Web/CSS/transform-function/matrix3d
