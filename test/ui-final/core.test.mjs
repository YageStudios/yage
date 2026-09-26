import test from "node:test";
import assert from "node:assert/strict";
import { signal, computed, effect, batch, Scope, Scheduler, onCleanup, untrack, Model, spatialScore, keyedItems, visibleRange,
  parseDocument, compileDocument, Resource, I18n, CommandQueue } from "../../.ui-final-build/engine/ui/final/index.js";
import { InputManager, InputEventType } from "../../.ui-final-build/engine/inputs/InputManager.js";

function graph(t, options = {}) { const scope = new Scope(null), scheduler = new Scheduler({ mode: "manual", ...options }); t.after(() => scope.dispose()); return { scope, scheduler }; }
const asset = root => ({ schema: "ui-final/1", root });

test("signals suppress equal writes and schedule only their dependents", t => {
  const g = graph(t), a = signal(1), b = signal(2); let runs = 0;
  effect(() => { a.get(); runs++; }, g);
  a.set(1); b.set(3); g.scheduler.flush(); assert.equal(runs, 1);
  a.set(4); assert.equal(runs, 1); g.scheduler.flush(); assert.equal(runs, 2);
});
test("batch exposes only the final snapshot to scheduled effects", t => {
  const g = graph(t), a = signal(1), b = signal(2), seen = [];
  effect(() => { seen.push([a.get(), b.get()]); }, g);
  batch(() => { a.set(3); b.set(4); a.set(5); }); g.scheduler.flush();
  assert.deepEqual(seen, [[1, 2], [5, 4]]);
});
test("microtask scheduler deduplicates a synchronous burst", async t => {
  const scope = new Scope(null), scheduler = new Scheduler(); t.after(() => scope.dispose());
  const value = signal(0); let calls = 0;
  effect(() => { value.get(); calls++; }, { scope, scheduler });
  for (let i = 1; i <= 100; i++) value.set(i);
  assert.equal(calls, 1); await Promise.resolve(); assert.equal(calls, 2);
});
test("computed values are lazy, cached, and equality-filter downstream effects", t => {
  const g = graph(t), value = signal(1); let calculates = 0, observes = 0;
  const rounded = computed(() => { calculates++; return Math.floor(value.get() / 10); }, Object.is, g.scope);
  assert.equal(calculates, 0); effect(() => { rounded.get(); observes++; }, g);
  value.set(2); g.scheduler.flush(); assert.equal(calculates, 2); assert.equal(observes, 1);
  value.set(12); g.scheduler.flush(); assert.equal(observes, 2);
});
test("diamond dependency graph is glitch-free", t => {
  const g = graph(t), source = signal(1), values = [];
  const a = computed(() => source.get() * 2, Object.is, g.scope);
  const b = computed(() => source.get() + 3, Object.is, g.scope);
  const sum = computed(() => a.get() + b.get(), Object.is, g.scope);
  effect(() => { values.push(sum.get()); }, g); source.set(2); g.scheduler.flush();
  assert.deepEqual(values, [6, 9]);
});
test("conditional dependencies detach obsolete subscriptions", t => {
  const g = graph(t), which = signal(true), a = signal(1), b = signal(2); let runs = 0;
  effect(() => { which.get() ? a.get() : b.get(); runs++; }, g);
  which.set(false); g.scheduler.flush(); a.set(9); g.scheduler.flush(); assert.equal(runs, 2);
  b.set(7); g.scheduler.flush(); assert.equal(runs, 3);
});
test("untracked reads are not dependencies", t => {
  const g = graph(t), a = signal(1); let count = 0;
  effect(() => { untrack(() => a.get()); count++; }, g);
  a.set(2); g.scheduler.flush(); assert.equal(count, 1);
});
test("effect cleanup runs before rerun and at disposal, once per run", t => {
  const g = graph(t), a = signal(1), calls = [];
  const stop = effect(() => { const value = a.get(); calls.push(`run:${value}`); onCleanup(() => calls.push(`clean:${value}`)); }, g);
  a.set(2); g.scheduler.flush(); stop(); stop();
  assert.deepEqual(calls, ["run:1", "clean:1", "run:2", "clean:2"]);
});
test("scope disposal cancels queued work and releases resources", () => {
  const scope = new Scope(null), scheduler = new Scheduler({ mode: "manual" }), a = signal(0); let runs = 0;
  effect(() => { a.get(); runs++; }, { scope, scheduler }); a.set(1);
  scope.dispose(); scheduler.flush(); assert.equal(runs, 1); assert.equal(scheduler.pending, 0); assert.equal(scope.resources, 0);
  assert.throws(() => scope.add(() => {}), /DISPOSED/);
});
test("cleanup errors do not prevent other cleanups", () => {
  const scope = new Scope(null), calls = [];
  scope.add(() => calls.push(1)); scope.add(() => { throw new Error("cleanup"); }); scope.add(() => calls.push(3));
  assert.throws(() => scope.dispose(), AggregateError); assert.deepEqual(calls, [3, 1]);
});
test("structural work precedes obsolete property jobs", t => {
  const g = graph(t), a = signal(0), values = [];
  const remove = effect(() => { a.get(); values.push("property"); }, { ...g, priority: 1 });
  effect(() => { if (a.get() > 0) { remove(); values.push("structure"); } }, { ...g, priority: 0 });
  values.length = 0; a.set(1); g.scheduler.flush(); assert.deepEqual(values, ["structure"]);
});
test("computed writes and recursive computations fail explicitly", t => {
  const g = graph(t), a = signal(0);
  const impure = computed(() => { a.set(2); return 1; }, Object.is, g.scope);
  assert.throws(() => impure.get(), /COMPUTED_WRITE/);
  let recursive; recursive = computed(() => recursive.get(), Object.is, g.scope);
  assert.throws(() => recursive.get(), /REACTIVE_CYCLE/);
});
test("runaway effects hit a bounded cycle guard", t => {
  const g = graph(t, { maxRuns: 10 }), a = signal(0);
  effect(() => { a.set(a.get() + 1); }, g);
  assert.throws(() => g.scheduler.flush(), /REACTIVE_CYCLE/); assert.equal(g.scheduler.pending, 0);
});
test("effect failures do not starve unrelated queued work", t => {
  const errors = [], g = graph(t, { onError: error => errors.push(error) }), a = signal(0); let other = 0;
  effect(() => { if (a.get()) throw new Error("bad"); }, g);
  effect(() => { other = a.get(); }, g); a.set(1); g.scheduler.flush();
  assert.equal(errors.length, 1); assert.equal(other, 1);
});
test("clean flush does no reactive work", t => {
  const g = graph(t), a = signal(0); effect(() => { a.get(); }, g);
  for (let frame = 0; frame < 10000; frame++) g.scheduler.flush();
  assert.equal(g.scheduler.stats.executed, 0); assert.equal(g.scheduler.stats.flushes, 0);
});
test("path model invalidates ancestors and descendants, not siblings", t => {
  const g = graph(t), model = new Model({ player: { hp: 100, gold: 20 }, unrelated: 5 }), counts = { hp: 0, gold: 0, player: 0 };
  for (const name of Object.keys(counts)) effect(() => { model.get(name === "player" ? "player" : `player.${name}`); counts[name]++; }, g);
  model.set("player.hp", 70); g.scheduler.flush(); assert.deepEqual(counts, { hp: 2, gold: 1, player: 2 });
  model.set("player", { hp: 30, gold: 40 }); g.scheduler.flush(); assert.deepEqual(counts, { hp: 3, gold: 2, player: 3 });
});
test("model selectors are interned and snapshots use structural sharing", () => {
  const original = { player: { hp: 100 }, unchanged: {} }, model = new Model(original);
  assert.equal(model.select("player.hp"), model.select("player.hp")); model.set("player.hp", 10);
  assert.equal(original.player.hp, 100); assert.equal(model.snapshot().unchanged, original.unchanged); assert.notEqual(model.snapshot().player, original.player);
});
test("model patch is batched and validates all keys before writes", t => {
  const g = graph(t), model = new Model({ a: 1, b: 2 }), seen = [];
  effect(() => { seen.push([model.get("a"), model.get("b")]); }, g); model.patch({ a: 3, b: 4 }); g.scheduler.flush();
  assert.deepEqual(seen, [[1, 2], [3, 4]]);
  assert.throws(() => model.patch({ a: 9, "bad.path": 1 }), /PATH/); assert.equal(model.get("a"), 3);
});
test("array paths update existing indices and reject holes and prototype paths", () => {
  const model = new Model({ items: [{ id: 1 }], empty: undefined }); model.set("items.0.id", 2); assert.equal(model.get("items.0.id"), 2);
  for (const path of ["items.9.id", "items.length", "empty.value", "__proto__.polluted", "items.01.id", "items.constructor"]) assert.throws(() => model.set(path, 1), /PATH/);
  assert.equal({}.polluted, undefined);
});
test("model replacement updates cached missing selectors", t => {
  const g = graph(t), model = new Model({ a: 1 }); let missing = null;
  effect(() => { missing = model.get("newField"); }, g); assert.equal(missing, undefined);
  model.replace({ a: 2, newField: 9 }); g.scheduler.flush(); assert.equal(missing, 9);
  model.dispose(); assert.throws(() => model.snapshot(), /DISPOSED/);
});
test("10,000 path bindings schedule exactly one job for a leaf mutation", t => {
  const g = graph(t), model = new Model(Object.fromEntries(Array.from({ length: 10000 }, (_, index) => [`x${index}`, index])));
  for (let index = 0; index < 10000; index++) effect(() => { model.get(`x${index}`); }, g);
  model.set("x7777", -1); assert.equal(g.scheduler.pending, 1); g.scheduler.flush(); assert.equal(g.scheduler.stats.executed, 1);
});
test("keyed collection rejects ambiguous keys before use", () => {
  assert.deepEqual(keyedItems([1, "1"], value => value).keys, [1, "1"]);
  assert.throws(() => keyedItems([1, 1], value => value), /DUPLICATE_KEY/);
  for (const key of [NaN, Infinity, {}, undefined]) assert.throws(() => keyedItems([key], value => value), /UIF_KEY/);
});
test("virtual range is bounded and clamps resize/overscroll", () => {
  assert.deepEqual(visibleRange(100000, 0, 400, 40, 2), { start: 0, end: 12, offset: 0 });
  assert.deepEqual(visibleRange(3, 99999, 400, 40), { start: 0, end: 3, offset: 0 });
  assert.deepEqual(visibleRange(0, 20, 400, 40), { start: 0, end: 0, offset: 0 });
  for (const height of [0, -1, NaN, Infinity]) assert.throws(() => visibleRange(1, 0, 100, height), /VIRTUAL_RANGE/);
});
test("virtual range property test: all visible rows are covered with bounded overscan", () => {
  for (let index = 1; index <= 5000; index++) {
    const count = index % 997, row = 13 + index % 33, height = 1 + index % 777, overscan = index % 7;
    const range = visibleRange(count, index * 19 - 100, height, row, overscan);
    assert.ok(range.start >= 0 && range.end <= count && range.end >= range.start);
    assert.ok(range.end - range.start <= Math.ceil(height / row) + 1 + 2 * overscan);
    if (count) assert.ok(range.start <= Math.floor(range.offset / row));
  }
});
test("spatial scoring favors an aligned beam and rejects the wrong direction", () => {
  const from = { left: 100, top: 100, right: 150, bottom: 150 };
  assert.equal(spatialScore(from, { left: 0, top: 100, right: 50, bottom: 150 }, "right"), null);
  const aligned = spatialScore(from, { left: 400, top: 100, right: 450, bottom: 150 }, "right");
  const diagonal = spatialScore(from, { left: 170, top: 200, right: 220, bottom: 250 }, "right");
  assert.ok(aligned < diagonal);
});
test("document compiler binds paths without evaluating JavaScript", () => {
  const model = new Model({ text: '<img src=x onerror="attack()">' });
  const doc = asset({ type: "text", props: { text: { $bind: "text" } } });
  const original = globalThis.Function; globalThis.Function = () => { throw new Error("eval disabled"); };
  try { const child = compileDocument(doc, { model }); assert.equal(child.props.text(), model.get("text")); } finally { globalThis.Function = original; }
});
test("documents are detached frozen copies and reject version/unknown fields", () => {
  const source = asset({ type: "text", props: { text: "hello" } }), parsed = parseDocument(source);
  source.root.props.text = "changed"; assert.equal(parsed.root.props.text, "hello"); assert.ok(Object.isFrozen(parsed.root.props));
  assert.throws(() => parseDocument({ ...source, schema: "next" }), /DOCUMENT_VERSION/);
  assert.throws(() => parseDocument(asset({ type: "text", mystery: true })), /DOCUMENT_FIELD/);
});
test("documents reject executable and cyclic input, accessors, and unsafe binding paths", () => {
  const cycle = {}; cycle.root = cycle;
  assert.throws(() => parseDocument(cycle), /DOCUMENT_CYCLE/);
  assert.throws(() => parseDocument(asset({ type: "text", props: { text: () => 1 } })), /DOCUMENT_VALUE/);
  const getter = {}; Object.defineProperty(getter, "schema", { get() { throw new Error("must not invoke"); }, enumerable: true });
  assert.throws(() => parseDocument(getter), /DOCUMENT_VALUE/);
  assert.throws(() => parseDocument(asset({ type: "text", props: { text: { $bind: "player.constructor.constructor" } } })), /DOCUMENT_PATH/);
});
test("documents reject duplicate sibling keys, repeated static IDs and malformed virtual lists", () => {
  assert.throws(() => parseDocument(asset({ type: "row", children: [{ type: "text", key: "x" }, { type: "button", key: "x" }] })), /DOCUMENT_KEY/);
  const repeated = { each: { $bind: "items" }, as: "item", itemKey: "id", template: { type: "button", props: { id: "same" } } };
  assert.throws(() => parseDocument(asset(repeated)), /DOCUMENT_ID/);
  repeated.template.props = {}; repeated.virtual = { height: 200, rowHeight: 0 }; assert.throws(() => parseDocument(asset(repeated)), /DOCUMENT_VIRTUAL/);
});
test("all action and formatter references preflight even in inactive branches", () => {
  const model = new Model({ visible: false });
  const doc = asset({ when: { $bind: "visible" }, then: { type: "button", on: { activate: "missing" } } });
  assert.throws(() => compileDocument(doc, { model }), /DOCUMENT_ACTION/);
  assert.throws(() => compileDocument(asset({ type: "text", props: { text: { $bind: "visible", format: "missing" } } }), { model }), /DOCUMENT_FORMAT/);
});
test("document CSS and attributes cannot introduce scripts or reserved metadata", () => {
  for (const props of [{ innerHTML: "hi" }, { attrs: { onclick: "run()" } }, { attrs: { "data-uif-node": "fake" } }, { style: { background: "url(https://example.invalid)" } }]) {
    assert.throws(() => parseDocument(asset({ type: "panel", props })), /UIF_DOCUMENT/);
  }
});
test("resource commits only the latest request, even when aborted loader ignores cancellation", async () => {
  const resource = new Resource(); let resolveFirst, resolveSecond, firstSignal;
  const first = resource.load(signal => { firstSignal = signal; return new Promise(resolve => { resolveFirst = resolve; }); });
  const second = resource.load(() => new Promise(resolve => { resolveSecond = resolve; }));
  assert.ok(firstSignal.aborted); resolveSecond("new"); await second; resolveFirst("old"); await first;
  assert.deepEqual(resource.state.get(), { status: "ready", value: "new" }); resource.dispose();
});
test("resource disposal prevents stale completion and errors are state, not unhandled rejections", async () => {
  const resource = new Resource(); await resource.load(async () => { throw new Error("offline"); }); assert.equal(resource.state.get().status, "error");
  let resolve; const pending = resource.load(() => new Promise(done => { resolve = done; })); resource.dispose(); resolve("late"); await pending;
  assert.equal(resource.state.get().status, "pending"); await assert.rejects(() => resource.load(async () => 1), /DISPOSED/);
});
test("localization supports plural forms, fallback, placeholders and explicit direction", t => {
  const g = graph(t), i18n = new I18n("en", { en: { direction: "ltr", messages: { items: { one: "{count} item", other: "{count} items" }, title: "Inventory" } }, ar: { direction: "rtl", messages: { title: "المخزون" } } }, g.scope);
  assert.equal(i18n.t("items", { count: 1 }), "1 item"); assert.equal(i18n.t("items", { count: 2 }), "2 items");
  i18n.setLocale("ar"); assert.equal(i18n.direction.get(), "rtl"); assert.equal(i18n.t("items", { count: 1 }), "1 item"); assert.equal(i18n.t("title"), "المخزون");
  assert.equal(i18n.t("toString"), "[toString]"); assert.throws(() => i18n.setLocale("missing"), /UIF_LOCALE/);
});
test("command queue copies and freezes payloads and fails loudly on overflow", () => {
  const queue = new CommandQueue(1), payload = { item: { id: 1 } }; const command = queue.enqueue(0, "inventory:equip", payload);
  payload.item.id = 99; assert.equal(command.payload.item.id, 1); assert.ok(Object.isFrozen(command.payload.item));
  assert.throws(() => queue.enqueue(0, "buy"), /OVERFLOW/); const seen = []; assert.equal(queue.drain(value => seen.push(value)), 1); assert.equal(seen[0].sequence, 1);
});
test("failed command handlers retain their command and enqueue-during-drain waits", () => {
  const queue = new CommandQueue(); queue.enqueue(0, "one");
  assert.throws(() => queue.drain(() => { throw new Error("retry"); }), /retry/); assert.equal(queue.size, 1);
  queue.drain(() => queue.enqueue(1, "two")); assert.equal(queue.size, 1); queue.drain(command => assert.equal(command.type, "two"));
});
test("input interception priority survives subsequently-added legacy listeners", () => {
  const input = new InputManager(), calls = [];
  input.addKeyListener(() => { calls.push("final"); return false; }, 1000);
  input.addKeyListener(() => { calls.push("legacy"); });
  input.dispatchEvent("e", true, InputEventType.GAMEPAD, 0); assert.deepEqual(calls, ["final"]); assert.equal(input.keyMap.size, 0);
});
test("equal-priority legacy listeners preserve newest-first order", () => {
  const input = new InputManager(), calls = [];
  input.addKeyListener(() => { calls.push(1); }); input.addKeyListener(() => { calls.push(2); }); input.dispatchEvent("x", true, InputEventType.KEYBOARD);
  assert.deepEqual(calls, [2, 1]); assert.equal(input.keyMap.get("x"), true);
});

test("a computed recovers after a dependency-triggered evaluation failure", t => {
  const g = graph(t), source = signal(1), values = [];
  const derived = computed(() => { const n = source.get(); if (n === 2) throw new Error("transient"); return n * 10; });
  g.scope.add(() => derived.dispose()); effect(() => { values.push(derived.get()); }, g);
  source.set(2); assert.throws(() => g.scheduler.flush(), /UIF_EFFECT/);
  source.set(3); g.scheduler.flush(); assert.deepEqual(values, [10, 30]);
});
test("command payload validation does not execute getters or silently lose non-JSON values", () => {
  const queue = new CommandQueue(), getter = {};
  Object.defineProperty(getter, "value", { get() { throw new Error("must not execute"); }, enumerable: true });
  const cycle = {}; cycle.next = cycle;
  for (const payload of [NaN, Infinity, undefined, { value: undefined }, { value: () => 1 }, getter, cycle, new Date(), [1, , 2]]) {
    if (payload === undefined) continue; // Omitted payload intentionally defaults to null.
    assert.throws(() => queue.enqueue(0, "test", payload), /UIF_COMMAND_PAYLOAD/);
  }
  assert.equal(queue.size, 0);
});
test("command drains reject destructive reentry and preserve the failed head", () => {
  const queue = new CommandQueue(); queue.enqueue(0, "test");
  assert.throws(() => queue.drain(() => queue.drain(() => {})), /UIF_COMMAND_REENTRANT/);
  assert.throws(() => queue.drain(() => queue.clear()), /UIF_COMMAND_REENTRANT/);
  assert.equal(queue.size, 1); assert.equal(queue.drain(() => {}), 1);
});
