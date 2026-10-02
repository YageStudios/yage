import { composedParent, composedContains, composedClosest, composedOrder } from "./dom";
import type { Direction, NavigationAction } from "./nodes";
import type { Dispose } from "./reactive";

export interface Rect { left: number; top: number; right: number; bottom: number; }
export interface FocusEntry {
  id: string;
  element: HTMLElement;
  players: () => readonly number[] | undefined;
  navigation: () => Partial<Record<Direction | "next" | "previous", string>>;
}
export interface VirtualFocus {
  element: HTMLElement;
  moveFrom(element: HTMLElement, direction: Direction, player: number): boolean;
}
interface ModalFocus { element: HTMLElement; previous: Map<number, string>; }

/** Deterministic edge/beam score; inspired by spatial navigation, not a CSS-nav conformance implementation. */
export function spatialScore(from: Rect, to: Rect, direction: Direction): number | null {
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "right" || direction === "down" ? 1 : -1;
  const mainCenter = horizontal ? (to.left + to.right - from.left - from.right) / 2 : (to.top + to.bottom - from.top - from.bottom) / 2;
  if (mainCenter * sign <= 0) return null;
  const near = horizontal ? (sign > 0 ? to.left - from.right : from.left - to.right) : (sign > 0 ? to.top - from.bottom : from.top - to.bottom);
  const cross = horizontal ? Math.max(0, to.top - from.bottom, from.top - to.bottom) : Math.max(0, to.left - from.right, from.left - to.right);
  const crossCenter = horizontal ? Math.abs(to.top + to.bottom - from.top - from.bottom) / 2 : Math.abs(to.left + to.right - from.left - from.right) / 2;
  // Off-beam penalty is deliberate. Equal scores retain registration/DOM order.
  return Math.max(0, near) + cross * 4 + crossCenter * 0.1 + (cross > 0 ? 10000 : 0);
}
function blocked(element: HTMLElement, host: HTMLElement): boolean {
  if (!composedContains(host, element) || !element.isConnected) return true;
  let current: HTMLElement | null = element;
  while (current) {
    if (current.hidden || current.inert || current.getAttribute("aria-disabled") === "true" ||
      ("disabled" in current && (current as HTMLButtonElement).disabled)) return true;
    if (current === host) break;
    current = composedParent(current);
  }
  return false;
}
export function isEditable(element: Element | null): boolean {
  return !!element && (element.matches("input,textarea,select,[contenteditable=true]") || !!composedClosest(element, "[contenteditable=true]"));
}
function rendered(element: HTMLElement): boolean {
  const style = element.ownerDocument.defaultView!.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && element.getClientRects().length > 0;
}
function visibleRect(element: HTMLElement, host: HTMLElement): Rect | null {
  const view = element.ownerDocument.defaultView!;
  const style = view.getComputedStyle(element);
  if (style.visibility === "hidden" || style.visibility === "collapse" || style.display === "none") return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
  let parent = composedParent(element);
  while (parent) {
    const css = view.getComputedStyle(parent);
    if (css.visibility === "hidden" || css.display === "none") return null;
    const clipX = /hidden|clip|scroll|auto/.test(css.overflowX);
    const clipY = /hidden|clip|scroll|auto/.test(css.overflowY);
    if (clipX || clipY) {
      const clip = parent.getBoundingClientRect();
      if (clipX) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
      if (clipY) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
    }
    if (parent === host) break;
    parent = composedParent(parent);
  }
  left = Math.max(0, left); top = Math.max(0, top);
  right = Math.min(view.innerWidth, right); bottom = Math.min(view.innerHeight, bottom);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

export class FocusManager {
  private entries = new Map<string, FocusEntry>();
  private focused = new Map<number, string>();
  private modals: ModalFocus[] = [];
  private virtuals = new Set<VirtualFocus>();
  private cancel?: () => void;
  private pendingRepair = new Set<number>();
  constructor(readonly host: HTMLElement, private beforeRead: () => void = () => {}, private externalAllowed: () => boolean = () => true) {}
  setCancelHandler(handler: () => void): void { this.cancel = handler; }
  register(entry: FocusEntry): Dispose {
    if (this.entries.has(entry.id)) throw new Error(`UIF_DUPLICATE_ID: ${entry.id}`);
    this.entries.set(entry.id, entry);
    entry.element.dataset.uifFocusId = entry.id;
    return () => {
      if (this.entries.get(entry.id) !== entry) return;
      for (const [player, id] of [...this.focused]) if (id === entry.id) { this.setCurrent(player, undefined); this.pendingRepair.add(player); }
      this.entries.delete(entry.id);
      delete entry.element.dataset.uifFocusId;
    };
  }
  registerVirtual(controller: VirtualFocus): Dispose { this.virtuals.add(controller); return () => this.virtuals.delete(controller); }
  get currentModal(): HTMLElement | undefined { return this.modals[this.modals.length - 1]?.element; }
  get size(): number { return this.entries.size; }
  current(player = 0): string | undefined { return this.focused.get(player); }
  focusedElements(): readonly (readonly [number, HTMLElement])[] { return [...this.focused.keys()].map(player => [player, this.currentElement(player)!] as const).filter(([, element]) => !!element); }
  currentElement(player = 0): HTMLElement | undefined { return this.entries.get(this.current(player) ?? "")?.element; }
  allows(element: HTMLElement, player = 0): boolean {
    if (!this.externalAllowed() || blocked(element, this.host)) return false;
    let ancestor: HTMLElement | null = element;
    while (ancestor) {
      const allowed = ancestor.getAttribute("data-uif-allowed-players");
      if (allowed !== null && !allowed.split(" ").filter(Boolean).map(Number).includes(player)) return false;
      if (ancestor === this.host) break;
      ancestor = composedParent(ancestor);
    }
    const modal = this.currentModal;
    if (modal && !composedContains(modal, element)) return false;
    const entry = this.entries.get(element.dataset.uifFocusId ?? "");
    const players = entry?.players();
    return !players || players.includes(player);
  }
  private candidates(player: number, scope?: HTMLElement | null): FocusEntry[] {
    return [...this.entries.values()].filter(entry => this.allows(entry.element, player) && (!scope || composedContains(scope, entry.element)) && rendered(entry.element))
      .sort((a, b) => composedOrder(a.element, b.element));
  }
  private setCurrent(player: number, id: string | undefined): void {
    this.pendingRepair.delete(player);
    const previous = this.currentElement(player);
    if (id) this.focused.set(player, id); else this.focused.delete(player);
    const next = this.currentElement(player);
    for (const element of [previous, next]) if (element) {
      const indices = [...this.focused].filter(([, value]) => this.entries.get(value)?.element === element).map(([index]) => index).sort((a, b) => a - b);
      if (indices.length) element.dataset.uifPlayers = indices.join(" "); else delete element.dataset.uifPlayers;
    }
  }
  focus(id: string, player = 0, scroll = true): boolean {
    if (!Number.isInteger(player) || player < 0) throw new Error("UIF_PLAYER: player must be a non-negative integer");
    const entry = this.entries.get(id);
    if (!entry || !this.allows(entry.element, player) || !rendered(entry.element)) return false;
    this.setCurrent(player, id);
    if (player === 0) entry.element.focus({ preventScroll: true });
    if (scroll) entry.element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    return true;
  }
  adopt(element: HTMLElement, player = 0): void {
    const target = composedClosest(element, "[data-uif-focus-id]");
    if (target && this.allows(target, player)) this.setCurrent(player, target.dataset.uifFocusId);
  }
  first(player = 0, scope?: HTMLElement): boolean {
    const candidate = this.candidates(player, scope)[0];
    return !!candidate && this.focus(candidate.id, player);
  }
  repair(): void {
    // No explicit geometry reads: run only after structural/property commits.
    for (const player of [...this.pendingRepair]) { this.pendingRepair.delete(player); this.first(player); }
    for (const [player, id] of [...this.focused]) {
      const entry = this.entries.get(id);
      if (!entry || !this.allows(entry.element, player)) {
        this.setCurrent(player, undefined);
        this.first(player);
      }
    }
  }
  navigate(action: NavigationAction, player = 0): boolean {
    this.beforeRead();
    this.repair();
    if (action === "cancel") { if (this.modals.length) { this.cancel?.(); return true; } return this.dispatch("uif-cancel", player); }
    if (action === "accept") return this.dispatch("uif-activate", player);
    const current = this.entries.get(this.current(player) ?? "");
    if (!current || !rendered(current.element)) return this.first(player);
    const input = current.element as HTMLInputElement;
    if (input.tagName === "INPUT" && input.type === "range" && (action === "left" || action === "right")) {
      const min = Number(input.min || 0), max = Number(input.max || 100), step = input.step === "any" ? 1 : Number(input.step || 1);
      input.value = String(Math.max(min, Math.min(max, Number(input.value) + (action === "right" ? step : -step))));
      input.dispatchEvent(new input.ownerDocument.defaultView!.CustomEvent("input", { bubbles: true, composed: true, detail: { player } }));
      input.dispatchEvent(new input.ownerDocument.defaultView!.CustomEvent("change", { bubbles: true, composed: true, detail: { player } }));
      return true;
    }
    const override = current.navigation()[action];
    if (override && this.focus(override, player)) return true;
    const scope = composedClosest(current.element, "[data-uif-focus-scope]");
    const candidates = this.candidates(player, scope);
    if (action === "next" || action === "previous") {
      const index = candidates.indexOf(current);
      const next = index + (action === "next" ? 1 : -1);
      const shouldWrap = !!this.currentModal || !!scope;
      if (!shouldWrap && (next < 0 || next >= candidates.length)) return false;
      const entry = candidates[(next + candidates.length) % candidates.length];
      return !!entry && this.focus(entry.id, player);
    }
    for (const virtual of this.virtuals) {
      if (composedContains(virtual.element, current.element) && virtual.moveFrom(current.element, action, player)) return true;
    }
    const from = visibleRect(current.element, this.host);
    if (!from) return this.first(player);
    let best: FocusEntry | undefined;
    let score = Infinity;
    // All rectangle reads are completed before the winning focus/scroll write.
    for (const candidate of candidates) {
      if (candidate === current) continue;
      const rect = visibleRect(candidate.element, this.host);
      const value = rect && spatialScore(from, rect, action);
      if (value !== null && value < score) { best = candidate; score = value; }
    }
    return !!best && this.focus(best.id, player);
  }
  private dispatch(type: string, player: number): boolean {
    const target = this.currentElement(player);
    if (!target || !this.allows(target, player) || !rendered(target)) return false;
    const EventClass = target.ownerDocument.defaultView!.CustomEvent;
    target.dispatchEvent(new EventClass(type, { bubbles: true, composed: true, cancelable: true, detail: { player } }));
    return true;
  }
  pushModal(element: HTMLElement, autoFocus = true): Dispose {
    const modal = { element, previous: new Map(this.focused) };
    this.modals.push(modal);
    if (autoFocus) for (const player of new Set([0, ...this.focused.keys()])) {
      this.setCurrent(player, undefined);
      this.first(player, element);
    }
    return () => {
      const top = this.modals[this.modals.length - 1] === modal;
      this.modals = this.modals.filter(item => item !== modal);
      if (!top) return;
      for (const player of new Set([0, ...this.focused.keys(), ...modal.previous.keys()])) {
        this.setCurrent(player, undefined);
        const previous = modal.previous.get(player);
        if (!previous || !this.focus(previous, player)) this.first(player);
      }
    };
  }
  dispose(): void { this.entries.clear(); this.focused.clear(); this.modals = []; this.virtuals.clear(); this.pendingRepair.clear(); }
}
