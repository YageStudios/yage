import { composedContains, composedParent, eventElement } from "./dom";
import type { HTMLPolicy } from "./html";
import { FocusManager, isEditable } from "./focus";
import { Scope, Scheduler, signal, effect, type Dispose, type SchedulerOptions } from "./reactive";
import { View, type RenderContext, type RenderStats } from "./render";
import { baseCSS, defaultTheme, applyTheme, type Theme } from "./theme";
import type { Child, NavigationAction } from "./nodes";

export interface UIFinalOptions {
  /** UI Final creates and owns a child root; it never clears this host. Defaults to document.body. */
  host?: HTMLElement;
  document?: Document;
  /** Overlay is a full host-sized pointer-transparent layer. Inline participates in normal document flow. */
  placement?: "overlay" | "inline";
  zIndex?: number;
  scheduler?: Scheduler;
  scheduling?: SchedulerOptions["mode"];
  theme?: Theme;
  /** CSP nonce for the engine-owned stylesheet. Style attributes still require an appropriate style policy. */
  styleNonce?: string;
  /** Optional application-owned Trusted Types policy for project HTML component templates. */
  htmlPolicy?: HTMLPolicy;
  keyboard?: boolean;
  onError?: (error: unknown) => void;
}
export interface ModalOptions {
  label: string;
  dismissible?: boolean;
  onClose?: () => void;
}
export interface ModalHandle { readonly element: HTMLElement; close(): void; }
export interface Inspection {
  id: string;
  node: string;
  disabled: boolean;
  hidden: boolean;
  focusedPlayers: string;
  children: number;
}
const keyActions: Record<string, NavigationAction> = {
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Escape: "cancel",
};
let rootSequence = 0;
const modalOwners = new WeakMap<Document, { owner: UIFinal; token: object }[]>();

/** Scene-owned browser UI runtime. The simulation never owns these objects and must not serialize them. */
export class UIFinal {
  readonly root: HTMLElement;
  readonly content: HTMLElement;
  readonly scope = new Scope(null);
  readonly scheduler: Scheduler;
  readonly focus: FocusManager;
  readonly reducedMotion = signal(false);
  readonly stats: RenderStats = { created: 0, disposed: 0, propertyWrites: 0, textWrites: 0, moves: 0, realizedRows: 0, peakRows: 0 };
  readonly errors: unknown[] = [];
  private view: View;
  private context: RenderContext;
  private ids = new Map<string, HTMLElement>();
  private modals: { handle: ModalHandle; dispose: Dispose; wrapper: HTMLElement }[] = [];
  private frames = new Set<(dtMs: number) => void>();
  private sequence = 0;
  private modalBaseInert = false;
  private lifetimes = new WeakMap<HTMLElement, Scope>();
  private dead = false;
  private listeners: Dispose[] = [];
  private themeKeys = new Set<string>();
  private liveRegion: HTMLElement;
  constructor(private options: UIFinalOptions = {}) {
    const document = options.document ?? options.host?.ownerDocument ?? globalThis.document;
    if (!document) throw new Error("UIF_PLATFORM: creating a runtime requires a browser Document");
    const host = options.host ?? document.body;
    this.root = document.createElement("div");
    this.root.dataset.uifRoot = String(++rootSequence);
    this.root.tabIndex = -1;
    this.root.style.position = options.placement === "inline" ? "relative" : "absolute";
    if (options.placement !== "inline") this.root.style.inset = "0";
    this.root.style.zIndex = String(options.zIndex ?? 20);
    this.content = document.createElement("div");
    this.content.dataset.uifContent = "";
    this.content.style.width = "100%"; this.content.style.height = "100%";
    const style = document.createElement("style");
    if (options.styleNonce) style.nonce = options.styleNonce;
    style.textContent = baseCSS;
    this.root.appendChild(style);
    this.root.appendChild(this.content);
    this.liveRegion = document.createElement("div");
    this.liveRegion.setAttribute("aria-live", "polite");
    this.liveRegion.setAttribute("aria-atomic", "true");
    Object.assign(this.liveRegion.style, { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clipPath: "inset(50%)" });
    this.root.appendChild(this.liveRegion);
    host.appendChild(this.root);
    this.scheduler = options.scheduler ?? new Scheduler({ mode: options.scheduling ?? "microtask", onError: error => this.report(error) });
    this.focus = new FocusManager(this.root, () => this.flush(), () => this.acceptsInput);
    this.listeners.push(this.scheduler.onFlush(() => this.focus.repair()));
    this.focus.setCancelHandler(() => {
      const top = this.modals[this.modals.length - 1];
      if (top) top.handle.close();
    });
    this.context = { document, scheduler: this.scheduler, focus: this.focus, stats: this.stats, ids: this.ids, lifetimes: this.lifetimes,
      nextId: () => `uif-${this.root.dataset.uifRoot}-${++this.sequence}`, report: error => this.report(error),
      reducedMotion: this.reducedMotion, styleNonce: options.styleNonce, htmlPolicy: options.htmlPolicy,
      addFrameTask: task => this.addFrameTask(task) };
    this.view = new View(this.content, null, this.context, this.scope);
    this.setTheme(options.theme ?? {});
    this.listen(this.root, "focusin", event => {
      const target = eventElement(event) ?? this.root;
      if (this.focus.allows(target)) this.focus.adopt(target);
      else if (this.focus.currentModal) this.focus.first(0, this.focus.currentModal);
    });
    this.listen(this.root, "pointerdown", event => {
      const target = eventElement(event) ?? this.root;
      if (!this.focus.allows(target)) { event.preventDefault(); event.stopImmediatePropagation(); }
      else this.focus.adopt(target);
    }, true);
    if (options.keyboard !== false) this.listen(this.root, "keydown", event => this.onKeyDown(event as KeyboardEvent));
    const media = document.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (media) {
      const change = () => this.setReducedMotion(media.matches);
      change(); media.addEventListener("change", change);
      this.listeners.push(() => media.removeEventListener("change", change));
    }
    this.scope.add(() => {
      this.listeners.splice(0).forEach(dispose => dispose());
      this.frames.clear(); this.focus.dispose(); this.ids.clear(); this.root.remove();
    });
  }
  private check(): void { if (this.dead) throw new Error("UIF_RUNTIME_DISPOSED"); }
  private listen(target: EventTarget, type: string, listener: EventListener, capture = false): void {
    target.addEventListener(type, listener, capture);
    this.listeners.push(() => target.removeEventListener(type, listener, capture));
  }
  private onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    // Keep typing/IME out of the game's keyboard listener, without cancelling native editing.
    event.stopPropagation();
    if (event.isComposing || event.key === "Process" || event.keyCode === 229) return;
    const target = eventElement(event) ?? this.root;
    if (event.key === "Escape") {
      if (this.focus.navigate("cancel")) event.preventDefault();
      return;
    }
    if (event.key === "Tab") {
      if (this.focus.navigate(event.shiftKey ? "previous" : "next")) event.preventDefault();
      else if (this.focus.currentModal) event.preventDefault();
      return;
    }
    if (isEditable(target)) return;
    const action = keyActions[event.key];
    if (action && this.focus.navigate(action)) event.preventDefault();
    // Native buttons produce one click for Enter/Space. Never synthesize a second keyboard click.
  }
  report(error: unknown): void {
    this.errors.push(error);
    if (this.errors.length > 128) this.errors.shift();
    if (this.options.onError) this.options.onError(error); else console.error("[UI Final]", error);
  }
  mount(content: Child): this {
    this.check(); this.scope.run(() => this.view.update(content)); this.flush(); return this;
  }
  /** Reconcile a new description into retained nodes; stable type/key/ID preserves native controls. */
  update(content: Child): void { this.mount(content); }
  flush(): void { if (!this.dead) { this.scheduler.flush(); this.focus.repair(); } }
  frame(dtMs: number): void {
    this.check();
    if (!Number.isFinite(dtMs) || dtMs < 0) throw new Error("UIF_DELTA: expected finite non-negative milliseconds");
    for (const task of this.frames) task(Math.min(dtMs, 250));
    this.flush();
  }
  addFrameTask(task: (dtMs: number) => void): Dispose { this.check(); this.frames.add(task); return () => this.frames.delete(task); }
  /** Includes game-input repeat and currently-active component animations. */
  get frameTaskCount(): number { return this.frames.size; }
  element(id: string): HTMLElement | undefined { return this.ids.get(id); }
  setTheme(theme: Theme): void {
    this.check();
    const merged = { ...defaultTheme, ...theme };
    applyTheme(this.root, merged);
    for (const key of this.themeKeys) if (!(key in merged)) this.root.style.removeProperty(key);
    this.themeKeys = new Set(Object.keys(merged));
  }
  setReducedMotion(reduced: boolean): void {
    this.reducedMotion.set(reduced);
    if (reduced) this.root.dataset.uifReducedMotion = ""; else delete this.root.dataset.uifReducedMotion;
  }
  announce(message: string, priority: "polite" | "assertive" = "polite"): void {
    this.check();
    this.liveRegion.setAttribute("aria-live", priority);
    this.liveRegion.textContent = message;
  }
  /** Native top-layer dialogs own the whole document, including other UI roots and legacy overlays. */
  get acceptsInput(): boolean {
    const owners = modalOwners.get(this.root.ownerDocument);
    return !owners?.length || owners[owners.length - 1].owner === this;
  }
  animate(target: string | HTMLElement, keyframes: Keyframe[] | PropertyIndexedKeyframes, options: KeyframeAnimationOptions = { duration: 160 }): Animation {
    this.check();
    const element = typeof target === "string" ? this.element(target) : target;
    if (!element || !composedContains(this.root, element)) throw new Error("UIF_ANIMATION_TARGET: target must belong to this runtime");
    const animation = element.animate(keyframes, { ...options, ...(this.reducedMotion.peek() ? { duration: 0, delay: 0 } : {}) });
    let owner: Scope | undefined;
    for (let target: HTMLElement | null = element; target && !owner; target = composedParent(target)) owner = this.lifetimes.get(target);
    const lifetime = new Scope(owner ?? this.scope);
    lifetime.add(() => animation.cancel());
    effect(() => { if (this.reducedMotion.get() && animation.playState !== "idle" && animation.playState !== "finished") animation.finish(); }, { scope: lifetime, scheduler: this.scheduler });
    const finish = () => { try { lifetime.dispose(); } catch (error) { this.report(error); } };
    void animation.finished.then(finish, finish);
    return animation;
  }
  openModal(content: Child, options: ModalOptions): ModalHandle {
    this.check();
    if (!options.label.trim()) throw new Error("UIF_ACCESSIBILITY: a modal requires an accessible label");
    const document = this.root.ownerDocument;
    const wrapper = document.createElement("div");
    wrapper.dataset.uifModal = "";
    const dialog = document.createElement("dialog");
    if (!dialog.showModal) throw new Error("UIF_PLATFORM: native HTML dialog support is required");
    dialog.dataset.uifDialog = "";
    dialog.setAttribute("aria-modal", "true"); dialog.setAttribute("aria-label", options.label);
    wrapper.appendChild(dialog);
    this.root.appendChild(wrapper);
    const modalScope = new Scope(this.scope);
    modalScope.add(() => { if (dialog.open) dialog.close(); wrapper.remove(); });
    const view = new View(dialog, null, this.context, modalScope);
    try { modalScope.run(() => view.update(content)); this.flush(); }
    catch (error) { modalScope.dispose(); throw error; }
    if (!this.modals.length) this.modalBaseInert = this.content.inert;
    this.content.inert = true;
    for (const modal of this.modals) modal.wrapper.inert = true;
    const token = {};
    const owners = modalOwners.get(document) ?? [];
    owners.push({ owner: this, token }); modalOwners.set(document, owners);
    const pop = this.focus.pushModal(dialog, false);
    let closed = false;
    const dispose = () => {
      if (closed) return;
      closed = true;
      this.modals = this.modals.filter(modal => modal.wrapper !== wrapper);
      modalOwners.set(document, (modalOwners.get(document) ?? []).filter(entry => entry.token !== token));
      this.content.inert = this.modals.length > 0 || this.modalBaseInert;
      for (const modal of this.modals) modal.wrapper.inert = modal !== this.modals[this.modals.length - 1];
      if (dialog.open) dialog.close();
      pop(); modalScope.dispose(); options.onClose?.();
    };
    const handle: ModalHandle = { element: dialog, close: dispose };
    this.modals.push({ handle: options.dismissible === false ? { element: dialog, close: () => {} } : handle, dispose, wrapper });
    const cancel = (event: Event) => { event.preventDefault(); if (options.dismissible !== false) dispose(); };
    dialog.addEventListener("cancel", cancel);
    const close = () => dispose();
    dialog.addEventListener("close", close);
    modalScope.add(() => { dialog.removeEventListener("cancel", cancel); dialog.removeEventListener("close", close); });
    try {
      dialog.showModal();
      if (!closed) for (const player of new Set([0, ...this.focus.focusedElements().map(([player]) => player)])) this.focus.first(player, dialog);
    } catch (error) { dispose(); throw error; }
    return handle;
  }
  inspect(): readonly Inspection[] {
    return [...this.ids].map(([id, element]) => ({ id, node: element.dataset.uifNode ?? "unknown", disabled: element.getAttribute("aria-disabled") === "true",
      hidden: element.hidden, focusedPlayers: element.dataset.uifPlayers ?? "", children: element.children.length }));
  }
  dispose(): void {
    if (this.dead) return;
    // Run every lifetime cleanup even if an application onClose callback fails.
    const errors: unknown[] = [];
    for (const modal of [...this.modals].reverse()) { try { modal.dispose(); } catch (error) { errors.push(error); } }
    this.dead = true;
    try { this.scope.dispose(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "UIF_DISPOSE: runtime cleanup failed");
  }
}
