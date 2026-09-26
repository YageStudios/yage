import { UIFinal, signal, computed, Model, h, text, dynamic, each, virtualList, mountDocument, Resource, I18n, connectInput } from "../../.ui-final-build/engine/ui/final/index.js";
import { InputManager, InputEventType } from "../../.ui-final-build/engine/inputs/InputManager.js";

const tests = [], disposals = [];
const test = (name, run) => tests.push({ name, run });
function assert(value, message = "assertion failed") { if (!value) throw new Error(message); }
function equal(actual, expected, message = "") { assert(Object.is(actual, expected), `${message}: expected ${String(expected)}, got ${String(actual)}`); }
function deep(actual, expected) { equal(JSON.stringify(actual), JSON.stringify(expected)); }
function throws(fn, match) { let error; try { fn(); } catch (e) { error = e; } assert(error && match.test(String(error)), `expected error ${match}, got ${error}`); }
function fixture(options = {}) {
  const host = document.createElement("div"); Object.assign(host.style, { position: "relative", width: "1000px", height: "700px" }); document.body.appendChild(host);
  const ui = new UIFinal({ host, scheduling: "manual", onError: () => {}, ...options });
  disposals.push(() => { try { ui.dispose(); } finally { host.remove(); } }); return ui;
}
function cleanup() { while (disposals.length) disposals.pop()(); }
const asset = root => ({ schema: "ui-final/1", root });
const node = (ui, id) => { const element = ui.element(id); assert(element, `missing element ${id}`); return element; };

test("retained property updates do not reconstruct unrelated nodes", () => {
  const ui = fixture(), score = signal(1), gold = signal(5);
  ui.mount(h("row", {}, h("text", { id: "score", text: score }), h("text", { id: "gold", text: gold })));
  const original = node(ui, "gold"), created = ui.stats.created, writes = ui.stats.textWrites;
  score.set(2); ui.flush(); equal(node(ui, "score").textContent, "2"); equal(node(ui, "gold"), original);
  equal(ui.stats.created, created); equal(ui.stats.textWrites - writes, 1);
});
test("idle frames do no binding evaluations or DOM writes", () => {
  const ui = fixture(), score = signal(1); ui.mount(h("text", { text: score }));
  const initial = JSON.stringify(ui.stats), runs = ui.scheduler.stats.executed;
  for (let frame = 0; frame < 1000; frame++) ui.frame(16);
  equal(JSON.stringify(ui.stats), initial); equal(ui.scheduler.stats.executed, runs);
});
test("scoped styles clear stale values and preserve numeric units", () => {
  const ui = fixture(), width = signal(100), opacity = signal(0.5), hidden = signal(false);
  ui.mount(h("panel", { id: "p", hidden, style: { width, opacity, flexGrow: 1 } }));
  equal(node(ui, "p").style.width, "100px"); equal(node(ui, "p").style.opacity, "0.5"); equal(node(ui, "p").style.flexGrow, "1");
  width.set(null); hidden.set(true); ui.flush(); equal(node(ui, "p").style.width, ""); assert(node(ui, "p").hidden);
  ui.update(h("panel", { id: "p", style: { height: 50 } })); equal(node(ui, "p").style.opacity, ""); assert(!node(ui, "p").hidden);
});
test("dynamic branches dispose obsolete bindings", () => {
  const ui = fixture(), visible = signal(true), name = signal("one");
  ui.mount(dynamic(() => visible.get() ? h("text", { id: "conditional", text: name }) : null));
  visible.set(false); ui.flush(); assert(!ui.element("conditional")); const writes = ui.stats.textWrites;
  name.set("two"); ui.flush(); equal(ui.stats.textWrites, writes); visible.set(true); ui.flush(); equal(node(ui, "conditional").textContent, "two");
});
test("keyed reorder retains uncontrolled input, caret, focus and DOM identity", () => {
  const ui = fixture(), items = signal([{ id: "a" }, { id: "b" }, { id: "c" }]);
  ui.mount(h("column", {}, each(items, item => item.id, item => h("input", { attrs: { "data-key": () => item.get().id } }))));
  const input = ui.root.querySelector('[data-key="b"]'); input.value = "edited"; input.focus(); input.setSelectionRange(2, 4);
  const snapshot = items.peek(); items.set([snapshot[2], snapshot[1], snapshot[0]]); ui.flush();
  equal(ui.root.querySelector('[data-key="b"]'), input); equal(input.value, "edited"); equal(document.activeElement, input); equal(input.selectionStart, 2); equal(input.selectionEnd, 4);
  deep([...ui.root.querySelectorAll("input")].map(element => element.getAttribute("data-key")), ["c", "b", "a"]);
});
test("keyed item replacement updates text and closures read current data", () => {
  const ui = fixture(), items = signal([{ id: "a", name: "old" }]), seen = [];
  ui.mount(each(items, item => item.id, item => h("button", { text: () => item.get().name, on: { activate: () => seen.push(item.get().name) } })));
  const button = ui.root.querySelector("button"); items.set([{ id: "a", name: "new" }]); ui.flush();
  equal(ui.root.querySelector("button"), button); equal(button.textContent, "new"); button.click(); deep(seen, ["new"]);
});
test("duplicate keyed updates preserve the previous DOM and report an error", () => {
  const ui = fixture(), items = signal([{ id: "a" }]);
  ui.mount(each(items, item => item.id, item => h("button", { text: () => item.get().id })));
  const original = ui.root.querySelector("button"); items.set([{ id: "x" }, { id: "x" }]); ui.flush();
  equal(ui.root.querySelector("button"), original); equal(ui.errors.length, 1); assert(String(ui.errors[0]).includes("DUPLICATE_KEY"));
});
test("removing a focused node repairs focus to a remaining control", () => {
  const ui = fixture(), visible = signal(true);
  ui.mount(h("column", {}, dynamic(() => visible.get() ? h("button", { id: "a", text: "A" }) : null), h("button", { id: "b", text: "B" })));
  ui.focus.focus("a"); visible.set(false); ui.flush(); equal(ui.focus.current(), "b"); equal(document.activeElement, node(ui, "b"));
});
test("Tab, explicit focus and activation skip CSS-hidden controls", () => {
  const ui = fixture(); ui.mount(h("column", {}, h("button", { id: "hidden", text: "Hidden", style: { display: "none" } }), h("button", { id: "a", text: "A" }), h("button", { id: "invisible", text: "Invisible", style: { visibility: "hidden" } }), h("button", { id: "b", text: "B" })));
  assert(!ui.focus.focus("hidden")); assert(!ui.focus.focus("invisible")); ui.focus.first(); equal(ui.focus.current(), "a");
  ui.focus.navigate("next"); equal(ui.focus.current(), "b");
});
test("repeated deterministic keyed reorders retain every control identity and dispose cleanly", () => {
  const ui = fixture(), values = Array.from({ length: 32 }, (_, id) => ({ id })), items = signal(values);
  ui.mount(each(items, item => item.id, item => h("input", { attrs: { "data-item": () => item.get().id } })));
  const original = [...ui.root.querySelectorAll("input")], created = ui.stats.created; let seed = 18;
  for (let round = 0; round < 50; round++) {
    const next = items.peek().slice(); for (let index = next.length - 1; index > 0; index--) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const swap = seed % (index + 1); [next[index], next[swap]] = [next[swap], next[index]]; }
    items.set(next); ui.flush(); const controls = [...ui.root.querySelectorAll("input")];
    controls.forEach((control, index) => equal(control, original[next[index].id]));
  }
  equal(ui.stats.created, created); ui.dispose(); equal(ui.stats.created, ui.stats.disposed); equal(ui.stats.realizedRows, 0);
});
test("100,000-item virtual list realizes a viewport-sized window", () => {
  const ui = fixture(), items = signal(Array.from({ length: 100000 }, (_, id) => ({ id, name: `Item ${id}` }))); let renders = 0;
  ui.mount(virtualList({ items, itemKey: item => item.id, rowHeight: 40, height: 400, overscan: 2, props: { id: "list" }, render: item => { renders++; return h("button", { text: () => item.get().name }); } }));
  equal(ui.stats.realizedRows, 12); equal(renders, 12); const list = node(ui, "list");
  list.scrollTop = 40000; list.dispatchEvent(new Event("scroll")); ui.flush();
  assert(ui.stats.realizedRows <= 14); assert(renders <= 26); assert(ui.root.textContent.includes("Item 1000"));
  equal(list.getAttribute("role"), "list");
});
test("virtual list clamps offset after dataset shrink and keeps DOM in item order", () => {
  const ui = fixture(), items = signal(Array.from({ length: 1000 }, (_, id) => ({ id })));
  ui.mount(virtualList({ items, itemKey: item => item.id, rowHeight: 30, height: 150, props: { id: "list" }, render: item => h("button", { text: () => item.get().id }) }));
  const list = node(ui, "list"); list.scrollTop = 29000; list.dispatchEvent(new Event("scroll")); ui.flush();
  items.set([{ id: 0 }, { id: 1 }, { id: 2 }]); ui.flush(); equal(list.scrollTop, 0); equal(ui.stats.realizedRows, 3);
  deep([...list.querySelectorAll("button")].map(button => button.textContent), ["0", "1", "2"]);
});
test("gamepad-style navigation realizes offscreen virtual rows synchronously", () => {
  const ui = fixture(), items = signal(Array.from({ length: 1000 }, (_, id) => ({ id })));
  ui.mount(virtualList({ items, itemKey: item => item.id, rowHeight: 40, height: 200, props: { id: "list" }, render: item => h("button", { text: () => item.get().id }) }));
  ui.focus.first(); for (let index = 0; index < 40; index++) assert(ui.focus.navigate("down"), `navigation ${index}`);
  equal(ui.focus.currentElement().textContent, "40"); assert(node(ui, "list").scrollTop > 0); assert(ui.stats.realizedRows <= 10);
});
test("native modal traps Tab and restores the invoker", () => {
  const ui = fixture(); ui.mount(h("button", { id: "open", text: "Open" })); ui.focus.focus("open");
  const modal = ui.openModal(h("column", {}, h("button", { id: "cancel", text: "Cancel" }), h("button", { id: "ok", text: "Okay" })), { label: "Confirm" });
  assert(modal.element instanceof HTMLDialogElement && modal.element.open); assert(ui.content.inert); equal(ui.focus.current(), "cancel");
  ui.focus.focus("ok"); node(ui, "ok").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); equal(ui.focus.current(), "cancel");
  node(ui, "cancel").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert(!modal.element.isConnected); assert(!ui.content.inert); equal(ui.focus.current(), "open");
});
test("nested modal out-of-order close cannot leave the background inert", () => {
  const ui = fixture(); ui.mount(h("button", { id: "open", text: "Open" })); ui.focus.focus("open");
  const first = ui.openModal(h("button", { id: "first", text: "First" }), { label: "First" });
  const second = ui.openModal(h("button", { id: "second", text: "Second" }), { label: "Second" });
  first.close(); assert(second.element.open); equal(ui.focus.current(), "second"); second.close(); assert(!ui.content.inert); equal(ui.focus.current(), "open");
});
test("non-dismissible modal consumes cancel but supports explicit close", () => {
  const ui = fixture(); ui.mount(h("button", { id: "base", text: "Base" }));
  const modal = ui.openModal(h("button", { id: "wait", text: "Wait" }), { label: "Saving", dismissible: false });
  ui.focus.navigate("cancel"); assert(modal.element.open); modal.close(); assert(!modal.element.isConnected);
});
test("document-wide modality prevents synthetic activation in a second UI root", () => {
  const one = fixture(), two = fixture(); let clicks = 0;
  one.mount(h("button", { id: "one", text: "One", on: { activate: () => clicks++ } })); two.mount(h("button", { id: "two", text: "Two" }));
  one.focus.focus("one"); const modal = two.openModal(h("button", { id: "modal", text: "Modal" }), { label: "Second root" });
  assert(!one.acceptsInput); node(one, "one").click(); equal(clicks, 0); assert(!one.focus.navigate("accept"));
  modal.close(); assert(one.acceptsInput); node(one, "one").click(); equal(clicks, 1);
});
test("player ownership inherits through panels and explicit links cannot escape it", () => {
  const ui = fixture(); ui.mount(h("row", {}, h("panel", { players: [0] }, h("button", { id: "a", text: "A", navigation: { right: "b" } })), h("panel", { players: [1] }, h("button", { id: "b", text: "B" }))));
  assert(ui.focus.focus("a", 0)); assert(!ui.focus.focus("b", 0)); assert(ui.focus.focus("b", 1)); assert(!ui.focus.navigate("right", 0));
  equal(ui.focus.current(0), "a"); equal(ui.focus.current(1), "b");
});
test("spatial navigation supports explicit overrides and focus scopes", () => {
  const ui = fixture(); ui.mount(h("row", { style: { gap: 30 } }, h("column", { focusScope: "group" },
    h("button", { id: "a", text: "A", navigation: { down: "c" } }), h("button", { id: "b", text: "B" }), h("button", { id: "c", text: "C" })), h("button", { id: "out", text: "Outside" })));
  ui.focus.focus("a"); assert(ui.focus.navigate("down")); equal(ui.focus.current(), "c"); assert(!ui.focus.navigate("right")); equal(ui.focus.current(), "c");
});
test("capture and bubble handlers route in native order", () => {
  const ui = fixture(), order = [];
  ui.mount(h("panel", { onCapture: { activate: () => order.push("capture") }, on: { activate: () => order.push("bubble") } }, h("button", { id: "child", text: "Child", on: { activate: event => { order.push(event.currentTarget.dataset.uifId); } } })));
  node(ui, "child").click(); deep(order, ["capture", "child", "bubble"]);
});
test("disabled ancestors block activation and are skipped during focus repair", () => {
  const ui = fixture(), disabled = signal(false); let calls = 0;
  ui.mount(h("column", {}, h("panel", { disabled }, h("button", { id: "a", text: "A", on: { activate: () => calls++ } })), h("button", { id: "b", text: "B" })));
  ui.focus.focus("a"); disabled.set(true); ui.flush(); node(ui, "a").click(); equal(calls, 0); equal(ui.focus.current(), "b");
});
test("text remains literal and unsafe attributes and URLs are rejected", () => {
  const ui = fixture(), payload = '<img src=x onerror="window.attacked=true">'; ui.mount(h("text", { text: payload }));
  equal(ui.root.querySelectorAll("img").length, 0); assert(ui.root.textContent.includes(payload)); assert(!window.attacked);
  throws(() => ui.update(h("image", { src: "java\nscript:alert(1)" })), /UIF_URL/);
});
test("simulated IME composition is not overwritten by external model updates", async () => {
  const ui = fixture(), value = signal("initial"); ui.mount(h("input", { id: "name", bindValue: value, label: "Name" }));
  const input = node(ui, "name"); input.focus(); input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); input.value = "に";
  input.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true })); equal(value.peek(), "initial");
  value.set("external"); ui.flush(); equal(input.value, "に"); input.value = "日本";
  input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); await Promise.resolve(); ui.flush(); equal(value.peek(), "日本"); equal(input.value, "日本");
});
test("ordinary bound input preserves caret on unrelated state changes", () => {
  const ui = fixture(), value = signal("hello"), other = signal(1);
  ui.mount(h("column", {}, h("input", { id: "input", bindValue: value }), h("text", { text: other })));
  const input = node(ui, "input"); input.focus(); input.setSelectionRange(2, 2); other.set(2); ui.flush(); equal(input.selectionStart, 2);
  input.value = "hello!"; input.dispatchEvent(new InputEvent("input", { bubbles: true })); ui.flush(); equal(value.peek(), "hello!");
});
test("invalid asset reload preserves the mounted view and valid reload retains controls", () => {
  const ui = fixture(), model = new Model({ score: 1 }); let actions = 0;
  const document = title => asset({ type: "column", children: [{ type: "text", key: "heading", props: { text: title } }, { type: "input", key: "name", props: { id: "name", label: "Name" } }, { type: "button", key: "action", props: { id: "action", text: "Go" }, on: { activate: "go" } }] });
  const handle = mountDocument(ui, document("First"), { model, actions: { go: () => actions++ } });
  const input = node(ui, "name"); input.value = "keep"; input.focus(); assert(!handle.reload({ schema: "invalid" })); equal(node(ui, "name"), input);
  assert(handle.reload(document("Second"))); equal(node(ui, "name"), input); equal(input.value, "keep"); node(ui, "action").click(); equal(actions, 1);
});
test("document list bindings expose item and index without eval", () => {
  const ui = fixture(), model = new Model({ items: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }] }), chosen = [];
  mountDocument(ui, asset({ each: { $bind: "items" }, as: "item", itemKey: "id", template: { type: "button", props: { text: { $bind: "item.name" }, attrs: { "data-index": { $bind: "$index" } } }, on: { activate: { action: "select", args: { id: { $bind: "item.id" } } } } } }), { model, actions: { select: (_event, args) => chosen.push(args.id) } });
  const buttons = ui.root.querySelectorAll("button"); equal(buttons[1].textContent, "Beta"); equal(buttons[1].getAttribute("data-index"), "1"); buttons[1].click(); deep(chosen, ["b"]);
});
test("native checkbox and slider controller changes have semantic values", () => {
  const ui = fixture(), checked = signal(false); let range = null, actor = null;
  ui.mount(h("column", {}, h("toggle", { id: "toggle", bindChecked: checked, label: "Enable" }), h("slider", { id: "slider", min: 0, max: 10, step: 2, value: 4, label: "Volume", on: { change: event => { range = event.value; actor = event.player; } } })));
  ui.focus.focus("toggle", 1); ui.focus.navigate("accept", 1); assert(checked.peek());
  ui.focus.focus("slider", 1); ui.focus.navigate("right", 1); equal(range, "6"); equal(actor, 1);
});
test("localization updates direction and browser text without remount", () => {
  const ui = fixture(), i18n = new I18n("en", { en: { direction: "ltr", messages: { title: "Inventory" } }, ar: { direction: "rtl", messages: { title: "المخزون" } } }, ui.scope);
  ui.mount(h("panel", { id: "panel", dir: i18n.direction }, h("text", { id: "title", text: () => i18n.t("title") })));
  const title = node(ui, "title"); i18n.setLocale("ar"); ui.flush(); equal(node(ui, "title"), title); equal(title.textContent, "المخزون"); equal(node(ui, "panel").dir, "rtl");
});
test("animations honor reduced motion and cancel when their node is removed", async () => {
  const ui = fixture(), visible = signal(true); ui.mount(dynamic(() => visible.get() ? h("panel", { id: "motion", style: { width: 30, height: 30 } }) : null));
  const first = ui.animate("motion", [{ opacity: 0 }, { opacity: 1 }], { duration: 10000 }); visible.set(false); ui.flush(); equal(first.playState, "idle");
  visible.set(true); ui.flush(); const second = ui.animate("motion", [{ opacity: 0 }, { opacity: 1 }], { duration: 10000 }); ui.setReducedMotion(true); ui.flush(); await Promise.resolve(); assert(second.playState === "finished" || second.playState === "idle");
});
test("runtime disposal removes listeners, subscriptions, resources and owned DOM only", () => {
  const ui = fixture(), value = signal("live"); let calls = 0;
  const sentinel = document.createElement("div"); sentinel.id = "foreign"; ui.root.parentElement.appendChild(sentinel);
  ui.mount(h("button", { id: "a", text: value, on: { activate: () => calls++ } })); const button = node(ui, "a"), root = ui.root;
  value.set("queued"); ui.dispose(); button.click(); equal(calls, 0); equal(ui.scheduler.pending, 0); equal(ui.scope.resources, 0); assert(!root.isConnected); assert(sentinel.isConnected);
});
test("late resource results cannot resurrect disposed UI", async () => {
  const ui = fixture(), resource = new Resource(ui.scope); let resolve;
  ui.mount(h("text", { text: () => resource.state.get().status })); const pending = resource.load(() => new Promise(done => { resolve = done; })); ui.dispose(); resolve("late"); await pending;
  assert(!ui.root.isConnected); equal(ui.scheduler.pending, 0);
});
test("input bridge captures menu presses but always clears old gameplay releases", () => {
  const ui = fixture(), manager = new InputManager(); let legacy = 0, clicks = 0;
  ui.mount(h("column", {}, h("button", { id: "a", text: "A", on: { activate: () => clicks++ } }), h("button", { id: "b", text: "B" })));
  manager.dispatchEvent("w", true, InputEventType.GAMEPAD, 0); assert(manager.keyMap.get("w"));
  connectInput(manager, ui, { active: () => true }); manager.addKeyListener(() => { legacy++; }); ui.focus.focus("a");
  manager.dispatchEvent("e", true, InputEventType.GAMEPAD, 0); equal(clicks, 1); equal(legacy, 0); assert(!manager.keyMap.has("e"));
  manager.dispatchEvent("w", false, InputEventType.GAMEPAD, 0); assert(!manager.keyMap.has("w")); equal(legacy, 1);
});
test("controller repeats are bounded, navigation-only, and owned by the runtime lifetime", () => {
  const ui = fixture(), manager = new InputManager(); let clicks = 0;
  ui.mount(h("column", {}, ...[0, 1, 2, 3].map(id => h("button", { id: `b${id}`, text: id, on: { activate: () => clicks++ } }))));
  connectInput(manager, ui, { active: () => true, repeatDelayMs: 300, repeatIntervalMs: 80 }); ui.focus.focus("b0");
  manager.dispatchEvent("down", true, InputEventType.GAMEPAD, 0); equal(ui.focus.current(), "b1"); ui.frame(200); equal(ui.focus.current(), "b1"); ui.frame(100); equal(ui.focus.current(), "b2");
  manager.dispatchEvent("down", false, InputEventType.GAMEPAD, 0); manager.dispatchEvent("e", true, InputEventType.GAMEPAD, 0); ui.frame(200); ui.frame(200); equal(clicks, 1);
  ui.dispose(); manager.dispatchEvent("x", true, InputEventType.GAMEPAD, 0); assert(manager.keyMap.get("x"));
});
test("keyboard typing is isolated from body gameplay listeners without suppressing keyup", () => {
  const ui = fixture(); ui.mount(h("input", { id: "name", label: "Name" })); let down = 0, up = 0;
  const keyDown = () => down++, keyUp = () => up++; document.body.addEventListener("keydown", keyDown); document.body.addEventListener("keyup", keyUp);
  try { const input = node(ui, "name"); input.focus(); input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })); input.dispatchEvent(new KeyboardEvent("keyup", { key: "a", bubbles: true })); equal(down, 0); equal(up, 1); }
  finally { document.body.removeEventListener("keydown", keyDown); document.body.removeEventListener("keyup", keyUp); }
});
test("microtask runtime repairs focus after reactive disable without explicit flush", async () => {
  const ui = fixture({ scheduling: "microtask" }), disabled = signal(false); ui.mount(h("column", {}, h("button", { id: "a", disabled, text: "A" }), h("button", { id: "b", text: "B" })));
  ui.focus.focus("a"); disabled.set(true); await Promise.resolve(); equal(ui.focus.current(), "b");
});

window.runUIFinalTests = async () => {
  const results = [];
  for (const entry of tests) {
    const start = performance.now(); let failure;
    try { await entry.run(); } catch (error) { failure = String(error.stack ?? error); }
    try { cleanup(); } catch (error) { failure = `${failure ?? ""}\nCleanup: ${error.stack ?? error}`; }
    results.push({ name: entry.name, pass: !failure, durationMs: performance.now() - start, ...(failure ? { error: failure } : {}) });
  }
  return results;
};
window.setupNativeUIFinalTest = () => {
  cleanup(); const ui = fixture(); window.nativeUIFinal = { ui, clicks: 0, captures: 0, moves: 0 };
  ui.mount(h("column", { style: { gap: 30, width: 260 } },
    h("button", { id: "native-button", text: "Activate", on: { activate: () => window.nativeUIFinal.clicks++ } }),
    h("button", { id: "drag", text: "Drag", on: { pointerDown: event => { event.capturePointer(); window.nativeUIFinal.captures++; }, pointerMove: event => { if (event.nativeEvent.buttons) window.nativeUIFinal.moves++; } } }),
    h("input", { id: "native-input", label: "Pilot name" })
  ));
};
window.cleanupUIFinalTests = cleanup;
