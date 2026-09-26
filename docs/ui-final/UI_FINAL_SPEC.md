# UI FINAL — Engine coding specification

**Target:** the supplied Sky Harbor / YAGE TypeScript engine.

**Contract:** `ui-final/1`, browser retained-mode implementation.

**Preferred import:** `yage/ui/final`.

**Delivery:** implementation, engine adapters, declarative asset, runnable showcase, regression tests, migration guide and patch.

**Status language:** “implemented” describes code in this patch; “release gate” describes work that must be verified in the shipping game. Neither the name FINAL nor the showcase is a claim of platform certification.

---

## 1. The engineering decision

UI Final is a **scene-owned, retained, fine-grained reactive UI runtime**. A screen describes its structure once. Changing a signal schedules the bindings that read that signal; it does not reconstruct the screen, deep-compare a gameplay model or rerun a template expression on every frame. Structural changes use explicit dynamic regions and stable-key collections. The browser owns CSS layout, text shaping, native editing, clipping and compositing. UI Final owns state dependencies, retained identity, lifecycle, event policy, local-player navigation, modal ownership and the game-command boundary.

This is a replacement authoring/runtime path, not another facade over `UIElement`, `UiMap` or `UiMapNext`. It does not instantiate those classes. Existing screens remain operational while they are migrated. The patch does not claim that every pre-existing game screen has already been converted.

The uploaded research calls for dirty-driven bindings, retained identity, navigation, virtualization, explicit lifetimes, authoring assets and separation of presentation from simulation. Those requirements are adopted. Its native-C++ suggestions—slab allocators, GPU command snapshots, custom HarfBuzz/FreeType integration, Vulkan/DX render devices—are **not silently relabeled as implemented browser features**. This repository is TypeScript/Pixi with DOM UI, so introducing an independent native layout/text/render stack would be a separate product and deployment project.

The central rule is: **one source of gameplay truth, one presentation model, one retained view, one layout authority.**

### 1.1 Required product characteristics

A developer must be able to build a HUD, equipment screen, settings panel, confirmation flow or controller-driven menu without subclassing an engine widget or maintaining parallel absolute-position and CSS layouts. A designer must be able to change versioned assets and styles without embedding executable expressions. A player must retain predictable input focus when rows move, asynchronous data arrives or a dialog closes. A screen must release listeners, animations, resource requests, DOM and presentation ticking when its scene ends.

The production ambition is expressive game UI, not a debug GUI. That ambition requires shipping-game art, interaction design, accessibility review, performance captures and target-device validation beyond a runtime implementation. This specification identifies those gates rather than substituting the adjective “AAA” for evidence.

### 1.2 Explicit non-goals of this delivery

There is no native console renderer, Pixi-rendered widget backend, 3D diegetic surface, custom GPU font atlas, vector tessellator, render-thread snapshot protocol, dedicated visual designer, Figma importer or distributed editor protocol. There is no variable-height virtual list or virtual two-dimensional inventory grid. There is no general HTML parser, Handlebars expression interpreter or arbitrary-JavaScript binding language. There is no automatic conversion of old `.hbs` assets.

These are architectural boundaries, not hidden placeholder implementations. The delivered runtime is useful independently of them and is tested as such.

## 2. Repository-specific diagnosis

The supplied engine already renders game graphics through Pixi and UI through the DOM. The problems to solve are therefore primarily ownership, invalidation, duplicated authoring paths, input policy and lifecycle—not a missing third graphics API.

| Existing location | Observed responsibility/problem | UI Final treatment |
|---|---|---|
| `engine/ui/UIElement.ts` | Large mutable widget base; configuration changes trigger widget updates | Small retained blocks and independent property bindings |
| `engine/ui/UIService.ts` | Global UI service, mounting and input capture | Independent runtime roots owned by scenes |
| `engine/ui/UiMap.ts` | Large mapping system, context updates and generated expression functions | Compiled path selectors and registered actions; no evaluator in Final |
| `engine/ui/UiMapNext.ts` | A second large mapping/template path over shared legacy widgets | One descriptor and asset contract for new screens |
| `engine/ui/layout/` | Engine layout machinery coexists with browser layout | CSS is the only layout solver in the delivered backend |
| `engine/loader/UiLoader.ts` | Existing override, bundled-asset and `$ref` loading | Separate `loadFinal` / `getFinal` validation path |
| `engine/game/Scene.ts` | Legacy `ui` proxy and global cleanup | Additional scene-owned `uiFinal`, independently disposed |
| `engine/inputs/InputManager.ts` | Newest listener can preempt previous listeners | Optional priority; equal-priority legacy ordering preserved |

The old evaluators are not deleted from the repository because unconverted games still depend on them. The security claim is **no executable asset expressions in UI Final**, not “the entire legacy engine has been made eval-free.”

## 3. Module boundaries and dependency direction

```
Gameplay snapshot / domain events                 Input devices
                |                                     |
                v                                     v
          Model / signals                       InputManager bridge
                |                                     |
                v                                     v
       computed dependency graph              local-player focus
                |                                     |
                +------------+------------------------+
                             v
                 prioritized reactive scheduler
                             |
                structural regions -> property effects
                             |
                             v
          retained DOM blocks + native semantic controls
                             |
               browser CSS / text / compositor

UI actions -> immutable CommandQueue -> authoritative game input step
```

The view must never read live simulation internals through ad hoc per-frame selectors that happen to deep-compare equal. Gameplay publishes presentation mutations intentionally. UI submits intent; gameplay validates and applies it at the authoritative boundary.

| Module | Public responsibilities | Forbidden responsibilities |
|---|---|---|
| `reactive.ts` | Signals, computeds, effects, scope, batching, scheduler | DOM, engine singletons, networking |
| `model.ts` | Immutable path updates and indexed selectors | Reflection expression evaluation, polling game state |
| `nodes.ts` | Descriptor types and component functions | Mounting globals, owning simulation |
| `render.ts` | Retained blocks, properties, keyed lists, virtualization | Gameplay mutation, browser layout replacement |
| `focus.ts` | Eligibility, spatial navigation, per-player focus, modal focus | Hardware discovery or gamepad polling |
| `runtime.ts` | Root, lifecycle, theme, dialogs, frame tasks, inspection | Fixed simulation stepping |
| `document.ts` | Asset validation, binding compilation, reload | Arbitrary script execution or network loading |
| `services.ts` | Resources, catalogs and immutable commands | Owning network authority |
| `input.ts` | Existing InputManager adapter | A competing global input singleton |
| `theme.ts` | Scoped base styles and tokens | Global body resets or game art |

The pure core can run in Node. The renderer requires a browser `Document`. Importing the core is not equivalent to creating a UI or mutating the document. Final adds no new third-party runtime dependency.

## 4. Runtime ownership and frame lifecycle

### 4.1 Creating a standalone root

```ts
import { UIFinal, signal, Column, Text, Button } from "yage/ui/final";

const ui = new UIFinal({ host: document.body, scheduling: "manual" });
const score = signal(0);
ui.mount(Column({ style: { padding: 24, gap: 12 } },
  Text(() => `Score: ${score.get()}`),
  Button({ on: { activate: () => { score.update(n => n + 1); } } }, "Add point")
));
// Called once per presentation frame by the host:
ui.frame(deltaMilliseconds);
// When the owning screen ends:
ui.dispose();
```

`mount` and `update` reconcile into the same owned content root. The supplied host is never cleared. A runtime creates its own root, content element, scoped stylesheet and live region. `placement: "overlay"` is the default absolute layer; its positioning context must be established by the host. `placement: "inline"` participates in normal document flow. The default z-index is 20, configurable by the host.

The root is pointer-transparent by default. Native controls, scrolling containers and explicitly `interactive` elements receive pointer input. An empty HUD panel therefore does not automatically swallow gameplay clicks across the entire canvas. A full-screen menu that needs to block clicks must deliberately expose a hit-testing surface or use a modal.

### 4.2 Engine scene integration

`Scene.mountUIFinal(content, options)` lazily creates one runtime. It defaults to manual scheduling and starts an engine `Ticker("continuous")` for presentation. Subsequent calls reconcile into that runtime; construction options apply only to the first call. Disposing the runtime stops that ticker and clears the scene's reference. Disposing the scene disposes Final before continuing existing Pixi/legacy cleanup, including when application cleanup throws.

A dedicated presentation ticker is deliberate. The engine's fixed timestep ticker may execute multiple simulation steps after a delayed frame. Navigation repeat and UI animations must not accidentally advance once per simulation catch-up step. No changes to deterministic simulation serialization are required.

For several UI roots in one application, either let their owning scenes manage presentation or create one application-owned scheduler/ticker policy. Do not call `frame` twice for a scene-owned runtime. Manually-created roots do not automatically allocate an RAF loop.

### 4.3 Presentation sequence

Within a normal presentation frame: run owned frame tasks with a finite nonnegative millisecond delta, capped at 250 ms; flush pending structural effects; flush property effects; run application effects; repair invalid focus after commits. The scheduler always chooses the highest-priority pending work. A lower-priority effect that schedules structural work causes that structural work to run before remaining lower-priority effects.

Browser style calculation, layout and painting occur according to browser scheduling. Directional navigation explicitly flushes UI mutations before reading geometry. UI Final does not expose fake “GPU submit time” from a JavaScript mutation counter.

An idle frame performs no binding evaluations or DOM property/text writes when there are no pending effects or application frame tasks that mutate state. It still has small runtime overhead for calling frame/flush/focus repair. This is not a claim of zero CPU execution or zero browser work.

### 4.4 Lifetime contract

Every mounted block belongs to a `Scope`. A scope stores cleanup functions and disposes them in reverse registration order. Disposal is idempotent. All cleanup functions run even when one throws; errors are aggregated. A disposed scope rejects new resources. Child scopes unregister from their parent when independently disposed.

Resources created inside `Scope.run` or an effect belong to the current scope. Effects receive a fresh per-run scope; the preceding run's resources are disposed before the next run. Detached ownership is explicit with `new Scope(null)`. `onCleanup` outside a scope is an error, not an ignored callback.

Signals are ordinary state cells. Computeds and effects hold subscriptions and need ownership. Pass `ui.scope` when creating long-lived computeds outside a mounted component scope. Plain component functions are evaluated by application code; merely calling `Column(...)` does not magically create a resource lifetime.

## 5. Reactive graph contract

### 5.1 Signals and value sources

`signal<T>(initial, equality?)` creates a mutable value. `get()` reads and tracks; `peek()` reads without dependency registration. `set(next)` returns whether the value changed, using `Object.is` by default. `update(fn)` derives a new value from the current value. Equal writes do not notify subscribers.

A `Value<T>` is a literal, a `Readable<T>` or a zero-argument function. Render properties evaluate their own sources inside property effects. Prefer `Text(() => playerName.get())` over `Text(playerName.get())`: the latter passes the current literal and intentionally has no live binding. Function-valued gameplay data should be wrapped rather than confused with a value-source function.

Do not mutate a signal's object or array in place. Write a new identity or use `Model.set`. UI Final does not install deep proxies on arbitrary gameplay objects or intercept every JavaScript mutation.

### 5.2 Computeds

A computed is lazy and cached. It records only dependencies read during its latest evaluation. Conditional dependencies detach when the branch changes. Reading a computed refreshes dirty upstream values before returning its result. Its revision advances only when the result changes by the selected equality function, except that failed evaluations advance an error revision to permit recovery.

Downstream effects check dependency versions. An upstream signal mutation that leaves a computed result equal can therefore schedule a candidate job but skip the effect body. This is stronger than blindly rerunning all subscribers, but is not a promise that invalidation propagation costs nothing.

Computeds must be pure: writing a signal while evaluating a computed throws `UIF_COMPUTED_WRITE`. Recursive computed evaluation throws `UIF_REACTIVE_CYCLE`. A failed computed evaluation is cached as a failure; a later dependency mutation can invalidate it and retry. An effect that has already subscribed can recover when the dependency becomes valid again. Initial effect creation that throws is disposed and fails to its caller.

### 5.3 Effects and batching

`effect(fn, { scheduler, scope, priority, name })` runs once immediately to collect dependencies. Later mutations enqueue it rather than executing it recursively inside a setter. The effect may return a cleanup function. Application callbacks should use a block body when a method such as `Array.push` would otherwise return a number.

`batch(fn)` delays scheduler requests until the outermost batch completes. The underlying signals are updated synchronously; direct reads inside a batch can see intermediate values. The guarantee is about scheduled observations, not transactional rollback of arbitrary application code. `untrack(fn)` disables dependency tracking for a deliberate read or imperative operation.

Priority 0 is structural work: dynamic regions and lists. Priority 1 is property/text/style binding work. Priority 2 is application side effects. Jobs are deduplicated in sets. Work queued while flushing is included. A configurable execution limit, default 10,000 jobs per flush, detects runaway feedback and prevents an unbounded loop.

Manual scheduling runs only when the host calls `flush` or `frame`; the default standalone runtime schedules microtasks. The scheduler reports `flushes`, `executed`, `skipped` and `errors`. Without an error handler, flush aggregates errors after processing unrelated work. A runtime's default scheduler routes errors through `UIFinal.report`. A caller-supplied shared scheduler owns its own error policy.

### 5.4 Complexity and allocation honesty

Signal notification is proportional to its current subscribers. Effect execution includes checking its recorded dependencies. Structural reconciliation is separate from scalar binding work. JavaScript Sets, Maps, closures and DOM nodes allocate; this implementation does not claim native arena semantics or allocation-free frames under mutation. The practical target is avoiding needless full-screen rebuilding and bounding realized UI size, then measuring actual workload behavior.

## 6. Presentation model and simulation separation

`Model<T>` wraps a presentation snapshot. It supplies `snapshot()`, `select(path)`, `get(path)`, `set(path, value)`, top-level `patch`, whole-model `replace` and `dispose`. Paths are compiled into a selector trie. Repeated selection of the same path reuses its cell. This is the binding compiler's direct lookup mechanism; there is no runtime JavaScript expression parser.

A leaf mutation clones its ancestor containers and notifies registered ancestor selectors plus descendants of the changed path. It does not notify unrelated sibling paths. Replacing a parent necessarily updates selectors below that parent. Subscribing to a whole `player` object is broader than subscribing to `player.health`; author narrowly for frequently changing HUD data.

`patch` accepts only top-level keys, prevalidates the keys, then batches writes. It is not an arbitrary nested JSON-patch protocol or a general rollback transaction. `replace` compares snapshot identity first, then updates registered selectors. For high-frequency gameplay publication, prefer explicit leaf updates or an intentionally batched projection rather than creating an entire model every frame.

Paths are at most 512 characters and use safe dotted identifier/numeric segments. `__proto__`, `prototype` and `constructor` are forbidden. Reads use own properties. Arrays can update existing numeric indices; resize them by replacing the array. Intermediate parents must exist and be plain objects or arrays. A missing leaf of an existing plain object may be created. Accessing a missing read path yields `undefined`, which an asset can handle through its explicit fallback.

The model does not deep-freeze caller-provided state or enforce immutability by cloning every input. The application must treat snapshots as immutable data. Selector trie entries remain interned until model disposal; do not create an unbounded succession of unique paths against a screen that never closes. Dynamic keyed data usually belongs in a collection signal or replaced array rather than continually inventing model property names.

### 6.1 Command queue

A `CommandQueue` is the presentation-to-gameplay boundary. `enqueue(player, type, payload)` validates a nonnegative integer player and a bounded command identifier, takes a detached immutable JSON snapshot, assigns a monotonically increasing local sequence and enqueues it. Default capacity is 1,024 commands; default maximum serialized payload is 16,384 UTF-8 bytes. Overflow is an explicit error, not silent loss of a purchase or equipment action.

Payloads accept finite numbers, strings, booleans, null, arrays and plain records. Accessors, functions, symbols, cycles, reserved prototype keys, sparse arrays and non-data objects are rejected without calling getters or `toJSON`. Validation also bounds depth to 64 and visited values to 10,000. Nested structures are frozen. The payload can no longer drift because application code mutated an object after clicking a button.

`drain(consume, limit?)` processes a snapshot count in FIFO order. Commands enqueued by a consumer wait for the next drain. If a consumer throws, the failing command remains at the head; successful previous commands remain consumed. Nested drains and clearing during a drain are rejected. The consumer must implement idempotency/transactional behavior if it can perform a side effect and then fail. The queue is not an exactly-once networking service, replay protocol, authentication system or authority check.

A shipping game must validate inventory ownership, currency, cooldowns and permissions in gameplay code. The browser event and its player tag are not a trusted server authorization token.

## 7. Authoring model and retained identity

### 7.1 Structural primitives

The public node types are `panel`, `row`, `column`, `grid`, `text`, `button`, `input`, `textarea`, `image`, `scroll`, `progress`, `slider` and `toggle`. Helper functions are ordinary TypeScript functions: `Panel`, `Row`, `Column`, `Grid`, `Text`, `Button`, `TextInput`, `TextArea`, `Image`, `ScrollView`, `Progress`, `Slider` and `Toggle`.

There are no hooks rules, hidden function-component rerender cycle, JSX transform requirement or template-specific widget subclasses. Build a game-specific component by returning a descriptor. Styling, values and labels may be live sources; event handlers are explicitly registered callbacks.

`dynamic(render, key?)` tracks dependencies read while selecting a child structure. `when(condition, then, otherwise?, key?)` is conditional structure. `each(items, itemKey, render, key?)` is a retained keyed collection. `virtualList(options)` is a fixed-row virtual collection. Arrays of children flatten; null, undefined and boolean children produce no visible node. String and numeric children become text, never HTML.

### 7.2 Identity rules

A local `id` is the public handle for lookup, explicit navigation and inspection. IDs must be unique within a runtime. Generated IDs are assigned when omitted. They are runtime identifiers, not stable save-game data.

A key determines sibling/block reuse. Keys are strings or finite numbers; duplicate collection keys are rejected before collection mutation. Use the game's stable item identifier, not an array index that changes when the inventory is sorted. Compatible node kind/type and retained identity preserve DOM. Changing control type intentionally remounts that control. Unkeyed siblings use positional compatibility and must not be relied upon for semantic identity across arbitrary reorderings.

Preserving a text input's node preserves native caret, selection and uncontrolled value through reordering. The renderer also restores native focus when moving retained ranges would otherwise drop it. Retaining DOM does not mean retaining stale handlers: changed event registrations are replaced and reactive row closures read current row data.

### 7.3 Keyed collections

`each` validates keys, reuses matching row records, updates each row's item/index signals, creates missing rows, disposes removed rows and orders retained ranges. The row renderer is called once when a keyed row is created; its values must be read reactively. It is not called for every item property mutation. Template hot reload can reconcile the retained row views.

```ts
const inventory = signal<readonly Item[]>(initialItems);
const list = each(inventory, item => item.id, (item, index) =>
  Button({
    label: () => item.get().name,
    on: { activate: () => commands.enqueue(0, "inventory:inspect", { id: item.peek().id }) },
  }, Text(() => `${index.get() + 1}. ${item.get().name}`))
);
```

Read `item.get()` inside a binding or `item.peek()` inside an action. Capturing `const current = item.get()` once while rendering and later closing over `current` deliberately captures a stale object. This distinction must appear in game-team examples and code review guidance.

Keyed list reconciliation is O(N) in the list length when its source changes. It preserves identity but does not implement a longest-increasing-subsequence minimum-move optimizer. Large repeated screens should use virtualization rather than treating keyed reuse as permission to mount every item.

### 7.4 Property and style changes

Each bound property has its own effect. The renderer compares the actual value before writing. Removing a previously assigned property/style clears its old value. Numeric dimensions become pixels; designated unitless properties such as opacity, z-index, flex-grow and line-height remain numeric; custom CSS variables remain author-controlled values. Non-finite numeric style values fail explicitly.

`text` is literal text content. A node cannot simultaneously own scalar text and child descriptors in an asset. Native leaves such as input, image and progress cannot contain arbitrary children. `attrs` permits ARIA and nonreserved `data-*` metadata, not `onclick`, arbitrary DOM properties or engine-owned `data-uif-*` fields. `ref` observes element creation and null on removal, but does not transfer lifecycle ownership to the application.

## 8. Layout, responsive design and visual language

CSS is the layout engine. `Row` and `Column` establish flex direction; `Grid` establishes CSS Grid; `Panel` is a positioned grouping surface. Authors set dimensions, padding, gap, alignment, wrapping, min/max constraints, aspect ratio and logical properties through style sources or scoped classes. No second `Rectangle` authoring model competes with browser-measured geometry.

Choose flow layout for content, grid for major screen regions and absolute positioning only for intentional overlays. Use `min-width: 0` / `min-height: 0` behavior of the base components to permit shrinking. Use `minmax(0, 1fr)` for flexible grid columns. Name game-specific classes rather than adding new engine primitives for every art composition.

DPI, resolution and safe-area policies belong to the screen/host. CSS lengths can use `rem`, `em`, `%`, `vw`, `vh`, `dvh`, `clamp()` and `env(safe-area-inset-*)`. A safe-area panel can use logical padding plus platform inset expressions. The engine does not guess console overscan, television viewing distance or user-selected subtitle scaling.

A browser backend supports CSS transforms and ordinary clipping, but the focus algorithm reasons about axis-aligned screen rectangles. Rotated controls, overlapping artistic menus and nonrectangular hit regions require explicit links or a future specialized navigation policy. An unrelated overlay is not automatically detected as an occluder. Native modals are treated specially; arbitrary z-order occlusion is not solved by this patch.

### 8.1 Theme tokens

Themes are scoped `--uif-*` custom-property maps. Defaults cover font, font size, text, muted text, surface, raised surface, accent, border, radius, four player-focus colors and motion duration. `setTheme` replaces the runtime theme over defaults, not a global document theme. Token names and finite numeric values are validated before the update is applied. Previously set custom tokens absent from the new theme are removed.

Keep game art tokens separate from runtime ownership. The showcase's backgrounds and panel language demonstrate composition, not an enforced visual skin. User theme values and TypeScript styles are trusted application inputs. Asset style validation is intentionally restricted but is not a complete CSS security parser.

`prefers-reduced-motion` seeds the runtime setting and observes platform changes. `setReducedMotion` also supports an in-game option. `forced-colors` retains a visible focus indication. The patch provides hooks and defaults, not a measured contrast audit for arbitrary themes. Font binaries and licensed game artwork are not included in the delivery.

### 8.2 Animation

Use CSS transitions for small state transitions and `UIFinal.animate` for owned Web Animations. The target must belong to the runtime. Animation lifetime is attached to the target's retained block when available; removing that element cancels the animation. Runtime disposal also cancels it. Reduced-motion mode eliminates configured duration/delay and can finish active animations.

The helper cleans up on completion, including cancelling the finished animation object. Therefore, the **resting visual state must be expressed by reactive properties/styles**, not left dependent on a permanent `fill: forwards` effect. An animation is a transition between states, not the storage location for the state. Infinite animations need explicit reduced-motion and lifecycle testing; the runtime does not provide a timeline authoring editor.

There is no claim that every CSS filter, shadow or transform is GPU-cheap. Complex backdrop filters and large translucent regions still need actual browser/compositor profiling on the target hardware.

## 9. Virtualization contract

A virtual list receives an immutable item array source, stable `itemKey`, row renderer, positive `rowHeight`, positive viewport `height`, optional `overscan` and shell properties. Overscan defaults to two rows and is bounded to 0–100. The delivered implementation is vertical and fixed-height. A row may contain several controls, but arbitrary variable-height content is outside this contract.

For count N, row height R, viewport height H and offset S: clamp S to `[0, max(0, N*R-H)]`; choose a start near `floor(S/R)` minus overscan and an exclusive end near `ceil((S+H)/R)` plus overscan, clamped to the dataset. The exact helper is `visibleRange`. A relative spacer represents total content height; realized rows are positioned at `index*R` and given height R.

At 100,000 items, 40-pixel rows, a 400-pixel viewport and overscan two, the top-of-list fixture realizes 12 rows; interior offsets realize at most 14. This is an assertion about the fixture and algorithm, not a blanket guarantee that a 100,000-item gameplay inventory has negligible memory or filtering cost.

Array/key validation is O(N) only when the item source identity changes. Scroll updates use the cached data/key mapping and reconcile the visible window. Dataset shrinking clamps offset. Realized row wrappers carry list semantics, position and total size; their DOM order follows logical order even though they are positioned absolutely.

Directional navigation from a realized row can advance into an unrealized neighboring row. The controller changes the offset, synchronously realizes the required window, then focuses the destination within the same action. Manual scrolling that recycles the focused row repairs focus into the remaining list rather than leaving it on a disconnected element. When a row contains multiple focusables, application layout and explicit links should be tested for the intended intra-row order.

Source data and its key index remain O(N). Realized controls remain O(V), where V is the visible-plus-overscan count. The implementation does not virtualize the source data itself, server pagination, arbitrary screen-reader traversal of nonexistent DOM, or browser maximum scroll extents. Test row-height declarations against localization and text scaling: overflow hidden is not a substitute for readable content.

## 10. Input, player ownership and event routing

### 10.1 Native events

Use native buttons, inputs, textareas, checkboxes, ranges and progress elements instead of generic clickable divs wherever possible. Events expose `type`, `player`, `target`, `currentTarget`, the native event, value, checked state and composition state. Handlers can prevent default, stop propagation, stop immediate propagation and request/release pointer capture.

`on` handles bubbling; `onCapture` handles capture. `activate` normalizes native click and controller-generated activation. Native Enter and Space already activate a button; UI Final must not synthesize another click for the same keyboard action. The tests cover single activation from real Chromium keyboard and touch input.

Pointer capture belongs to the original element and native pointer lifecycle. Removing a control removes its listeners and lets the browser end associated native capture. Gesture recognition, draggable inventory semantics and drag/drop transaction policy are composed above these events; there is no bespoke drag/drop framework hidden in the base runtime.

### 10.2 Keyboard versus gameplay

Keyboard events originating inside the root are isolated from the game's body-level keydown listener. Native editing and IME default behavior are not cancelled. Arrow keys navigate noneditable controls; Tab and Shift+Tab use the UI focus sequence; Escape can close a dismissible modal or dispatch cancellation.

**Keyup is deliberately allowed to propagate.** A gameplay direction may already be held when a menu opens. Swallowing its release would leave gameplay's held-key map stuck after the menu closes. The InputManager bridge likewise lets all releases through even when it consumes presses.

Do not use `preventDefault()` on every text-editing key. Do not treat browser key repeat as repeated “purchase” or “accept” actions. Editing, gameplay action capture and navigation repeat are different responsibilities.

### 10.3 Engine InputManager bridge

`connectInput(manager, ui, options)` returns a disposer and also belongs to `ui.scope`. It subscribes at priority 1000 so later legacy priority-zero listeners do not steal captured menu input. Existing `addKeyListener` calls without a priority preserve their previous newest-first order.

An explicit `active: () => menuOpen.peek()` is recommended. Without it, the bridge owns input when the root has native focus or a modal. `playerForDevice` maps keyboard/gamepad devices to local player indices or returns undefined to ignore a device. Default keyboard ownership is player zero; gamepad device index maps to the corresponding player index. The game should replace this with its actual controller-assignment policy.

The default mapping covers directional names/WASD, E/Enter/Space accept, Q/Escape cancel and Tab next. Mapping is configurable. Presses are deduplicated per device/key. Directional/next/previous repeat defaults to 350 ms delay and 90 ms interval, with at most one repeat per presentation frame. Accept/cancel do not repeat. Losing ownership clears held navigation state. Unmapped presses are captured by default when the UI owns input; `captureUnmapped: false` opts out.

The bridge consumes existing engine events; it does not poll physical gamepads. Real hardware mapping, dead zones, button glyphs, controller reconnection and per-platform user identity remain host responsibilities.

### 10.4 Multiple roots and players

Every player has an independent logical focus ID. Player zero also uses the document's native focus. Other players use logical focus plus player-colored rings. One browser document still has one native caret and one active editable element; UI Final does not pretend to provide several simultaneous native text editors.

`players` can restrict a control or ancestor container. Undefined permits all players; an empty array permits none. Ownership restrictions inherit through ancestors. Hidden, inert, disabled or `aria-disabled` ancestors exclude descendants from interaction. Button handlers also guard ownership, so controller-generated events cannot bypass it by targeting a child.

## 11. Focus and navigation

Focus registration associates a stable runtime-local ID with a retained element and its current ownership/navigation policy. Destruction unregisters it. `focus(id, player, scroll?)` explicitly targets a control; `first`, `current`, `currentElement` and `navigate` provide normal entry points. Programmatic targeting rejects CSS-hidden/unrendered controls. Directional and Tab navigation filter eligible controls in DOM order.

For directional movement, flush first; resolve current scope; consider explicit links; ask a containing virtual-list controller about offscreen movement; then score rendered candidates from their clipped axis-aligned rectangles. Geometry reads finish before writing the winning focus/scroll state. Rectangles are intersected with scrolling/overflow clips and the viewport.

The implemented score rejects candidates whose center is not forward along the requested axis. Among forward candidates it combines nonnegative near-edge distance, four times the perpendicular gap, one tenth the perpendicular center difference, and a 10,000-unit off-beam penalty. Equal scores retain DOM order. This is a deliberately inspectable heuristic, not CSS Spatial Navigation specification conformance and not a universal artistic-layout solution.

A `focusScope` marks a local navigation boundary. Tab traversal wraps in a scope or modal; outside one it can exit at the boundary. Directional candidates remain in the nearest scope. Explicit `navigation` links override the automatic choice and can be used for intentional scope egress, provided the target remains eligible under player/modal policy. Authors must review such links, not rely on nonexistent compile-time detection of all runtime IDs.

Removing a focused node or setting supported hidden/disabled/ownership properties schedules repair after the commit. CSS visibility changed externally is checked when attempting focus/navigation/activation; the runtime does not run a layout read on every idle frame solely to discover arbitrary external stylesheet changes. Prefer reactive `hidden`/`disabled` for application state transitions.

### 11.1 Modal contract

`openModal(content, { label, dismissible?, onClose? })` creates a **native HTML dialog** and calls `showModal()`. A nonempty accessible label is required. The native top layer makes background document content inert, including other roots and legacy DOM—not merely siblings inside Final's root. A document-level ownership stack additionally blocks engine/synthetic UI actions in background Final runtimes.

The runtime snapshots per-player focus, marks its underlying content and older modal wrappers inert, focuses dialog content, traps modal navigation and restores the invoker or another eligible control on close. Nested dialogs and out-of-order disposal are covered by tests. The returned handle's `close()` explicitly closes even a nondismissible dialog; `dismissible: false` blocks ordinary Escape/cancel dismissal, not programmatic shutdown.

Place a visible cancel/close action in dismissible dialogs and prefer the least destructive initial action for consequential choices. Do not put `aria-modal` on a merely floating panel. This implementation follows the modal interaction model described by W3C APG and uses the native dialog approach documented in W3C technique H102; these references are design guidance, not certification of a game's accessibility.

## 12. Text, editing, localization and accessibility

Text is supplied as Unicode strings and emitted literally. HTML-looking text is not interpreted as markup. The browser and installed/loaded fonts handle shaping, bidi, wrapping, fallback and rasterization. UI Final does not ship a new text-shaping library or claim uniform glyph coverage across platforms. Package fonts through the game's existing approved asset process and wait for font readiness before visual baselines where necessary.

Native inputs and textareas retain selection/caret through compatible patches. `bindValue` provides two-way string signal binding; `bindChecked` provides two-way checkbox state. Controlled `value` and event handlers remain available for other policies. Composition events suspend model-to-input overwrites while IME is composing. For two-way binding, the completed user composition wins; a deferred sync reads the latest value after composition/final-input ordering settles. Application-side validation should run at a defined input/change/submit boundary, not corrupt an active composition.

`I18n` registers locale catalogs with an explicit `ltr` or `rtl` direction. It supplies observable locale/direction, named-placeholder interpolation, cardinal plural choice using `Intl.PluralRules`, fallback messages and localized numbers through a bounded number-format cache. Missing keys visibly return `[key]` and can notify the application. An unavailable locale is rejected rather than silently switching to an unintended language.

This is not an ICU MessageFormat parser. There are no arbitrary expressions, selectordinal messages, rich-text spans or translation-management integration. A plural catalog entry must supply `other`; selected missing forms fall back to it. A fallback message uses its catalog's plural locale. Number formatting options contribute to cache identity. Bind `lang` and `dir` on the relevant screen; use logical CSS properties where mirrored layout is intended. The showcase switches a small set of messages into Arabic to exercise direction and native script rendering; it is not a fully translated game.

Accessibility properties include labels, role, described-by metadata, ARIA/data attributes, hidden/disabled semantics and a polite/assertive live region through `announce`. Native controls remain preferred. Virtual row wrappers expose list position and total count. Focus indicators include four local-player colors and a forced-colors fallback. Reduced-motion is first-class.

Release review must cover actual screen-reader operation, semantic structure, focus order, text scaling, color contrast, control target sizes, subtitle requirements, motion and platform assistive technology. Automated browser tests verify specified behavior; they do not certify WCAG conformance or native console accessibility requirements.

## 13. Declarative asset format

### 13.1 Version and grammar

The envelope is exactly `{ "schema": "ui-final/1", "root": <node> }`. Unknown versions and unknown fields are errors. `parseDocument` accepts a JSON string or plain JSON-compatible data. Direct string parsing is strict JSON. JSON5/JSONC assets go through the existing `UiLoader` parser, then through Final validation.

An element node has `type`, optional `key`, `props`, `on` and `children`. A conditional node has `when`, `then`, optional `else` and `key`. A repeated node has `each`, `as`, `itemKey`, `template`, optional `virtual` and `key`. Literal string and numeric child nodes are allowed. Boolean/null absence is available in TypeScript descriptors, but is not the declarative node grammar.

A binding is `{ "$bind": "path", "format": "registeredName", "fallback": <JSON value> }`, with only `$bind` required. A fallback applies to `undefined`, not to every falsy value. Formatters are registered TypeScript functions and execute as trusted application code. There is no `eval`, `new Function`, property-call syntax, operator precedence or template interpolation language.

```json
{
  "schema": "ui-final/1",
  "root": {
    "type": "column",
    "props": { "style": { "gap": 12, "padding": 20 } },
    "children": [
      { "type": "text", "props": { "text": { "$bind": "player.name" } } },
      { "type": "progress", "props": {
        "label": "Health", "value": { "$bind": "player.health" },
        "max": { "$bind": "player.maxHealth" }
      } },
      { "type": "button", "props": { "id": "inventory", "text": "Inventory" },
        "on": { "activate": "openInventory" } }
    ]
  }
}
```

The implementation in `document.ts` is the authoritative executable schema. The patch does not distribute an incomplete JSON Schema file that accepts different documents from the runtime.

### 13.2 Repeated templates and actions

A repeat source must be an array binding. `as` introduces a safe single-segment local alias; `$index` is the current row-index readable. `itemKey` is a safe path relative to the item. Nested aliases are scoped by the repeated template. A repeated template cannot declare a static public ID, because multiple instances would collide. Use generated IDs or a TypeScript component for derived explicit IDs.

```json
{
  "each": { "$bind": "inventory.items" },
  "as": "item",
  "itemKey": "id",
  "virtual": { "height": 400, "rowHeight": 48, "overscan": 2, "label": "Inventory" },
  "template": {
    "type": "button",
    "props": { "text": { "$bind": "item.name" } },
    "on": { "activate": {
      "action": "equip",
      "args": { "id": { "$bind": "item.id" }, "position": { "$bind": "$index" } }
    } }
  }
}
```

An action is a registered name or `{ action, args }`. Bound arguments are read at invocation time, so retained rows act on their current item/index rather than the original closure value. All action and formatter names are preflighted, including inactive conditional branches and repeated templates, before the view is committed.

Static identity fields such as IDs, roles and navigation maps cannot be arbitrary live expressions. Styling and attributes are scalar-or-binding maps. Asset properties are deliberately narrower than the TypeScript API: no refs, callbacks, bindValue signal objects or executable closures can be serialized. For asset inputs, bind a displayed value and handle registered input/change actions to update the model explicitly.

### 13.3 Validation and limits

Parsing rejects functions, symbols, unsupported object prototypes, getters/setters, reserved keys, cycles and non-finite numbers. It validates control types, property types, supported events, enum values, children, duplicate sibling keys, document-wide IDs and virtual-list dimensions. It rejects unsupported raw attributes and obvious resource-bearing/executable CSS forms. Image values additionally pass renderer protocol validation: relative URLs, HTTP(S), blob URLs and whitelisted raster data URLs are supported; executable protocols, control characters and SVG data URLs are not.

Input strings are bounded to 1,000,000 JavaScript string code units. Individual string values are bounded to 65,536. The data scan is bounded to 50,000 values and 96 levels; the UI tree is bounded to 10,000 nodes and 64 levels. These are parser limits, not recommended rendered screen sizes. Validated data is detached and recursively frozen so later mutation of loader input does not silently alter a mounted document.

The format is not a sandbox for hostile code. Registered actions/formatters, gameplay models, URL origins and TypeScript style sources are trusted. The CSS checks are not a complete malicious-CSS sanitizer. Untrusted remote/mod content needs origin/asset allowlists, signing, content policy and appropriate isolation. A CSP that disallows `unsafe-eval` is supported and used in browser tests. The runtime inserts a stylesheet and style attributes: its `styleNonce` covers the stylesheet, not an otherwise-forbidden style-attribute policy.

### 13.4 Asset loading and reload

`UiLoader.loadFinal(name, path)` reuses existing bundled assets, overrides, JSON5 parsing and `$ref` resolution, then validates the resolved Final document and stores it in a separate library. It never calls legacy template registration for that asset. `getFinal(name)` throws `UIF_ASSET_MISSING` when absent. Failed validation does not replace the last valid library entry. Existing override changes clear the loader's caches.

`mountDocument(ui, document, bindings)` returns a handle. `handle.reload(next)` validates, resolves all registered names, compiles descriptors and reconciles compatible nodes. Validation failure reports an error and leaves the previous UI intact. Valid reloads preserve compatible native inputs and keyed row identity.

This is **validation-transactional, not arbitrary-application-code rollback**. A trusted formatter, ref or rendering callback that throws during commit may have partially changed a reused view; the runtime reports it but does not pretend to reverse arbitrary JavaScript side effects. Whole-screen rollback would require staging/isolation and a separately specified resource transaction. The current contract is explicit so tooling can distinguish validation errors from application commit failures.

File watching is supplied by the host's Vite/HMR pipeline. The patch provides working reload APIs and examples, not a new global filesystem watcher inside the UI runtime. See the migration guide for a JSON5 raw-import reload recipe.

## 14. Asynchronous state

`Resource<T>` exposes a readable discriminated union: idle, pending, ready or error, optionally retaining previous value while pending. Starting a load aborts the preceding request and increments a generation. Only the current nonaborted generation may publish a completion. This guards against loaders that ignore cancellation as well as the ordinary AbortController path.

Failures become resource error state instead of an unhandled rejection. `cancel` returns to idle with any retained value. Disposal prevents subsequent completion commits and rejects new loads. A resource can be owned by a scope; application code should pass `ui.scope` for screen-level requests.

The resource does not implement caching, retries, exponential backoff, deduplicated network fetches, authentication, optimistic domain transactions or server push. Compose those policies above it. Never let a slow response for screen A repopulate a newly-opened screen B through a reused unguarded callback.

## 15. Diagnostics, error policy and performance acceptance

`ui.inspect()` returns public IDs, node types, hidden/disabled state, focused players and child counts. Native DOM metadata also makes the retained tree inspectable with browser tools. `ui.stats` tracks created/disposed elements, text/property writes, range moves, current realized rows and peak realized rows. These are engine counters, not a substitute for browser layout/paint/GPU timing. Some internal shell/spacer and focus metadata writes are not counted as general property writes.

`ui.errors` retains at most 128 errors. `onError` can connect to engine telemetry; applications must avoid throwing from their telemetry sink. Useful error namespaces include `UIF_SCOPE_*`, `UIF_REACTIVE_*`, `UIF_COMPUTED_*`, `UIF_PATH`, `UIF_DOCUMENT_*`, `UIF_DUPLICATE_*`, `UIF_INPUT_*`, `UIF_COMMAND_*`, `UIF_RESOURCE_*`, `UIF_PLATFORM` and `UIF_DISPOSE`. These are actionable diagnostic prefixes, not a separately versioned numeric ABI.

### 15.1 Executable acceptance criteria

The delivered suites assert: equal writes do not run dependent bodies; unrelated model leaves do not schedule unrelated bindings; one changed leaf among 10,000 established bindings schedules one job; structural work precedes property work; obsolete scopes stop observing; computed cycles/failures are bounded and recoverable where subscribed; keyed reorder preserves native controls and caret; an idle mounted fixture performs no binding/text/property work over 1,000 frames; a 100,000-item list retains a small visible window; offscreen navigation materializes synchronously; modal and local-player policies cannot be bypassed by the normal UI dispatch path; invalid asset reload preserves the previous view; stale resources cannot commit; queue payloads are detached and validated; scene teardown releases its presentation ticker.

Browser tests additionally exercise actual Enter/Space, touch taps, pointer capture and text editing through Chromium, not only synthetic DOM events. The complete showcase is exercised at desktop and 390-pixel mobile width with RTL. The integration tests use the real Scene and UiLoader source with isolated legacy/platform adapters; they do not masquerade as a full Pixi/minECS application build.

### 15.2 Performance targets versus evidence

A shipping team may adopt a UI CPU budget in the research's approximate 0.5–2 ms/frame range, but this patch does not report that budget as achieved across hardware. Establish separate budgets for JavaScript mutations, forced layout, style calculation, paint, GPU composition, memory and long-frame percentiles. Measure warm and cold frames, font arrival, image decoding, modal open, inventory sort/filter, language change and resize.

No wall-clock number is portable without a browser build, hardware, display size, workload, warmed state and measurement method. The validation report records deterministic work-count evidence and the environment actually used. It does not invent FPS, console certification, mobile thermal behavior or zero-GC guarantees.

The 100,000-item showcase deliberately makes source-data filtering O(N); virtualization bounds controls, not query computation. Games with expensive filtering should publish filtered IDs, maintain search indexes, paginate or use worker-owned data computation. DOM mutation and focus still occur on the UI thread.

## 16. Migration and compatibility policy

The `yage/ui/final` export is the preferred path for new player-facing screens. The root package exports `UIFinal` and its options for convenience; other authoring primitives remain in the dedicated subpath to avoid collisions with legacy `Text`/`Button` classes. Existing exports, loader methods and old screen APIs remain available.

Move one screen at a time. Convert context mutation to a presentation model; convert expression strings to path bindings or registered formatters; convert layout to CSS; assign stable item keys; create explicit commands; move device ownership into a single bridge; remove the migrated screen's old UI root/input handlers; finally verify coexistence and teardown. Do not mount two active versions of the same screen and allow both to capture gamepad input.

A future breaking engine release may remove the legacy systems after all consumers are migrated. This patch does not do so prematurely. The two-line compatibility notices in legacy mapping files and the new README entry make the preferred direction visible without pretending old assets are automatically equivalent.

## 17. Delivery map and build contract

The runtime is under `engine/ui/final/`. Engine adapters modify Scene, UiLoader, InputManager and exports. `assets/ui/final/status.json5` is a small versioned HUD example. `examples/ui-final/demo.ts` is the reactive equipment showcase; `examples/ui-final/index.ts` integrates it into the existing example route, and `offline.mjs` is the standalone bootstrap.

`npm run build:ui-final` compiles the isolated subsystem and showcase with strict TypeScript and emits a local `.ui-final-build` directory. It uses the project's installed TypeScript, or an already-installed global compiler in a restricted environment. It does not download dependencies. The emitted ESM imports are normalized to `.js` for local Node/browser tests. This output is not a replacement for the normal published package build.

`npm run test:ui-final` builds and runs Node tests, including isolated engine-adapter tests. `npm run test:ui-final:browser` builds and runs the browser suite through Playwright Core and an available Chromium executable. `npm run demo:ui-final:offline` produces a single HTML showcase with locally bundled engine code, no remote assets and no runtime evaluator. The regular engine/Vite packaging remains responsible for distributable `dist/ui/final/*` files and declarations.

The offline/test bundler is deliberately development tooling: a static CommonJS-style module registry produced through TypeScript, not a runtime asset expression compiler. It executes precompiled application code, not strings from UI documents.

## 18. Production release gates and future backend work

The browser-v1 contract is implemented, but a shipping game should not skip validation because a regression suite is green. Required release gates are the complete original engine build/test suite with installed dependencies, every migrated game screen, all supported browsers/devices, physical controllers, long soak tests, font/image failure paths, security review of accepted assets, accessibility testing and workload-specific profiling.

A future native/Pixi backend must be specified separately: retained handles and generation checks; property storage; bounded allocator ownership; measurement/arrangement authority; real shaping and font fallback; clip/stencil semantics; immutable render snapshots; GPU resource fencing; blend order; atlas residency; offscreen passes; world-space input and accessibility bridges. It must not claim parity merely because it shares descriptor names. Browser callbacks, native DOM selection and CSS styles cannot be assumed portable without an explicit compatibility layer.

A future visual editor can consume the versioned document contract, expose supported properties/actions/formatters, validate with the same parser and reload a running scene. It needs selection overlays, undo/redo, breakpoint previews, focus graph visualization, translation expansion and conflict-aware asset saving. None of those should be replaced with a screenshot that looks like an editor but cannot author a game.

Variable-height virtualization needs measured-size indexing, stable scroll anchoring and focus-aware realization. Rich text needs a real span/link/selection model with semantic access, not HTML injection. Per-player editable surfaces need an explicit platform strategy. These extensions should retain the existing state/ownership/command contracts while introducing separately tested layout and interaction contracts.

## 19. Design sources and evidence boundary

The uploaded *Game UI Engines Deep Dive* supplies the architectural requirements around retained invalidation, data binding, virtualization, navigation, lifetime management and separation of UI from rendering. Its vendor comparisons, prices, exact middleware memory/timing estimates and native rendering claims were not required for the implementation and are not adopted as verified facts here.

The repository itself is the basis for the diagnosis and integration paths. The test sources and `VALIDATION.md` are the basis for implementation evidence. W3C's [Modal Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) and [H102 native-dialog technique](https://www.w3.org/WAI/WCAG22/Techniques/html/H102) inform modal semantics. The focus heuristic is a local engineering policy, not an assertion of implementing a W3C spatial-navigation standard.

The delivered standard is concrete: author once; update what changed; keep identity stable; retain native semantics; never lose input releases; bound repeated controls; own every lifetime; and keep UI intent separate from gameplay authority.
