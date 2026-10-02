import { UIFinal, signal, computed, each, virtualList, dynamic, Panel, Button, TextInput, Text, defineHTMLComponent, extractHTMLComponent, WorldSurface, isometricSurface, Model, mountDocument, connectInput } from "../../.ui-final-build/engine/ui/final/index.js";
import { deepActiveElement } from "../../.ui-final-build/engine/ui/final/dom.js";
import { InputManager, InputEventType } from "../../.ui-final-build/engine/inputs/InputManager.js";
import { SplitFlapBillboard } from "../../.ui-final-build/examples/ui-final-airport/split-flap.js";
import { initialBillboard } from "../../.ui-final-build/examples/ui-final-airport/demo.js";
const tests = [], cleanups = [];
const test = (name, run) => tests.push({ name, run });
const assert = (v, msg = "assertion failed") => { if (!v)
    throw new Error(msg); };
const equal = (a, b, msg = "") => assert(Object.is(a, b), `${msg}: expected ${String(b)}, got ${String(a)}`);
const throws = (fn, re) => { let e; try {
    fn();
}
catch (error) {
    e = error;
} assert(e && re.test(String(e)), `expected ${re}, got ${e}`); };
const fixture = (options = {}) => { const host = document.createElement("div"); host.style.cssText = "position:relative;width:1100px;height:660px;"; document.body.append(host); const ui = new UIFinal({ host, scheduling: "manual", onError: () => { }, ...options }); cleanups.push(() => { try {
    ui.dispose();
}
finally {
    host.remove();
} }); return ui; };
const cleanup = () => { while (cleanups.length)
    cleanups.pop()(); };
const root = (ui, id = "island") => ui.element(id).shadowRoot;
const afterMutations = async () => { await Promise.resolve(); await Promise.resolve(); };
const Counter = defineHTMLComponent({ name: "test/counter", template: '<span id="value"></span><input id="edit" aria-label="Native edit"><button id="add" type="button">Add</button>', setup(ctx) { ctx.bind(() => ctx.state.get().count, value => ctx.query("#value").textContent = String(value)); ctx.listen(ctx.query("#add"), "click", () => ctx.emit("add", ctx.state.peek().count)); } });
test("HTML: state changes retain template, native input, caret and independent instances", () => {
    const ui = fixture(), a = signal({ count: 1 }), b = signal({ count: 7 });
    ui.mount(Panel({}, Counter({ id: "one", state: a }), Counter({ id: "two", state: b })));
    const one = root(ui, "one"), two = root(ui, "two"), input = one.querySelector("input"), span = one.querySelector("span");
    input.value = "edited";
    input.focus();
    input.setSelectionRange(1, 4);
    a.set({ count: 2 });
    ui.flush();
    equal(one.querySelector("span"), span);
    equal(span.textContent, "2");
    equal(two.querySelector("span").textContent, "7");
    equal(input.value, "edited");
    equal(input.selectionStart, 1);
    equal(deepActiveElement(document), input);
    assert(!document.getElementById("value"));
});
test("HTML: scoped CSS wins over engine defaults and never leaks into another island", () => {
    const ui = fixture();
    const A = defineHTMLComponent({ name: "red", template: '<button class="custom">A</button>', styles: '.custom{background:rgb(200,10,20);font-size:31px}body{background:rgb(255,0,0)}' });
    const B = defineHTMLComponent({ name: "blue", template: '<button class="custom">B</button>', styles: '.custom{background:rgb(20,30,200)}' });
    const background = getComputedStyle(document.body).backgroundColor;
    ui.mount(Panel({}, A({ id: "a", state: null }), B({ id: "b", state: null })));
    equal(getComputedStyle(root(ui, "a").querySelector("button")).backgroundColor, "rgb(200, 10, 20)");
    equal(getComputedStyle(root(ui, "a").querySelector("button")).fontSize, "31px");
    equal(getComputedStyle(root(ui, "b").querySelector("button")).backgroundColor, "rgb(20, 30, 200)");
    equal(getComputedStyle(document.body).backgroundColor, background);
});
test("HTML: per-field binding equality suppresses unrelated writes and incidental reads", () => {
    const ui = fixture(), state = signal({ a: 1, b: 2 }), other = signal(4);
    let aa = 0, bb = 0;
    const C = defineHTMLComponent({ name: "leaf", template: '<span></span>', setup(ctx) { ctx.bind(() => ctx.state.get().a, () => { other.get(); aa++; }); ctx.bind(() => ctx.state.get().b, () => bb++); } });
    ui.mount(C({ state }));
    state.set({ a: 2, b: 2 });
    ui.flush();
    equal(aa, 2);
    equal(bb, 1);
    other.set(5);
    ui.flush();
    equal(aa, 2);
});
test("HTML: static-state reconciliation and source replacement detach old dependencies", () => {
    const ui = fixture(), old = signal({ count: 1 }), next = signal({ count: 9 });
    ui.mount(Counter({ id: "island", state: old }));
    const host = ui.element("island"), input = root(ui).querySelector("input");
    ui.update(Counter({ id: "island", state: next }));
    old.set({ count: 90 });
    ui.flush();
    equal(root(ui).querySelector("span").textContent, "9");
    equal(ui.element("island"), host);
    equal(root(ui).querySelector("input"), input);
    next.set({ count: 10 });
    ui.flush();
    equal(root(ui).querySelector("span").textContent, "10");
    ui.update(Counter({ id: "island", state: { count: 11 } }));
    equal(root(ui).querySelector("span").textContent, "11");
});
test("HTML: updated event handlers are used without rerunning setup", () => {
    const ui = fixture();
    let a = 0, b = 0;
    ui.mount(Counter({ id: "island", state: { count: 3 }, events: { add: value => a += value } }));
    const button = root(ui).querySelector("button");
    button.click();
    ui.update(Counter({ id: "island", state: { count: 4 }, events: { add: value => b += value } }));
    button.click();
    equal(a, 3);
    equal(b, 4);
    equal(root(ui).querySelector("button"), button);
});
test("HTML: keyed reorder retains deep native focus and selection across shadow hosts", () => {
    const ui = fixture(), items = signal([{ id: "a", count: 1 }, { id: "b", count: 2 }]);
    ui.mount(each(items, item => item.id, item => Counter({ id: item.peek().id, state: item })));
    const input = root(ui, "b").querySelector("input");
    input.value = "abcde";
    input.focus();
    input.setSelectionRange(1, 3);
    items.set([...items.peek()].reverse());
    ui.flush();
    equal(deepActiveElement(document), input);
    equal(input.selectionStart, 1);
    equal(input.selectionEnd, 3);
    items.set([{ id: "b", count: 8 }, { id: "a", count: 1 }]);
    ui.flush();
    equal(root(ui, "b").querySelector("span").textContent, "8");
});
test("HTML: virtual lists realize offscreen shadow controls synchronously for controller focus", () => {
    const ui = fixture(), items = signal(Array.from({ length: 100 }, (_, id) => ({ id }))), C = defineHTMLComponent({ name: "virtual-cell", template: '<button id="choose" type="button">Choose</button>', styles: 'button{height:36px;width:120px}' });
    ui.mount(virtualList({ items, itemKey: item => item.id, rowHeight: 40, height: 80, overscan: 0, props: { id: "virtual" }, render: item => C({ id: `cell-${item.peek().id}`, state: item }) }));
    assert(ui.focus.focus("cell-1/choose"));
    assert(ui.focus.navigate("down"));
    equal(ui.focus.current(), "cell-2/choose");
    assert(ui.element("cell-2"));
    assert(ui.element("virtual").scrollTop > 0);
    equal(ui.errors.length, 0);
});
test("HTML: changing definition identity remounts and disposes exactly once", () => {
    const ui = fixture();
    let mounted = 0, disposed = 0;
    const create = () => defineHTMLComponent({ name: "same-name", template: '<p>Version</p>', setup() { mounted++; return () => disposed++; } });
    const A = create(), B = create();
    ui.mount(A({ key: "key", state: null }));
    ui.update(A({ key: "key", state: null }));
    equal(mounted, 1);
    ui.update(B({ key: "key", state: null }));
    equal(mounted, 2);
    equal(disposed, 1);
    ui.dispose();
    equal(disposed, 2);
});
test("HTML: host hidden/disabled/player restrictions block native application callbacks", () => {
    const ui = fixture(), disabled = signal(false), hidden = signal(false), players = signal([0]);
    let calls = 0;
    ui.mount(Counter({ id: "island", state: { count: 1 }, disabled, hidden, players, events: { add: () => calls++ } }));
    const button = root(ui).querySelector("button");
    button.click();
    equal(calls, 1);
    disabled.set(true);
    ui.flush();
    button.click();
    equal(calls, 1);
    disabled.set(false);
    hidden.set(true);
    ui.flush();
    button.click();
    equal(calls, 1);
    hidden.set(false);
    players.set([1]);
    ui.flush();
    button.click();
    equal(calls, 1);
    assert(ui.focus.focus("island/add", 1));
    ui.focus.navigate("accept", 1);
    equal(calls, 2);
});
test("HTML: native focus participates in normal Tab order across light and shadow DOM", () => {
    const ui = fixture();
    ui.mount(Panel({}, Button({ id: "before" }, "Before"), Counter({ id: "island", state: { count: 1 } }), Button({ id: "after" }, "After")));
    ui.focus.focus("before");
    ui.focus.navigate("next");
    equal(ui.focus.current(), "island/edit");
    equal(deepActiveElement(document), root(ui).querySelector("input"));
    ui.focus.navigate("next");
    equal(ui.focus.current(), "island/add");
    ui.focus.navigate("next");
    equal(ui.focus.current(), "after");
    ui.focus.navigate("previous");
    equal(ui.focus.current(), "island/add");
});
test("HTML: focus scopes and native dialogs contain shadow controls and restore focus", () => {
    const ui = fixture();
    ui.mount(Panel({}, Counter({ id: "island", state: { count: 1 }, focusScope: "component" }), Button({ id: "outside" }, "Outside")));
    ui.focus.focus("island/add");
    ui.focus.navigate("next");
    equal(ui.focus.current(), "island/edit");
    ui.focus.focus("island/add");
    const dialog = ui.openModal(Counter({ id: "modal", state: { count: 2 } }), { label: "HTML modal" });
    equal(ui.focus.current(), "modal/edit");
    assert(!ui.focus.focus("island/add"));
    ui.focus.navigate("previous");
    equal(ui.focus.current(), "modal/add");
    dialog.close();
    equal(ui.focus.current(), "island/add");
});
test("HTML: a modal owned by another runtime blocks shadow synthetic input", () => {
    const a = fixture(), b = fixture();
    let calls = 0;
    a.mount(Counter({ id: "island", state: { count: 1 }, events: { add: () => calls++ } }));
    const modal = b.openModal(Button({}, "Close"), { label: "Other runtime" });
    root(a).querySelector("button").click();
    equal(calls, 0);
    modal.close();
    root(a).querySelector("button").click();
    equal(calls, 1);
});
test("HTML: controller activation preserves native checkbox defaults and player ownership", () => {
    const ui = fixture(), manager = new InputManager();
    let checked = false, player = -1;
    const Check = defineHTMLComponent({ name: "check", template: '<input id="check" type="checkbox">', setup(ctx) { ctx.listen(ctx.query("input"), "change", event => checked = event.target.checked); } });
    ui.mount(Check({ id: "check-host", state: null, players: [1], on: { activate: event => player = event.player } }));
    connectInput(manager, ui, { active: () => true });
    assert(ui.focus.focus("check-host/check", 1));
    manager.dispatchEvent("e", true, InputEventType.GAMEPAD, 1);
    equal(checked, true);
    equal(player, 1);
    manager.dispatchEvent("e", false, InputEventType.GAMEPAD, 1);
    manager.dispatchEvent("e", true, InputEventType.GAMEPAD, 1);
    equal(checked, false);
});
test("HTML: shadow IME/typing is not intercepted as directional navigation and releases bubble", () => {
    const ui = fixture();
    ui.mount(Counter({ id: "island", state: { count: 1 } }));
    const input = root(ui).querySelector("input");
    input.focus();
    let down = 0, up = 0;
    const kd = () => down++, ku = () => up++;
    document.body.addEventListener("keydown", kd);
    document.body.addEventListener("keyup", ku);
    try {
        const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true, cancelable: true });
        input.dispatchEvent(event);
        assert(!event.defaultPrevented);
        equal(ui.focus.current(), "island/edit");
        const ime = new KeyboardEvent("keydown", { key: "Process", isComposing: true, bubbles: true, composed: true, cancelable: true });
        input.dispatchEvent(ime);
        assert(!ime.defaultPrevented);
        input.dispatchEvent(new KeyboardEvent("keyup", { key: "a", bubbles: true, composed: true }));
        equal(down, 0);
        equal(up, 1);
    }
    finally {
        document.body.removeEventListener("keydown", kd);
        document.body.removeEventListener("keyup", ku);
    }
});
test("HTML: nested UI Final children use the same scheduler, focus and lifetime", () => {
    const ui = fixture(), value = signal("hello");
    let child;
    const C = defineHTMLComponent({ name: "nested", template: '<section></section>', setup(ctx) { child = ctx.mount(ctx.query("section"), TextInput({ id: "nested-input", value })); } });
    ui.mount(C({ id: "island", state: null }));
    assert(ui.focus.focus("nested-input"));
    equal(deepActiveElement(document), ui.element("nested-input"));
    value.set("next");
    ui.flush();
    equal(ui.element("nested-input").value, "next");
    child.update(Button({ id: "nested-button" }, "Replacement"));
    ui.flush();
    assert(!ui.element("nested-input"));
    ui.update(null);
    equal(ui.focus.size, 0);
    assert(!ui.element("nested-button"));
});
test("HTML: structural control registration handles additions, renames, tabindex and removals", async () => {
    const ui = fixture();
    let context;
    const C = defineHTMLComponent({ name: "dynamic-controls", template: '<div></div>', setup(ctx) { context = ctx; } });
    ui.mount(C({ id: "island", state: null }));
    const button = document.createElement("button");
    button.id = "added";
    button.textContent = "Added";
    context.query("div").append(button);
    await afterMutations();
    assert(ui.focus.focus("island/added"));
    button.id = "renamed";
    await afterMutations();
    assert(!ui.focus.focus("island/added"));
    assert(ui.focus.focus("island/renamed"));
    button.tabIndex = -1;
    await afterMutations();
    equal(ui.focus.size, 0);
    button.remove();
    await afterMutations();
    equal(ui.focus.size, 0);
});
test("HTML: contenteditable joins focus order, negative tab stops and hidden inputs do not", () => {
    const ui = fixture(), C = defineHTMLComponent({ name: "focus-types", template: '<input type="hidden" tabindex="0"><button tabindex="-1">No</button><div id="editor" contenteditable="true">Edit</div><select id="select"><option>A</option></select>' });
    ui.mount(C({ id: "island", state: null }));
    equal(ui.focus.size, 2);
    assert(ui.focus.focus("island/editor"));
    ui.focus.navigate("next");
    equal(ui.focus.current(), "island/select");
});
test("HTML: duplicate local focus names fail without leaking host IDs or resources", () => {
    const ui = fixture(), C = defineHTMLComponent({ name: "duplicate", template: '<button id="same">One</button><button id="same">Two</button>' });
    throws(() => ui.mount(C({ id: "island", state: null })), /DUPLICATE_ID/);
    equal(ui.focus.size, 0);
    assert(!ui.element("island"));
    equal(ui.stats.created, ui.stats.disposed);
});
test("HTML: runtime animations on shadow descendants cancel with component lifetime", () => {
    const ui = fixture();
    ui.mount(Counter({ id: "island", state: { count: 1 } }));
    const span = root(ui).querySelector("span"), animation = ui.animate(span, [{ opacity: 0 }, { opacity: 1 }], { duration: 60000 });
    assert(animation.playState !== "idle");
    ui.update(null);
    equal(animation.playState, "idle");
});
test("HTML: scoped clocks, listeners and abort signals cleanly stop on removal", () => {
    const ui = fixture();
    let ticks = 0, events = 0, context, stop;
    const C = defineHTMLComponent({ name: "lifetime", template: '<button>Tick</button>', setup(ctx) { context = ctx; stop = ctx.onFrame(() => ticks++); ctx.listen(document, "custom-test", () => events++); } });
    ui.mount(C({ state: null }));
    equal(ui.frameTaskCount, 1);
    ui.frame(16);
    equal(ticks, 1);
    stop();
    equal(ui.frameTaskCount, 0);
    context.onFrame(() => ticks++);
    ui.update(null);
    assert(context.abortSignal.aborted);
    equal(ui.frameTaskCount, 0);
    document.dispatchEvent(new Event("custom-test"));
    equal(events, 0);
    ui.frame(16);
    equal(ticks, 1);
    throws(() => context.onFrame(() => ticks++), /DISPOSED/);
    equal(ui.frameTaskCount, 0);
    throws(() => context.listen(document, "custom-test", () => events++), /DISPOSED/);
    document.dispatchEvent(new Event("custom-test"));
    equal(events, 0);
});
test("HTML: setup errors dispose partial setup and leave no queued or focus resources", () => {
    const ui = fixture();
    let disposed = 0;
    const C = defineHTMLComponent({ name: "throws", template: '<button>Partial</button>', setup(ctx) { ctx.onFrame(() => { }); ctx.onCleanup(() => disposed++); ctx.bind(() => ctx.state.get(), () => { }); throw new Error("setup-error"); } });
    throws(() => ui.mount(C({ id: "island", state: signal(1) })), /setup-error/);
    equal(disposed, 1);
    equal(ui.frameTaskCount, 0);
    equal(ui.focus.size, 0);
    equal(ui.scheduler.pending, 0);
    assert(!ui.element("island"));
});
test("HTML: scripts, inline handlers, iframe, unsafe URLs and nested active templates reject before insertion", () => {
    const ui = fixture();
    window.injected = false;
    for (const template of ['<script>window.injected=true</script>', '<img src="x" onerror="window.injected=true">', '<iframe srcdoc="bad"></iframe>', '<a href="java&#x09;script:alert(1)">bad</a>', '<template><button onclick="bad()">bad</button></template>', '<div data-uif-allowed-players="0"></div>']) {
        const C = defineHTMLComponent({ name: "unsafe", template });
        throws(() => ui.mount(C({ id: "island", state: null })), /ACTIVE_CONTENT/);
        assert(!ui.element("island"));
    }
    equal(window.injected, false);
    equal(ui.focus.size, 0);
});
test("HTML: extracting a fragment from full HTML ignores external scripts but preserves CSS", () => {
    const source = '<!doctype html><html><head><style>.board{color:red}</style></head><body><div class="board"><p>Board</p></div><script>window.injected=true</script></body></html>';
    const extracted = extractHTMLComponent(source, ".board");
    assert(extracted.template.includes("Board"));
    assert(!extracted.template.includes("script"));
    equal(extracted.styles, ".board{color:red}");
    equal(window.injected, false);
    throws(() => extractHTMLComponent(source, ".missing"), /SELECTOR/);
    const ui = fixture(), C = defineHTMLComponent({ name: "extracted", ...extracted });
    ui.mount(C({ id: "island", state: null }));
    equal(root(ui).querySelector("p").textContent, "Board");
});
test("HTML: injected state text never becomes executable HTML", () => {
    const ui = fixture();
    ui.mount(Counter({ id: "island", state: { count: '<img src=x onerror=alert(1)>' } }));
    equal(root(ui).querySelectorAll("img").length, 0);
    assert(root(ui).querySelector("span").textContent.startsWith("<img"));
});
test("HTML: application template policy and style nonce are propagated, reduced motion crosses the boundary", () => {
    let calls = 0;
    const ui = fixture({ styleNonce: "test-nonce", htmlPolicy: { createHTML: source => { calls++; return source; } } });
    ui.mount(Counter({ id: "island", state: { count: 1 } }));
    equal(calls, 1);
    equal(root(ui).querySelector("style").nonce, "test-nonce");
    ui.setReducedMotion(true);
    ui.flush();
    assert(ui.element("island").hasAttribute("data-uif-reduced-motion"));
});
test("HTML: late emissions are ignored and one failing cleanup does not prevent remaining disposal", () => {
    const ui = fixture();
    let calls = 0, context, cleaned = 0;
    const C = defineHTMLComponent({ name: "cleanup", template: '<span></span>', setup(ctx) { context = ctx; ctx.onCleanup(() => cleaned++); ctx.onCleanup(() => { throw new Error("cleanup fail"); }); } });
    ui.mount(C({ state: null, events: { done: () => calls++ } }));
    throws(() => ui.update(null), /CLEANUP/);
    context.emit("done", null);
    equal(calls, 0);
    equal(cleaned, 1);
    assert(context.abortSignal.aborted);
    equal(ui.frameTaskCount, 0);
    equal(ui.stats.created, ui.stats.disposed);
});
test("HTML: document registry composes retained state and validates reload before mutation", () => {
    const ui = fixture(), model = new Model({ board: { count: 1 } });
    let result = 0;
    const make = (name = "counter") => ({ schema: "ui-final/1", root: { component: name, state: { $bind: "board" }, props: { id: "island" }, events: { add: "select" } } });
    const handle = mountDocument(ui, make(), { model, components: { counter: Counter }, componentActions: { select: value => result = value } });
    const element = ui.element("island");
    model.set("board.count", 2);
    ui.flush();
    root(ui).querySelector("button").click();
    equal(result, 2);
    assert(handle.reload(make()));
    equal(ui.element("island"), element);
    assert(!handle.reload(make("unknown")));
    equal(ui.element("island"), element);
    equal(root(ui).querySelector("span").textContent, "2");
});
test("HTML: surface pose changes retain the exact custom DOM and focus registrations", () => {
    const ui = fixture(), position = signal({ x: 0, y: 0, z: 0 }), pose = () => isometricSurface({ position: position.get(), width: 400, height: 100, camera: { origin: { x: 50, y: 50 } } });
    ui.mount(WorldSurface({ id: "surface", pose }, Counter({ id: "island", state: { count: 1 } })));
    const host = ui.element("island"), button = root(ui).querySelector("button"), previous = ui.element("surface").style.transform;
    position.set({ x: 50, y: 30, z: 20 });
    ui.flush();
    assert(ui.element("surface").style.transform !== previous);
    equal(ui.element("island"), host);
    equal(root(ui).querySelector("button"), button);
    equal(ui.focus.size, 2);
});
test("HTML: settled components have no idle bindings, mutations or animation tasks", () => {
    const ui = fixture();
    ui.mount(Counter({ id: "island", state: { count: 1 } }));
    const before = ui.scheduler.stats.executed, markup = root(ui).innerHTML;
    for (let i = 0; i < 1000; i++)
        ui.frame(16);
    equal(ui.scheduler.stats.executed, before);
    equal(root(ui).innerHTML, markup);
    equal(ui.frameTaskCount, 0);
});
const chars = element => [...element.querySelectorAll(".sf-cell")].map(cell => cell.dataset.character ?? " ").join("").trimEnd();
const settle = ui => { for (let i = 0; i < 1500 && ui.frameTaskCount; i++)
    ui.frame(16); equal(ui.frameTaskCount, 0, "flaps must eventually settle"); };
test("BILLBOARD: initial mount is settled and click emits the selected flight's stable ID", () => {
    const ui = fixture(), state = signal(initialBillboard);
    let selected;
    ui.mount(SplitFlapBillboard({ id: "board", state, events: { selectFlight: detail => selected = detail.id } }));
    const shadow = root(ui, "board");
    equal(ui.frameTaskCount, 0);
    equal(shadow.querySelectorAll(".sf-cell").length, 194, "the reserved fifth FlapRow remains mounted but hidden when timetable data is absent");
    equal(chars(shadow.querySelector(".board-title")), "SKY HARBOR");
    shadow.querySelector('[data-flight="sh218"]').click();
    equal(selected, "sh218");
});
test("BILLBOARD: an announcement uses one clock, updates only its rows and retains all cells", () => {
    const ui = fixture(), state = signal(initialBillboard);
    ui.mount(SplitFlapBillboard({ id: "board", state }));
    const shadow = root(ui, "board"), flight = shadow.querySelector(".departures"), before = flight.innerHTML, cells = [...shadow.querySelectorAll(".sf-cell")];
    state.update(value => ({ ...value, message: "GATE 7 OPEN" }));
    ui.flush();
    equal(ui.frameTaskCount, 1);
    settle(ui);
    equal(chars(shadow.querySelector(".board-message")), "GATE 7 OPEN");
    equal(flight.innerHTML, before);
    assert(cells.every((cell, index) => shadow.querySelectorAll(".sf-cell")[index] === cell));
});
test("BILLBOARD: rapid state changes coalesce to latest flap targets without per-cell timers", () => {
    const ui = fixture(), state = signal(initialBillboard);
    ui.mount(SplitFlapBillboard({ id: "board", state }));
    for (let n = 0; n < 15; n++) {
        state.update(value => ({ ...value, message: `FLIGHT ${n} READY` }));
        ui.flush();
        ui.frame(40);
        assert(ui.frameTaskCount <= 1);
    }
    state.update(value => ({ ...value, message: "FINAL GATE A12" }));
    ui.flush();
    settle(ui);
    equal(chars(root(ui, "board").querySelector(".board-message")), "FINAL GATE A12");
});
test("BILLBOARD: reduced motion snaps active flaps and power-off retains latest data without work", () => {
    const ui = fixture(), state = signal(initialBillboard);
    ui.mount(SplitFlapBillboard({ id: "board", state }));
    state.update(value => ({ ...value, message: "NEW MESSAGE" }));
    ui.flush();
    equal(ui.frameTaskCount, 1);
    ui.setReducedMotion(true);
    ui.flush();
    equal(ui.frameTaskCount, 0);
    equal(chars(root(ui, "board").querySelector(".board-message")), "NEW MESSAGE");
    ui.setReducedMotion(false);
    state.update(value => ({ ...value, message: "OFFLINE MESSAGE", powered: false }));
    ui.flush();
    equal(ui.frameTaskCount, 0);
    equal(chars(root(ui, "board").querySelector(".board-message")), "OFFLINE MESSAGE");
    assert([...root(ui, "board").querySelectorAll("button")].every(button => button.disabled));
});
test("BILLBOARD: flight reorder retains native rows and replacement data; removed rows release focus", () => {
    const ui = fixture(), state = signal(initialBillboard);
    ui.setReducedMotion(true);
    ui.mount(SplitFlapBillboard({ id: "board", state }));
    const row = root(ui, "board").querySelector('[data-flight="sh104"]');
    row.focus();
    state.update(value => ({ ...value, flights: [...value.flights].reverse().map(flight => flight.id === "sh104" ? { ...flight, destination: "TOKYO" } : flight) }));
    ui.flush();
    equal(root(ui, "board").lastElementChild.querySelector('[data-flight="sh104"]'), row);
    assert(row.getAttribute("aria-label").includes("TOKYO"));
    equal(root(ui, "board").activeElement, row);
    state.update(value => ({ ...value, flights: value.flights.filter(flight => flight.id !== "sh104") }));
    ui.flush();
    assert(!ui.focus.focus("board/flight-sh104"));
    equal(ui.focus.size, 3);
});
test("BILLBOARD: independent instances share definitions, not state, DOM or animation work", () => {
    const ui = fixture(), a = signal(initialBillboard), b = signal({ ...initialBillboard, message: "OTHER BOARD" });
    ui.mount(Panel({}, SplitFlapBillboard({ id: "a", state: a }), SplitFlapBillboard({ id: "b", state: b })));
    a.update(value => ({ ...value, message: "FIRST BOARD" }));
    ui.flush();
    settle(ui);
    equal(chars(root(ui, "a").querySelector(".board-message")), "FIRST BOARD");
    equal(chars(root(ui, "b").querySelector(".board-message")), "OTHER BOARD");
    equal(ui.focus.size, 8);
});
test("BILLBOARD: removing an animating component cancels its one task and pending bindings", () => {
    const ui = fixture(), state = signal(initialBillboard);
    ui.mount(SplitFlapBillboard({ id: "board", state }));
    state.update(value => ({ ...value, message: "UPDATING" }));
    ui.flush();
    ui.frame(40);
    equal(ui.frameTaskCount, 1);
    const host = ui.element("board");
    ui.update(null);
    const before = host.shadowRoot.innerHTML;
    equal(ui.frameTaskCount, 0);
    equal(ui.focus.size, 0);
    state.set(initialBillboard);
    ui.frame(100);
    equal(host.shadowRoot.innerHTML, before);
    equal(ui.scheduler.pending, 0);
});
// Text equality alone cannot detect a clipped/cullable face or a stale compositor layer.
const assertRestingFlaps = (ui, id = "board") => {
    const shadow = root(ui, id);
    equal(ui.frameTaskCount, 0, "settled board must release its clock");
    equal(shadow.querySelector(".billboard").dataset.animatedCells, "0");
    for (const cell of shadow.querySelectorAll(".sf-cell")) {
        for (const face of cell.querySelectorAll(".sf-half:not(.sf-flap)")) {
            equal(face.querySelector(".sf-glyph").textContent, cell.dataset.character, "both fixed faces must contain the committed character, including spaces");
            equal(getComputedStyle(face).backfaceVisibility, "visible", "fixed faces must not use 3D backface culling");
            equal(getComputedStyle(face).transform, "none");
            equal(getComputedStyle(face.querySelector(".sf-shade")).opacity, "0");
        }
        for (const flap of cell.querySelectorAll(".sf-flap")) {
            assert(flap.hidden, "inactive moving faces must be removed from rendering, not only visibility-hidden");
            equal(getComputedStyle(flap).display, "none");
            equal(flap.style.transform, "", "settling must remove the old 3D matrix");
            equal(flap.style.willChange, "", "settling must release promotion hints");
            equal(getComputedStyle(flap.querySelector(".sf-shade")).opacity, "0");
        }
    }
};
test("BILLBOARD RENDER: cold mount and normal completion use only flat fixed faces", () => {
    const ui = fixture(), state = signal(initialBillboard);
    ui.mount(SplitFlapBillboard({ id: "board", state }));
    assertRestingFlaps(ui);
    state.update(value => ({ ...value, title: "DEPARTURES", message: "GATE 7 OPEN", flights: value.flights.map(flight => ({ ...flight, destination: "TOKYO", status: "DELAYED" })) }));
    ui.flush();
    ui.frame(16);
    const moving = root(ui, "board").querySelectorAll(".sf-flap:not([hidden])");
    assert(moving.length > 0, "moving overlays must still render during animation");
    assert([...moving].every(flap => getComputedStyle(flap).backfaceVisibility === "hidden"));
    settle(ui);
    assertRestingFlaps(ui);
    equal(chars(root(ui, "board").querySelector(".board-title")), "DEPARTURES");
});
test("BILLBOARD RENDER: reduced motion and power-off clear both animation phases", () => {
    for (const elapsed of [16, 56]) {
        for (const mode of ["reduced-motion", "power-off"]) {
            const ui = fixture(), state = signal(initialBillboard);
            ui.mount(SplitFlapBillboard({ id: "board", state }));
            state.update(value => ({ ...value, title: "ZZZZZZZZZZ", message: "CHANGED" }));
            ui.flush();
            ui.frame(elapsed);
            const cell = root(ui, "board").querySelector(".board-title .sf-cell");
            assert(cell.querySelector(elapsed < 40 ? ".sf-top.sf-flap" : ".sf-bottom.sf-flap").getClientRects().length > 0, "the selected physical phase must really have started");
            if (mode === "reduced-motion") ui.setReducedMotion(true);
            else state.update(value => ({ ...value, powered: false }));
            ui.flush();
            assertRestingFlaps(ui);
            equal(chars(root(ui, "board").querySelector(".board-title")), "ZZZZZZZZZZ");
        }
    }
});
test("BILLBOARD RENDER: retarget to the just-landed character releases transient layers", () => {
    const ui = fixture(), state = signal({ ...initialBillboard, title: "A" });
    ui.mount(SplitFlapBillboard({ id: "board", state }));
    state.update(value => ({ ...value, title: "Z" }));
    ui.flush();
    ui.frame(80); // One physical flap lands on B, with more drum steps still queued.
    equal(chars(root(ui, "board").querySelector(".board-title")), "B");
    state.update(value => ({ ...value, title: "B" }));
    ui.flush();
    ui.frame(16);
    assertRestingFlaps(ui);
    const before = root(ui, "board").innerHTML;
    for (let n = 0; n < 1000; n++) ui.frame(16);
    equal(root(ui, "board").innerHTML, before, "idle frames must not repaint to conceal the artifact");
});
test("BILLBOARD: malformed flight state is reported before rows are partially changed", () => {
    const ui = fixture(), state = signal(initialBillboard);
    ui.mount(SplitFlapBillboard({ id: "board", state }));
    const before = root(ui, "board").querySelector(".departures").innerHTML;
    state.update(value => ({ ...value, flights: [value.flights[0], value.flights[0]] }));
    ui.flush();
    equal(ui.errors.length, 1);
    equal(root(ui, "board").querySelector(".departures").innerHTML, before);
    equal(ui.frameTaskCount, 0);
});
test("BILLBOARD TIMETABLE: legacy flights keep four visible columns when time is omitted", () => {
    const ui = fixture(), state = signal({ ...initialBillboard, flights: [{ id: "legacy", flight: "SH101", destination: "OSLO", gate: "A01", status: "ON TIME" }] });
    ui.setReducedMotion(true);
    ui.mount(SplitFlapBillboard({ id: "board", state }));
    const host = ui.element("board"), shadow = root(ui, "board"), heading = shadow.querySelector(".headings"), row = shadow.querySelector(".flight-row");
    equal(host.dataset.timetable, "off");
    equal(getComputedStyle(heading.querySelector(".time")).display, "none");
    equal(getComputedStyle(row.lastElementChild).display, "none");
    equal(getComputedStyle(heading).gridTemplateColumns.split(" ").length, 4);
    equal(getComputedStyle(row).gridTemplateColumns.split(" ").length, 4);
    equal(row.getAttribute("aria-label"), "SH101, OSLO, gate A01, ON TIME");
});
test("BILLBOARD TIMETABLE: scheduled flight shows a fifth time column and accessible EARLY status", () => {
    const ui = fixture(), state = signal({ ...initialBillboard, flights: [{ id: "timed", flight: "SH101", destination: "OSLO", gate: "A01", status: "EARLY", time: "09:40" }] });
    ui.setReducedMotion(true);
    ui.mount(SplitFlapBillboard({ id: "board", state }));
    const host = ui.element("board"), shadow = root(ui, "board"), heading = shadow.querySelector(".headings"), row = shadow.querySelector(".flight-row");
    equal(host.dataset.timetable, "on");
    equal(heading.lastElementChild.textContent, "TIME");
    assert(getComputedStyle(heading.lastElementChild).display !== "none", "TIME heading must be visible with timetable data");
    equal(getComputedStyle(heading).gridTemplateColumns.split(" ").length, 5);
    equal(getComputedStyle(row).gridTemplateColumns.split(" ").length, 5);
    equal(chars(row.querySelector(".status")), "EARLY");
    equal(chars(row.querySelector(".time")), "09:40");
    equal(row.getAttribute("aria-label"), "SH101, OSLO, gate A01, EARLY, 09:40");
});
test("BILLBOARD TIMETABLE: full EARLY DEPARTURE status uses 15 cells without crossing into TIME", () => {
    const ui = fixture(), state = signal({ ...initialBillboard, flights: [
        { id: "early", flight: "SH101", destination: "OSLO", gate: "A01", status: "EARLY DEPARTURE", time: "09:45" },
        { id: "boarding", flight: "SH102", destination: "PARIS", gate: "A02", status: "BOARDING", time: "10:00" },
    ] });
    ui.setReducedMotion(true);
    ui.mount(SplitFlapBillboard({ id: "board", state }));
    const shadow = root(ui, "board"), rows = [...shadow.querySelectorAll(".flight-row")];
    const early = rows.find(row => row.dataset.status === "EARLY DEPARTURE");
    const boarding = rows.find(row => row.dataset.status === "BOARDING");
    assert(early && boarding, "both long departure statuses must render");
    const status = early.querySelector(".status"), time = early.querySelector(".time");
    equal(chars(status), "EARLY DEPARTURE");
    equal(status.querySelectorAll(".sf-cell").length, 15);
    equal(chars(boarding.querySelector(".status")), "BOARDING");
    const statusColumn = status.getBoundingClientRect(), timeColumn = time.getBoundingClientRect();
    assert(statusColumn.right <= timeColumn.left + 1,
        `EARLY DEPARTURE overlaps the TIME column: ${JSON.stringify({ status: statusColumn.toJSON(), time: timeColumn.toJSON() })}`);
    const cells = [...status.querySelectorAll(".sf-cell")];
    assert(cells.every(cell => getComputedStyle(cell).display !== "none"), "all 15 EARLY DEPARTURE glyphs must be visible");
    assert(cells.at(-1).getBoundingClientRect().right <= statusColumn.right + 1,
        "the final EARLY DEPARTURE glyph must stay inside its status column");
    equal(early.getAttribute("aria-label"), "SH101, OSLO, gate A01, EARLY DEPARTURE, 09:45");
});
test("BILLBOARD TIMETABLE: nonstring time reports a state error without changing the board", () => {
    const ui = fixture(), state = signal({ ...initialBillboard, flights: [{ id: "timed", flight: "SH101", destination: "OSLO", gate: "A01", status: "EARLY", time: "09:40" }] });
    ui.setReducedMotion(true);
    ui.mount(SplitFlapBillboard({ id: "board", state }));
    const before = root(ui, "board").querySelector(".departures").innerHTML;
    state.update(value => ({ ...value, flights: [{ ...value.flights[0], time: 940 }] }));
    ui.flush();
    equal(ui.errors.length, 1);
    assert(/SPLIT_FLAP_STATE: time must be a string/.test(String(ui.errors[0])));
    equal(root(ui, "board").querySelector(".departures").innerHTML, before);
    equal(ui.element("board").dataset.timetable, "on");
    equal(ui.frameTaskCount, 0);
});
window.runUIFinalHTMLTests = async () => { const results = []; for (const entry of tests) {
    let error;
    const start = performance.now();
    try {
        await entry.run();
    }
    catch (e) {
        error = String(e.stack ?? e);
    }
    try {
        cleanup();
    }
    catch (e) {
        error = `${error ?? ""}\nCleanup: ${e.stack ?? e}`;
    }
    results.push({ name: entry.name, pass: !error, durationMs: performance.now() - start, ...(error ? { error } : {}) });
} return results; };
window.setupNativeHTMLTest = () => { cleanup(); const ui = fixture(); window.nativeHTML = { ui, clicks: 0, inputEvents: 0, pointerMoves: 0, captures: 0 }; const C = defineHTMLComponent({ name: "native-test", template: '<input id="edit" aria-label="Shadow edit"><button id="button" type="button">Shadow action</button><button id="drag" type="button">Shadow drag</button>', styles: 'button,input{display:block;margin:25px;width:210px;padding:14px;font-size:16px}', setup(ctx) { ctx.listen(ctx.query("#button"), "click", () => window.nativeHTML.clicks++); ctx.listen(ctx.query("#edit"), "input", () => window.nativeHTML.inputEvents++); ctx.listen(ctx.query("#drag"), "pointerdown", event => { event.currentTarget.setPointerCapture(event.pointerId); window.nativeHTML.captures++; }); ctx.listen(ctx.query("#drag"), "pointermove", event => { if (event.buttons)
        window.nativeHTML.pointerMoves++; }); } }); ui.mount(Panel({}, Button({ id: "native-before" }, "Before"), C({ id: "native-html", state: null }), Button({ id: "native-after" }, "After"))); };
window.cleanupHTMLTests = cleanup;
// Invoked by the runner in a separate document with Trusted Types enforcement enabled.
window.runTrustedHTMLTest = () => {
    assert(globalThis.trustedTypes, "Chromium Trusted Types support expected");
    let created = 0;
    const policy = trustedTypes.createPolicy("ui-final-html-test", { createHTML: source => { created++; return source; } });
    const ui = fixture({ htmlPolicy: policy });
    try {
        const state = signal({ count: 1 });
        ui.mount(Counter({ id: "island", state }));
        state.set({ count: 42 });
        ui.flush();
        equal(root(ui).querySelector("span").textContent, "42");
        equal(created, 1);
        const noPolicy = fixture();
        throws(() => noPolicy.mount(Counter({ state: { count: 1 } })), /TrustedHTML|Trusted Types/);
    }
    finally {
        cleanup();
    }
};
