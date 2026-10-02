import { HTMLInstance, type HTMLNode, type HTMLPolicy } from "./html";
import { composedContains, deepActiveElement, eventElement, eventPlayer, composedClosest } from "./dom";
import { computed, effect, read, Scope, signal, untrack, type Dispose, type Readable, type Scheduler, type Signal, type Value } from "./reactive";
import type { Child, Direction, EachNode, ElementNode, EventHandlers, Key, Props, StyleValue, TextNode, UIEvent, UIEventType, VNode, VirtualNode } from "./nodes";
import { FocusManager } from "./focus";
import { cssName, cssValue } from "./theme";

export interface RenderStats {
  created: number;
  disposed: number;
  propertyWrites: number;
  textWrites: number;
  moves: number;
  realizedRows: number;
  peakRows: number;
}
export interface RenderContext {
  document: Document;
  scheduler: Scheduler;
  focus: FocusManager;
  stats: RenderStats;
  ids: Map<string, HTMLElement>;
  lifetimes: WeakMap<HTMLElement, Scope>;
  nextId(): string;
  report(error: unknown): void;
  reducedMotion: Readable<boolean>;
  styleNonce?: string;
  htmlPolicy?: HTMLPolicy;
  addFrameTask(task: (dtMs: number) => void): Dispose;
}
interface Block {
  spec: VNode;
  first: Node;
  last: Node;
  scope: Scope;
  patch(spec: VNode): void;
  dispose(): void;
}
const tags: Record<ElementNode["type"], string> = {
  panel: "div", row: "div", column: "div", grid: "div", text: "span", button: "button", input: "input",
  textarea: "textarea", image: "img", scroll: "div", progress: "progress", slider: "input", toggle: "input",
};
const nativeFocusable = new Set(["button", "input", "textarea", "slider", "toggle"]);
const leafTypes = new Set(["input", "textarea", "image", "progress", "slider", "toggle"]);
const attributeMap: Record<string, string> = { label: "aria-label", describedBy: "aria-describedby", autoComplete: "autocomplete" };
const propertyKeys = new Set(["value", "checked", "indeterminate", "disabled", "hidden", "readOnly", "placeholder", "title", "lang", "dir", "alt", "min", "max", "step", "maxLength", "name"]);
const booleanKeys = new Set(["checked", "indeterminate", "disabled", "hidden", "readOnly"]);
const eventNames: Record<UIEventType, readonly string[]> = {
  activate: ["click", "uif-activate"], input: ["input"], change: ["change"], submit: ["submit"], cancel: ["uif-cancel"],
  focus: ["focusin"], blur: ["focusout"], pointerDown: ["pointerdown"], pointerUp: ["pointerup"], pointerMove: ["pointermove"],
  pointerCancel: ["pointercancel"], keyDown: ["keydown"], keyUp: ["keyup"],
};
export function validateKey(key: unknown): asserts key is Key {
  if ((typeof key !== "string" && typeof key !== "number") || typeof key === "number" && !Number.isFinite(key)) {
    throw new Error("UIF_KEY: keys must be strings or finite numbers");
  }
}
export function keyedItems<T>(items: readonly T[], itemKey: (item: T, index: number) => Key): { keys: Key[]; indices: Map<Key, number> } {
  if (!Array.isArray(items)) throw new Error("UIF_ITEMS: expected an array");
  const keys: Key[] = [];
  const indices = new Map<Key, number>();
  items.forEach((item, index) => {
    const key = itemKey(item, index);
    validateKey(key);
    if (indices.has(key)) throw new Error(`UIF_DUPLICATE_KEY: ${String(key)}`);
    indices.set(key, index);
    keys.push(key);
  });
  return { keys, indices };
}
export function visibleRange(count: number, offset: number, height: number, rowHeight: number, overscan = 2): { start: number; end: number; offset: number } {
  if (!Number.isInteger(count) || count < 0 || !Number.isFinite(offset) || !Number.isFinite(height) || height < 0 ||
    !Number.isFinite(rowHeight) || rowHeight <= 0 || !Number.isInteger(overscan) || overscan < 0 || overscan > 100) {
    throw new Error("UIF_VIRTUAL_RANGE: invalid count, dimensions, or overscan (0..100)");
  }
  const clamped = Math.max(0, Math.min(offset, Math.max(0, count * rowHeight - height)));
  return { start: Math.max(0, Math.floor(clamped / rowHeight) - overscan), end: Math.min(count, Math.ceil((clamped + height) / rowHeight) + overscan), offset: clamped };
}
function normalize(children: readonly Child[], output: VNode[] = []): VNode[] {
  for (const child of children) {
    if (Array.isArray(child)) normalize(child, output);
    else if (child === null || child === undefined || typeof child === "boolean") continue;
    else if (typeof child === "string" || typeof child === "number") output.push({ kind: "text", value: child });
    else output.push(child as VNode);
  }
  return output;
}
function compatible(block: Block, spec: VNode): boolean {
  return block.spec.kind === spec.kind && block.spec.key === spec.key &&
    (spec.kind !== "element" || (block.spec as ElementNode).type === spec.type) &&
    (spec.kind !== "html" || (block.spec as HTMLNode).definition === spec.definition);
}
function moveBefore(block: Pick<Block, "first" | "last">, parent: Node, before: Node | null, stats: RenderStats): void {
  if (block.last.nextSibling === before && block.first.parentNode === parent) return;
  const stop = block.last.nextSibling;
  let node: Node | null = block.first;
  while (node && node !== stop) {
    const next: Node | null = node.nextSibling;
    parent.insertBefore(node, before);
    node = next;
  }
  stats.moves++;
}
function removeRange(block: Block): void {
  const stop = block.last.nextSibling;
  let node: Node | null = block.first;
  while (node && node !== stop) {
    const next: Node | null = node.nextSibling;
    node.parentNode?.removeChild(node);
    node = next;
  }
}

/** A retained child range. Public update is the hot-reload/reconciliation seam. */
export class View {
  private blocks: Block[] = [];
  private dead = false;
  readonly start: Comment;
  readonly end: Comment;
  readonly scope: Scope;
  constructor(readonly parent: Node, before: Node | null, readonly context: RenderContext, parentScope?: Scope) {
    this.scope = new Scope(parentScope);
    this.start = context.document.createComment("uif:start");
    this.end = context.document.createComment("uif:end");
    parent.insertBefore(this.start, before);
    parent.insertBefore(this.end, before);
    this.scope.add(() => { this.dead = true; this.blocks = []; this.start.remove(); this.end.remove(); });
  }
  update(child: Child): void {
    if (this.dead || this.scope.disposed) throw new Error("UIF_VIEW_DISPOSED");
    const specs = normalize([child]);
    const seen = new Set<Key>();
    for (const spec of specs) if (spec.key !== undefined) {
      validateKey(spec.key);
      if (seen.has(spec.key)) throw new Error(`UIF_DUPLICATE_KEY: ${String(spec.key)}`);
      seen.add(spec.key);
    }
    const keyed = new Map<Key, Block>();
    this.blocks.forEach(block => { if (block.spec.key !== undefined) keyed.set(block.spec.key, block); });
    const used = new Set<Block>();
    const next: Block[] = [];
    const active = deepActiveElement(this.context.document);
    // Validate all keys before the first mutation. A throwing application component is not a DOM transaction.
    try {
      specs.forEach((spec, index) => {
        const candidate = spec.key === undefined ? this.blocks[index] : keyed.get(spec.key);
        let block: Block;
        if (candidate && !used.has(candidate) && compatible(candidate, spec)) {
          block = candidate;
          block.patch(spec);
          used.add(candidate);
        } else block = createBlock(spec, this.parent, this.end, this.context, this.scope);
        next.push(block);
      });
    } catch (error) {
      // Uncommitted newly-created blocks cannot leak subscriptions or DOM nodes.
      next.filter(block => !this.blocks.includes(block)).forEach(block => block.dispose());
      throw error;
    }
    for (const block of this.blocks) if (!used.has(block)) block.dispose();
    let before: Node = this.end;
    for (let index = next.length - 1; index >= 0; index--) {
      moveBefore(next[index], this.parent, before, this.context.stats);
      before = next[index].first;
    }
    this.blocks = next;
    if (active && active.isConnected && deepActiveElement(this.context.document) !== active && composedContains(this.parent, active)) {
      active.focus({ preventScroll: true });
    }
  }
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    this.scope.dispose();
  }
}
function createBlock(spec: VNode, parent: Node, before: Node, context: RenderContext, parentScope: Scope): Block {
  if (spec.kind === "html") return new HTMLBlock(spec, parent, before, context, parentScope);
  if (spec.kind === "element") return new ElementBlock(spec, parent, before, context, parentScope);
  if (spec.kind === "text") return new TextBlock(spec, parent, before, context, parentScope);
  if (spec.kind === "dynamic") return new DynamicBlock(spec, parent, before, context, parentScope);
  if (spec.kind === "each") return new EachBlock(spec, parent, before, context, parentScope);
  if (spec.kind === "virtual") return new VirtualBlock(spec, parent, before, context, parentScope);
  throw new Error("UIF_NODE: unknown node kind");
}
class TextBlock implements Block {
  first: globalThis.Text;
  last: globalThis.Text;
  scope: Scope;
  private disposeBinding?: Dispose;
  constructor(public spec: TextNode, parent: Node, before: Node, private ctx: RenderContext, owner: Scope) {
    this.scope = new Scope(owner);
    this.first = this.last = ctx.document.createTextNode("");
    parent.insertBefore(this.first, before);
    ctx.stats.created++;
    this.scope.add(() => { this.first.remove(); ctx.stats.disposed++; });
    try { this.bind(); } catch (error) { this.scope.dispose(); throw error; }
  }
  private bind(): void {
    this.disposeBinding?.();
    this.disposeBinding = effect(() => {
      const value = String(read(this.spec.value) ?? "");
      if (this.first.data !== value) { this.first.data = value; this.ctx.stats.textWrites++; }
    }, { scheduler: this.ctx.scheduler, scope: this.scope, name: "text" });
  }
  patch(spec: VNode): void {
    const previous = this.spec;
    this.spec = spec as TextNode;
    if (previous.value !== this.spec.value) this.bind();
  }
  dispose(): void { this.scope.dispose(); }
}

function safeImageURL(value: unknown): string {
  const string = String(value ?? "").trim();
  if (/[\u0000-\u001f\u007f]/.test(string)) throw new Error("UIF_URL: control characters are forbidden");
  if (/^data:/i.test(string) && !/^data:image\/(png|jpeg|gif|webp|avif);base64,/i.test(string)) throw new Error("UIF_URL: only raster data images are allowed");
  if (/^[a-z][\w+.-]*:/i.test(string) && !/^(https?:|blob:|data:)/i.test(string)) throw new Error("UIF_URL: unsupported image protocol");
  return string;
}
function eventContext(type: UIEventType, nativeEvent: Event, element: HTMLElement): UIEvent {
  const control = eventElement(nativeEvent) as HTMLInputElement | null;
  const pointer = nativeEvent as PointerEvent;
  return {
    type, nativeEvent, player: eventPlayer(nativeEvent),
    target: control, currentTarget: element,
    value: control && "value" in control ? String(control.value) : "",
    checked: !!control && "checked" in control && !!control.checked,
    isComposing: !!(nativeEvent as InputEvent).isComposing || element.dataset.uifComposing === "true",
    preventDefault: () => nativeEvent.preventDefault(), stopPropagation: () => nativeEvent.stopPropagation(),
    stopImmediatePropagation: () => nativeEvent.stopImmediatePropagation(),
    capturePointer: () => { if (Number.isInteger(pointer.pointerId)) element.setPointerCapture?.(pointer.pointerId); },
    releasePointer: () => { if (Number.isInteger(pointer.pointerId) && element.hasPointerCapture?.(pointer.pointerId)) element.releasePointerCapture(pointer.pointerId); },
  };
}
class ElementBlock implements Block {
  first: HTMLElement;
  last: HTMLElement;
  scope: Scope;
  private children?: View;
  private bindings = new Map<string, { source: unknown; dispose: Dispose; clear: Dispose }>();
  private eventScope?: Scope;
  private previousOn?: EventHandlers;
  private previousCapture?: EventHandlers;
  private releaseFocus?: Dispose;
  private currentId = "";
  private registered = false;
  private currentRef?: Props["ref"];
  private composing = false;
  private boundValue?: Signal<string>;
  private boundChecked?: Signal<boolean>;
  constructor(public spec: ElementNode, parent: Node, before: Node, private ctx: RenderContext, owner: Scope) {
    this.scope = new Scope(owner);
    if (!tags[spec.type]) throw new Error(`UIF_NODE: unsupported type ${spec.type}`);
    this.first = this.last = ctx.document.createElement(tags[spec.type]);
    this.first.dataset.uifNode = spec.type;
    ctx.lifetimes.set(this.first, this.scope);
    if (spec.type === "button") (this.first as HTMLButtonElement).type = "button";
    if (spec.type === "slider") (this.first as HTMLInputElement).type = "range";
    if (spec.type === "toggle") (this.first as HTMLInputElement).type = "checkbox";
    if (spec.type === "progress") (this.first as HTMLProgressElement).max = 1;
    if (spec.type === "image") (this.first as HTMLImageElement).alt = "";
    parent.insertBefore(this.first, before);
    ctx.stats.created++;
    this.scope.add(() => {
      this.releaseFocus?.();
      if (this.currentId) ctx.ids.delete(this.currentId);
      this.first.remove();
      ctx.stats.disposed++;
    });
    this.scope.add(() => this.currentRef?.(null));
    this.listen("compositionstart", () => { this.composing = true; this.first.dataset.uifComposing = "true"; });
    this.listen("compositionend", () => {
      this.composing = false;
      delete this.first.dataset.uifComposing;
      this.boundValue?.set((this.first as HTMLInputElement).value);
      // Browser compositionend/final input ordering differs. Read the latest model after both events.
      queueMicrotask(() => {
        if (this.scope.disposed || this.composing) return;
        const value = this.boundValue ?? this.spec.props.value;
        if (value !== undefined) this.setProperty("value", untrack(() => read(value)));
      });
    });
    this.listen("input", () => {
      if (!this.composing) this.boundValue?.set((this.first as HTMLInputElement).value);
    });
    this.listen("change", () => this.boundChecked?.set((this.first as HTMLInputElement).checked));
    // Semantic buttons, toggles and sliders respond to controller accept through the same native click path.
    this.listen("uif-activate", event => {
      if ((spec.type === "toggle" || spec.type === "input" || spec.type === "textarea") && this.ctx.focus.allows(this.first, (event as CustomEvent).detail?.player ?? 0)) {
        if (spec.type === "toggle") {
          const input = this.first as HTMLInputElement;
          input.checked = !input.checked;
          this.boundChecked?.set(input.checked);
          input.dispatchEvent(new this.ctx.document.defaultView!.CustomEvent("change", { bubbles: true, detail: { player: (event as CustomEvent).detail?.player ?? 0 } }));
        } else this.first.focus();
      }
    });
    try {
      this.applyProps();
      this.updateChildren();
    } catch (error) { this.scope.dispose(); throw error; }
  }
  private listen(type: string, listener: EventListener): void {
    this.first.addEventListener(type, listener);
    this.scope.add(() => this.first.removeEventListener(type, listener));
  }
  private bind(key: string, source: unknown, set: (value: any) => void, clear: Dispose): void {
    const previous = this.bindings.get(key);
    if (previous && previous.source === source) return;
    previous?.dispose();
    const dispose = effect(() => set(read(source)), { scheduler: this.ctx.scheduler, scope: this.scope, name: `${this.currentId}.${key}` });
    this.bindings.set(key, { source, dispose, clear });
  }
  private writeAttribute(key: string, value: unknown): void {
    const string = value === null || value === undefined ? null : String(value);
    if (this.first.getAttribute(key) === string) return;
    if (string === null) this.first.removeAttribute(key); else this.first.setAttribute(key, string);
    this.ctx.stats.propertyWrites++;
  }
  private setProperty(key: string, value: unknown): void {
    if (key === "text") {
      const text = String(value ?? "");
      if (this.first.textContent !== text) { this.first.textContent = text; this.ctx.stats.textWrites++; }
      return;
    }
    if (key === "src") { this.writeAttribute("src", value === undefined ? undefined : safeImageURL(value)); return; }
    if (key === "value" && this.composing) return;
    if (key === "disabled" && !("disabled" in this.first)) { this.writeAttribute("aria-disabled", value ? true : null); return; }
    if (key === "class") { this.writeAttribute("class", value || null); return; }
    if (key === "interactive") { this.first.style.pointerEvents = value ? "auto" : ""; return; }
    if (key === "focusScope") { this.writeAttribute("data-uif-focus-scope", value); return; }
    if (propertyKeys.has(key) && key in this.first) {
      const next = booleanKeys.has(key) ? !!value : key === "value" ? String(value ?? "") : value ?? "";
      if ((this.first as any)[key] !== next) { (this.first as any)[key] = next; this.ctx.stats.propertyWrites++; }
      if (key === "disabled") this.writeAttribute("aria-disabled", next ? true : null);
    } else this.writeAttribute(attributeMap[key] ?? key, value);
  }
  private applyProps(): void {
    const props = this.spec.props;
    if (props.text !== undefined && this.spec.children.length) throw new Error("UIF_CHILDREN: text prop and children are mutually exclusive");
    if (props.bindValue && props.value !== undefined || props.bindChecked && props.checked !== undefined) throw new Error("UIF_BIND: use a binding OR a value prop, not both");
    const id = props.id ?? (this.currentId || this.ctx.nextId());
    if (id !== this.currentId) {
      if (this.ctx.ids.has(id)) throw new Error(`UIF_DUPLICATE_ID: ${id}`);
      if (this.currentId) this.ctx.ids.delete(this.currentId);
      this.ctx.ids.set(id, this.first);
      this.releaseFocus?.(); this.releaseFocus = undefined; this.registered = false;
      this.currentId = id;
      this.first.dataset.uifId = id;
    }
    const focusable = props.focusable ?? nativeFocusable.has(this.spec.type);
    this.first.tabIndex = focusable ? 0 : -1;
    if (focusable && !this.registered) {
      this.releaseFocus = this.ctx.focus.register({ id, element: this.first,
        players: () => this.spec.props.players === undefined ? undefined : read(this.spec.props.players),
        navigation: () => this.spec.props.navigation ?? {},
      });
      this.registered = true;
    } else if (!focusable && this.registered) {
      this.releaseFocus?.(); this.releaseFocus = undefined; this.registered = false;
    }
    if (props.autoFocus) queueMicrotask(() => { if (!this.scope.disposed) this.ctx.focus.focus(this.currentId); });
    this.boundValue = props.bindValue;
    this.boundChecked = props.bindChecked;
    const retained = new Set<string>();
    if (props.players !== undefined) {
      retained.add("players");
      this.bind("players", props.players, players => {
        if (players !== undefined && (!Array.isArray(players) || players.some((player: unknown) => !Number.isInteger(player) || Number(player) < 0))) throw new Error("UIF_PLAYER: invalid ownership list");
        this.writeAttribute("data-uif-allowed-players", players?.join(" "));
      }, () => this.writeAttribute("data-uif-allowed-players", undefined));
    }
    for (const [key, source] of Object.entries(props)) {
      if (["key", "id", "style", "attrs", "on", "onCapture", "ref", "autoFocus", "focusable", "players", "navigation", "bindValue", "bindChecked"].includes(key)) continue;
      const actual = key === "inputType" ? "type" : key;
      retained.add(key);
      this.bind(key, source, value => this.setProperty(actual, value), () => this.setProperty(actual, undefined));
    }
    if (props.bindValue) { retained.add("value"); this.bind("value", props.bindValue, value => this.setProperty("value", value), () => {}); }
    if (props.bindChecked) { retained.add("checked"); this.bind("checked", props.bindChecked, value => this.setProperty("checked", value), () => {}); }
    for (const [key, source] of Object.entries(props.style ?? {})) {
      const name = cssName(key);
      const bindingKey = `style:${name}`;
      retained.add(bindingKey);
      this.bind(bindingKey, source, value => {
        const string = cssValue(key, value as StyleValue);
        if (this.first.style.getPropertyValue(name) !== string) {
          if (!string) this.first.style.removeProperty(name); else this.first.style.setProperty(name, string);
          this.ctx.stats.propertyWrites++;
        }
      }, () => { this.first.style.removeProperty(name); this.ctx.stats.propertyWrites++; });
    }
    for (const [key, source] of Object.entries(props.attrs ?? {})) {
      if (!/^(aria|data)-[a-z][a-z0-9-]*$/.test(key) || key.startsWith("data-uif-")) throw new Error(`UIF_ATTRIBUTE: unsupported or reserved ${key}`);
      const bindingKey = `attr:${key}`;
      retained.add(bindingKey);
      this.bind(bindingKey, source, value => this.writeAttribute(key, value), () => this.writeAttribute(key, null));
    }
    for (const [key, binding] of this.bindings) if (!retained.has(key)) {
      binding.dispose(); binding.clear(); this.bindings.delete(key);
    }
    if (props.on !== this.previousOn || props.onCapture !== this.previousCapture) {
      this.eventScope?.dispose();
      this.eventScope = new Scope(this.scope);
      this.previousOn = props.on; this.previousCapture = props.onCapture;
      for (const [handlers, capture] of [[props.on, false], [props.onCapture, true]] as const) {
        for (const [type, handler] of Object.entries(handlers ?? {}) as [UIEventType, (event: UIEvent) => void][]) {
          if (!eventNames[type]) throw new Error(`UIF_EVENT: ${type}`);
          for (const nativeName of eventNames[type]) {
            const listener = (native: Event) => {
              const event = eventContext(type, native, this.first);
              if (!this.ctx.focus.allows(this.first, event.player)) return;
              try { handler(event); } catch (error) { this.ctx.report(error); }
            };
            this.first.addEventListener(nativeName, listener, capture);
            this.eventScope.add(() => this.first.removeEventListener(nativeName, listener, capture));
          }
        }
      }
    }
    if (props.ref !== this.currentRef) {
      this.currentRef?.(null); this.currentRef = props.ref; this.currentRef?.(this.first);
    }
  }
  private updateChildren(): void {
    if (this.spec.props.text !== undefined) { this.children?.dispose(); this.children = undefined; return; }
    if (leafTypes.has(this.spec.type)) {
      if (normalize(this.spec.children).length) throw new Error(`UIF_CHILDREN: ${this.spec.type} cannot contain children`);
      return;
    }
    if (!this.children) this.children = new View(this.first, null, this.ctx, this.scope);
    this.children.update(this.spec.children);
  }
  patch(spec: VNode): void {
    if (spec === this.spec) return;
    const previous = this.spec;
    this.spec = spec as ElementNode;
    // Dispose a child range before textContent replaces it.
    if (this.spec.props.text !== undefined && previous.props.text === undefined) { this.children?.dispose(); this.children = undefined; }
    this.applyProps();
    if (this.spec.children !== previous.children || this.spec.props.text !== previous.props.text) this.updateChildren();
  }
  dispose(): void { this.scope.dispose(); }
}
/** Reuse the normal prop/event/ID lifetime for the host; internal DOM belongs to HTMLInstance. */
class HTMLBlock implements Block {
  readonly first: HTMLElement;
  readonly last: HTMLElement;
  readonly scope: Scope;
  private host: ElementBlock;
  private instance: HTMLInstance;
  private hostSpec(spec: HTMLNode): ElementNode {
    return { kind: "element", type: "panel", props: { interactive: true, ...spec.props }, children: [], key: spec.key };
  }
  constructor(public spec: HTMLNode, parent: Node, before: Node, context: RenderContext, owner: Scope) {
    this.host = new ElementBlock(this.hostSpec(spec), parent, before, context, owner);
    this.first = this.last = this.host.first;
    this.scope = this.host.scope;
    this.first.dataset.uifNode = "html";
    try {
      this.instance = new HTMLInstance(spec, this.first, context, this.scope, (target, child) => {
        const view = new View(target, null, context, this.scope);
        try { view.scope.run(() => view.update(child)); } catch (error) { view.dispose(); throw error; }
        return view;
      });
    } catch (error) { this.scope.dispose(); throw error; }
  }
  patch(spec: VNode): void {
    if (spec === this.spec) return;
    this.spec = spec as HTMLNode;
    this.host.patch(this.hostSpec(this.spec));
    this.instance.patch(this.spec);
  }
  dispose(): void { this.scope.dispose(); }
}
class DynamicBlock implements Block {
  first: Node;
  last: Node;
  scope: Scope;
  private view: View;
  private stop?: Dispose;
  constructor(public spec: VNode & { kind: "dynamic" }, parent: Node, before: Node, private ctx: RenderContext, owner: Scope) {
    this.scope = new Scope(owner);
    this.view = new View(parent, before, ctx, this.scope);
    this.first = this.view.start; this.last = this.view.end;
    try { this.bind(); } catch (error) { this.scope.dispose(); throw error; }
  }
  private bind(): void {
    this.stop?.();
    this.stop = effect(() => {
      const child = this.spec.render();
      untrack(() => this.scope.run(() => this.view.update(child)));
    }, { scheduler: this.ctx.scheduler, scope: this.scope, priority: 0, name: "dynamic" });
  }
  patch(spec: VNode): void { if (spec !== this.spec) { this.spec = spec as typeof this.spec; this.bind(); } }
  dispose(): void { this.scope.dispose(); }
}
interface RowRecord<T> { key: Key; item: Signal<T>; index: Signal<number>; view: View; wrapper?: HTMLElement; }
class EachBlock<T> implements Block {
  first: Comment;
  last: Comment;
  scope: Scope;
  private rows = new Map<Key, RowRecord<T>>();
  private stop?: Dispose;
  constructor(public spec: EachNode<T>, private parent: Node, before: Node, private ctx: RenderContext, owner: Scope) {
    this.scope = new Scope(owner);
    this.first = ctx.document.createComment("uif:each"); this.last = ctx.document.createComment("uif:/each");
    parent.insertBefore(this.first, before); parent.insertBefore(this.last, before);
    this.scope.add(() => { this.rows.clear(); this.first.remove(); this.last.remove(); });
    try { this.bind(); } catch (error) { this.scope.dispose(); throw error; }
  }
  private bind(): void {
    this.stop?.();
    this.stop = effect(() => {
      const items = read(this.spec.items);
      const { keys } = keyedItems(items, this.spec.itemKey);
      untrack(() => this.updateRows(items, keys));
    }, { scheduler: this.ctx.scheduler, scope: this.scope, priority: 0, name: "each" });
  }
  private updateRows(items: readonly T[], keys: Key[]): void {
    const active = deepActiveElement(this.ctx.document);
    const next = new Map<Key, RowRecord<T>>();
    try {
      keys.forEach((key, index) => {
        let row = this.rows.get(key);
        if (!row) {
          const view = new View(this.parent, this.last, this.ctx, this.scope);
          row = { key, item: signal(items[index]), index: signal(index), view };
          try { view.scope.run(() => view.update(this.spec.render(row!.item, row!.index))); }
          catch (error) { view.dispose(); throw error; }
        } else { row.item.set(items[index]); row.index.set(index); }
        next.set(key, row);
      });
    } catch (error) {
      for (const [key, row] of next) if (!this.rows.has(key)) row.view.dispose();
      throw error;
    }
    for (const [key, row] of this.rows) if (!next.has(key)) row.view.dispose();
    let before: Node = this.last;
    for (const row of [...next.values()].reverse()) {
      moveBefore({ first: row.view.start, last: row.view.end }, this.parent, before, this.ctx.stats);
      before = row.view.start;
    }
    this.rows = next;
    if (active && active.isConnected && deepActiveElement(this.ctx.document) !== active) active.focus({ preventScroll: true });
  }
  patch(spec: VNode): void {
    if (spec === this.spec) return;
    this.spec = spec as EachNode<T>;
    // Reload retained row views, retaining compatible keyed elements and native editing state.
    for (const row of this.rows.values()) row.view.scope.run(() => row.view.update(this.spec.render(row.item, row.index)));
    this.bind();
  }
  dispose(): void { this.scope.dispose(); }
}
class VirtualBlock<T> implements Block {
  first: HTMLElement;
  last: HTMLElement;
  scope: Scope;
  private spacer: HTMLElement;
  private rows = new Map<Key, RowRecord<T>>();
  private offset = signal(0);
  private stop?: Dispose;
  private stopVirtual: Dispose;
  private content: readonly T[] = [];
  private keys: Key[] = [];
  private ranges = { start: 0, end: 0 };
  private shell: ElementBlock;
  private listScope?: Scope;
  constructor(public spec: VirtualNode<T>, parent: Node, before: Node, private ctx: RenderContext, owner: Scope) {
    this.scope = new Scope(owner);
    this.shell = new ElementBlock({ kind: "element", type: "scroll", props: this.shellProps(), children: [] }, parent, before, ctx, this.scope);
    this.first = this.last = this.shell.first;
    this.first.dataset.uifNode = "virtual";
    this.spacer = ctx.document.createElement("div");
    this.spacer.style.position = "relative";
    this.first.appendChild(this.spacer);
    const onScroll = () => this.offset.set(this.first.scrollTop);
    this.first.addEventListener("scroll", onScroll, { passive: true });
    this.scope.add(() => this.first.removeEventListener("scroll", onScroll));
    this.stopVirtual = ctx.focus.registerVirtual({ element: this.first, moveFrom: (element, direction, player) => this.moveFrom(element, direction, player) });
    this.scope.add(this.stopVirtual);
    this.scope.add(() => { ctx.stats.realizedRows -= this.rows.size; this.rows.clear(); });
    try { this.bind(); } catch (error) { this.scope.dispose(); throw error; }
  }
  private shellProps(): Props { return { role: "list", ...this.spec.props, style: { ...this.spec.props?.style, height: this.spec.height, position: "relative", contain: "layout paint" } }; }
  private bind(): void {
    this.stop?.(); this.listScope?.dispose();
    this.listScope = new Scope(this.scope);
    // O(N) validation only when the array identity changes, never on a scroll event.
    const data = computed(() => {
      const items = read(this.spec.items);
      return { items, ...keyedItems(items, this.spec.itemKey) };
    }, Object.is, this.listScope);
    this.stop = effect(() => {
      const { items, keys } = data.get();
      const range = visibleRange(items.length, this.offset.get(), read(this.spec.height), this.spec.rowHeight, this.spec.overscan ?? 2);
      untrack(() => {
        this.content = items; this.keys = keys; this.ranges = range;
        this.spacer.style.height = `${items.length * this.spec.rowHeight}px`;
        if (this.first.scrollTop !== range.offset) this.first.scrollTop = range.offset;
        this.updateRows(range.start, range.end);
      });
    }, { scheduler: this.ctx.scheduler, scope: this.listScope, priority: 0, name: "virtual-list" });
  }
  private updateRows(start: number, end: number): void {
    const next = new Map<Key, RowRecord<T>>();
    const previousFocused = this.ctx.focus.focusedElements().filter(([, element]) => composedContains(this.first, element));
    try {
      for (let index = start; index < end; index++) {
        const key = this.keys[index];
        let row = this.rows.get(key);
        if (!row) {
          const wrapper = this.ctx.document.createElement("div");
          wrapper.style.position = "absolute"; wrapper.style.left = "0"; wrapper.style.right = "0";
          this.spacer.appendChild(wrapper);
          const view = new View(wrapper, null, this.ctx, this.scope);
          view.scope.add(() => wrapper.remove());
          row = { key, item: signal(this.content[index]), index: signal(index), view, wrapper };
          try { view.scope.run(() => view.update(this.spec.render(row!.item, row!.index))); }
          catch (error) { view.dispose(); throw error; }
        } else { row.item.set(this.content[index]); row.index.set(index); }
        row.wrapper!.dataset.uifVirtualIndex = String(index);
        row.wrapper!.setAttribute("aria-posinset", String(index + 1));
        row.wrapper!.setAttribute("aria-setsize", String(this.content.length));
        row.wrapper!.setAttribute("role", "listitem");
        row.wrapper!.style.top = `${index * this.spec.rowHeight}px`;
        row.wrapper!.style.height = `${this.spec.rowHeight}px`;
        next.set(key, row);
      }
    } catch (error) {
      for (const [key, row] of next) if (!this.rows.has(key)) row.view.dispose();
      throw error;
    }
    for (const [key, row] of this.rows) if (!next.has(key)) row.view.dispose();
    this.ctx.stats.realizedRows += next.size - this.rows.size;
    this.ctx.stats.peakRows = Math.max(this.ctx.stats.peakRows, this.ctx.stats.realizedRows);
    this.rows = next;
    // Manual scrolling may recycle native focus. Keep it in the same list, not on document.body.
    // Keep semantic DOM order aligned with the logical list after scrolling in either direction.
    let before: Node | null = null;
    for (const row of [...next.values()].reverse()) {
      if (row.wrapper!.nextSibling !== before) this.spacer.insertBefore(row.wrapper!, before);
      before = row.wrapper!;
    }
    for (const [player, element] of previousFocused) {
      if (!element.isConnected) this.ctx.focus.first(player, this.first);
      else if (player === 0 && deepActiveElement(this.ctx.document) !== element) element.focus({ preventScroll: true });
    }
  }
  private moveFrom(element: HTMLElement, direction: Direction, player: number): boolean {
    if (direction !== "up" && direction !== "down") return false;
    const row = composedClosest(element, "[data-uif-virtual-index]");
    if (!row || !this.first.contains(row)) return false;
    const index = Number(row.dataset.uifVirtualIndex) + (direction === "down" ? 1 : -1);
    if (index < 0 || index >= this.content.length) return false;
    const height = read(this.spec.height);
    const top = index * this.spec.rowHeight;
    const current = this.first.scrollTop;
    const offset = top < current ? top : top + this.spec.rowHeight > current + height ? top + this.spec.rowHeight - height : current;
    this.first.scrollTop = offset;
    this.offset.set(offset);
    this.ctx.scheduler.flush();
    const target = this.rows.get(this.keys[index]);
    return !!target && this.ctx.focus.first(player, target.wrapper);
  }
  patch(spec: VNode): void {
    if (spec === this.spec) return;
    this.spec = spec as VirtualNode<T>;
    this.shell.patch({ kind: "element", type: "scroll", props: this.shellProps(), children: [] });
    this.first.dataset.uifNode = "virtual";
    for (const row of this.rows.values()) row.view.scope.run(() => row.view.update(this.spec.render(row.item, row.index)));
    this.bind();
  }
  dispose(): void { this.scope.dispose(); }
}
