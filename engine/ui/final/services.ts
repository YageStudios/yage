import { computed, signal, Scope, type Computed, type Readable, type Signal } from "./reactive";
import type { JSONValue } from "./document";

export type ResourceState<T> =
  | { status: "idle"; value?: T }
  | { status: "pending"; value?: T }
  | { status: "ready"; value: T }
  | { status: "error"; error: unknown; value?: T };
/** Latest request wins; aborted/stale completions never commit into a live or disposed screen. */
export class Resource<T> {
  private cell: Signal<ResourceState<T>> = signal<ResourceState<T>>({ status: "idle" });
  readonly state: Readable<ResourceState<T>> = this.cell;
  private controller?: AbortController;
  private generation = 0;
  private dead = false;
  constructor(scope?: Scope) { scope?.add(() => this.dispose()); }
  async load(loader: (signal: AbortSignal) => Promise<T>, keepPrevious = true): Promise<ResourceState<T>> {
    if (this.dead) throw new Error("UIF_RESOURCE_DISPOSED");
    this.controller?.abort();
    const generation = ++this.generation;
    const controller = this.controller = new AbortController();
    const value = keepPrevious ? this.cell.peek().value : undefined;
    this.cell.set({ status: "pending", value });
    try {
      const next = await loader(controller.signal);
      if (!this.dead && generation === this.generation && !controller.signal.aborted) this.cell.set({ status: "ready", value: next });
    } catch (error) {
      if (!this.dead && generation === this.generation && !controller.signal.aborted) this.cell.set({ status: "error", error, value });
    }
    return this.cell.peek();
  }
  cancel(): void {
    this.generation++; this.controller?.abort(); this.controller = undefined;
    if (!this.dead) this.cell.set({ status: "idle", value: this.cell.peek().value });
  }
  dispose(): void { if (this.dead) return; this.dead = true; this.generation++; this.controller?.abort(); }
}

export type Message = string | ({ other: string } & Partial<Record<Intl.LDMLPluralRule, string>>);
export interface Catalog { direction: "ltr" | "rtl"; messages: Readonly<Record<string, Message>>; }
/** Named placeholders and Intl cardinal plural rules; intentionally not an ICU MessageFormat parser. */
export class I18n {
  private localeCell: Signal<string>;
  readonly locale: Readable<string>;
  readonly direction: Computed<"ltr" | "rtl">;
  private revision = signal(0);
  private catalogs = new Map<string, Catalog>();
  private plurals = new Map<string, Intl.PluralRules>();
  private numbers = new Map<string, Intl.NumberFormat>();
  constructor(readonly fallback: string, catalogs: Readonly<Record<string, Catalog>>, scope?: Scope, private onMissing?: (key: string, locale: string) => void) {
    this.localeCell = signal(fallback);
    this.locale = this.localeCell;
    for (const [locale, catalog] of Object.entries(catalogs)) this.register(locale, catalog);
    if (!this.catalogs.has(fallback)) throw new Error("UIF_LOCALE: fallback catalog is required");
    this.direction = computed(() => { this.revision.get(); return this.catalogs.get(this.localeCell.get())!.direction; }, Object.is, scope);
    scope?.add(() => this.dispose());
  }
  register(locale: string, catalog: Catalog): void {
    // Let the platform validate the locale before accepting it.
    new Intl.PluralRules(locale);
    if (!["ltr", "rtl"].includes(catalog.direction)) throw new Error("UIF_LOCALE: explicit catalog direction is required");
    for (const [key, message] of Object.entries(catalog.messages)) {
      if (typeof message !== "string" && (!message || typeof message.other !== "string")) throw new Error(`UIF_MESSAGE: ${key} requires an 'other' plural form`);
    }
    this.catalogs.set(locale, catalog);
    this.revision.update(value => value + 1);
  }
  setLocale(locale: string): void {
    if (!this.catalogs.has(locale)) throw new Error(`UIF_LOCALE: catalog not registered: ${locale}`);
    this.localeCell.set(locale);
  }
  t(key: string, params: Readonly<Record<string, string | number>> = {}): string {
    this.revision.get();
    const locale = this.localeCell.get();
    let resolvedLocale = locale;
    const lookup = (locale: string): Message | undefined => { const messages = this.catalogs.get(locale)?.messages; return messages && Object.prototype.hasOwnProperty.call(messages, key) ? messages[key] : undefined; };
    let message = lookup(locale);
    if (message === undefined) { message = lookup(this.fallback); resolvedLocale = this.fallback; }
    if (message === undefined) { this.onMissing?.(key, locale); return `[${key}]`; }
    if (typeof message !== "string") {
      const count = params.count;
      if (typeof count !== "number" || !Number.isFinite(count)) throw new Error(`UIF_MESSAGE: ${key} needs a finite numeric count`);
      let plural = this.plurals.get(resolvedLocale);
      if (!plural) this.plurals.set(resolvedLocale, plural = new Intl.PluralRules(resolvedLocale));
      message = message[plural.select(count)] ?? message.other;
    }
    return message.replace(/\{([A-Za-z_][\w]*)\}/g, (token, name: string) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : token);
  }
  number(value: number, options: Intl.NumberFormatOptions = {}): string {
    const locale = this.localeCell.get();
    const key = `${locale}:${JSON.stringify(Object.fromEntries(Object.entries(options).sort(([a], [b]) => a.localeCompare(b))))}`;
    let formatter = this.numbers.get(key);
    if (!formatter) {
      if (this.numbers.size >= 64) this.numbers.delete(this.numbers.keys().next().value!);
      this.numbers.set(key, formatter = new Intl.NumberFormat(locale, options));
    }
    return formatter.format(value);
  }
  dispose(): void { this.direction.dispose(); this.numbers.clear(); this.plurals.clear(); this.catalogs.clear(); }
}

export interface UICommand { readonly sequence: number; readonly player: number; readonly type: string; readonly payload: JSONValue; }
/** Presentation-to-simulation boundary. Drain at the game's authoritative input point, never directly from the DOM. */
export class CommandQueue {
  private commands: UICommand[] = [];
  private sequence = 0;
  private draining = false;
  constructor(readonly capacity = 1024, readonly maxPayloadBytes = 16384) {
    if (!Number.isInteger(capacity) || capacity <= 0 || !Number.isInteger(maxPayloadBytes) || maxPayloadBytes <= 0) throw new Error("UIF_COMMAND_LIMIT: limits must be positive integers");
  }
  get size(): number { return this.commands.length; }
  enqueue(player: number, type: string, payload: JSONValue = null): UICommand {
    if (!Number.isInteger(player) || player < 0 || !/^[A-Za-z][\w:.-]{0,127}$/.test(type)) throw new Error("UIF_COMMAND: invalid player or command name");
    if (this.commands.length >= this.capacity) throw new Error("UIF_COMMAND_OVERFLOW: command queue is full");
    const seen = new Set<object>();
    let nodes = 0;
    const copyValue = (value: unknown, depth: number): JSONValue => {
      if (++nodes > 10000 || depth > 64) throw new Error("UIF_COMMAND_PAYLOAD: complexity limit exceeded");
      if (value === null || typeof value === "string" || typeof value === "boolean") return value;
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (!value || typeof value !== "object" || seen.has(value) || Object.getOwnPropertySymbols(value).length) throw new Error("UIF_COMMAND_PAYLOAD: expected acyclic JSON data");
      const array = Array.isArray(value);
      if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("UIF_COMMAND_PAYLOAD: expected plain data objects");
      seen.add(value);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const result: any = array ? [] : {};
      if (array && Object.keys(value).length !== value.length) throw new Error("UIF_COMMAND_PAYLOAD: sparse arrays or extra array properties are forbidden");
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (array && key === "length") continue;
        if (descriptor.get || descriptor.set || !descriptor.enumerable || ["__proto__", "constructor", "prototype"].includes(key) || array && !/^(0|[1-9][0-9]*)$/.test(key)) throw new Error("UIF_COMMAND_PAYLOAD: accessors, reserved keys and non-data properties are forbidden");
        result[key] = copyValue(descriptor.value, depth + 1);
      }
      seen.delete(value);
      return Object.freeze(result);
    };
    const copy = copyValue(payload, 0);
    const encoded = JSON.stringify(copy);
    if (new TextEncoder().encode(encoded).length > this.maxPayloadBytes) throw new Error("UIF_COMMAND_PAYLOAD: byte limit exceeded");
    const command = Object.freeze({ sequence: ++this.sequence, player, type, payload: copy });
    this.commands.push(command);
    return command;
  }
  drain(consume: (command: UICommand) => void, limit = this.commands.length): number {
    if (!Number.isInteger(limit) || limit < 0) throw new Error("UIF_COMMAND_LIMIT: expected non-negative integer");
    if (this.draining) throw new Error("UIF_COMMAND_REENTRANT: drain cannot be nested");
    const count = Math.min(limit, this.commands.length);
    this.draining = true;
    try {
      // Failed commands remain at the head; commands enqueued by a handler wait until the next drain.
      for (let index = 0; index < count; index++) { consume(this.commands[0]); this.commands.shift(); }
      return count;
    } finally { this.draining = false; }
  }
  clear(): void {
    if (this.draining) throw new Error("UIF_COMMAND_REENTRANT: cannot clear during drain");
    this.commands = [];
  }
}
