/** UI Final reactive graph. No proxies, expression evaluation, frame polling, or DOM dependencies. */
export type Dispose = () => void;
export type Equality<T> = (previous: T, next: T) => boolean;
const READABLE = Symbol("ui-final.readable");

export interface Readable<T> {
  readonly [READABLE]: true;
  get(): T;
  peek(): T;
}
export type Value<T> = T | Readable<T> | (() => T);
export function isReadable<T = unknown>(value: unknown): value is Readable<T> {
  return !!value && typeof value === "object" && READABLE in value;
}
export function read<T>(value: Value<T>): T {
  return isReadable<T>(value) ? value.get() : typeof value === "function" ? (value as () => T)() : value;
}

let owner: Scope | undefined;
let observer: Observer | undefined;
let batchDepth = 0;
const deferredSchedulers = new Set<Scheduler>();

/** Explicit lifetime. Disposal is idempotent and runs all cleanups, even when one throws. */
export class Scope {
  private cleanups = new Set<Dispose>();
  private unlink?: Dispose;
  disposed = false;
  constructor(parent: Scope | null = owner ?? null) {
    if (parent) this.unlink = parent.add(() => this.dispose());
  }
  add(cleanup: Dispose): Dispose {
    if (this.disposed) throw new Error("UIF_SCOPE_DISPOSED: resource created after disposal");
    this.cleanups.add(cleanup);
    return () => this.cleanups.delete(cleanup);
  }
  run<T>(fn: () => T): T {
    if (this.disposed) throw new Error("UIF_SCOPE_DISPOSED");
    const previous = owner;
    owner = this;
    try { return fn(); } finally { owner = previous; }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unlink?.();
    const errors: unknown[] = [];
    for (const cleanup of [...this.cleanups].reverse()) {
      try { cleanup(); } catch (error) { errors.push(error); }
    }
    this.cleanups.clear();
    if (errors.length) throw new AggregateError(errors, "UIF_CLEANUP: one or more cleanups failed");
  }
  get resources(): number { return this.cleanups.size; }
}
export function onCleanup(cleanup: Dispose): void {
  if (!owner) throw new Error("UIF_NO_SCOPE: onCleanup requires Scope.run or an effect");
  owner.add(cleanup);
}
export function untrack<T>(fn: () => T): T {
  const previous = observer;
  observer = undefined;
  try { return fn(); } finally { observer = previous; }
}
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try { return fn(); } finally {
    if (--batchDepth === 0) {
      for (const scheduler of deferredSchedulers) scheduler.request();
      deferredSchedulers.clear();
    }
  }
}

interface Dependency {
  subscribers: Set<Observer>;
  version(): number;
}
abstract class Observer {
  dependencies = new Map<Dependency, number>();
  abstract invalidate(): void;
  depend(dependency: Dependency, version: number): void {
    this.dependencies.set(dependency, version);
    dependency.subscribers.add(this);
  }
  detach(): void {
    for (const dependency of this.dependencies.keys()) dependency.subscribers.delete(this);
    this.dependencies.clear();
  }
  changed(): boolean {
    for (const [dependency, version] of this.dependencies) if (dependency.version() !== version) return true;
    return false;
  }
}
function notify(dependency: Dependency): void {
  // Subscription mutation is permitted during invalidation; iterate a stable copy.
  for (const listener of [...dependency.subscribers]) listener.invalidate();
}

export class Signal<T> implements Readable<T>, Dependency {
  readonly [READABLE] = true as const;
  readonly subscribers = new Set<Observer>();
  private revision = 0;
  constructor(private value: T, private equals: Equality<T> = Object.is) {}
  get(): T { observer?.depend(this, this.revision); return this.value; }
  peek(): T { return this.value; }
  version(): number { return this.revision; }
  set(value: T): boolean {
    if (observer instanceof Computed) throw new Error("UIF_COMPUTED_WRITE: computed functions must be pure");
    if (this.equals(this.value, value)) return false;
    this.value = value;
    this.revision++;
    notify(this);
    return true;
  }
  update(update: (value: T) => T): boolean { return this.set(update(this.value)); }
}
export function signal<T>(value: T, equals?: Equality<T>): Signal<T> { return new Signal(value, equals); }

export class Computed<T> extends Observer implements Readable<T>, Dependency {
  readonly [READABLE] = true as const;
  readonly subscribers = new Set<Observer>();
  private value!: T;
  private revision = 0;
  private dirty = true;
  private initialized = false;
  private evaluating = false;
  private failed = false;
  private failure: unknown;
  private disposed = false;
  private unlink?: Dispose;
  constructor(private evaluate: () => T, private equals: Equality<T> = Object.is, scope = owner) {
    super();
    if (scope) this.unlink = scope.add(() => this.dispose());
  }
  invalidate(): void {
    if (this.dirty || this.disposed) return;
    this.dirty = true;
    notify(this);
  }
  version(): number { this.refresh(); return this.revision; }
  private refresh(): void {
    if (this.disposed) throw new Error("UIF_COMPUTED_DISPOSED");
    if (this.evaluating) throw new Error("UIF_REACTIVE_CYCLE: recursive computed");
    if (!this.dirty) { if (this.failed) throw this.failure; return; }
    this.evaluating = true;
    try {
      if (this.initialized && !this.changed()) { this.dirty = false; return; }
      this.detach();
      const previous = observer;
      observer = this;
      let next: T;
      try { next = this.evaluate(); } finally { observer = previous; }
      if (!this.initialized || !this.equals(this.value, next)) { this.value = next; this.revision++; }
      this.initialized = true;
      this.failed = false;
      this.failure = undefined;
      this.dirty = false;
    } catch (error) {
      // Cache the failure, but permit the next dependency mutation to schedule a retry.
      this.failed = true; this.failure = error; this.initialized = false; this.dirty = false; this.revision++;
      throw error;
    } finally { this.evaluating = false; }
  }
  get(): T {
    try { this.refresh(); } finally { observer?.depend(this, this.revision); }
    return this.value;
  }
  peek(): T { return untrack(() => this.get()); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unlink?.();
    this.detach();
    this.subscribers.clear();
  }
}
export function computed<T>(fn: () => T, equals?: Equality<T>, scope?: Scope): Computed<T> {
  return new Computed(fn, equals, scope);
}

export interface SchedulerOptions {
  mode?: "microtask" | "manual";
  maxRuns?: number;
  onError?: (error: unknown, name: string) => void;
}
export interface ReactiveStats { flushes: number; executed: number; skipped: number; errors: number; }
export class Scheduler {
  readonly stats: ReactiveStats = { flushes: 0, executed: 0, skipped: 0, errors: 0 };
  private queues = [new Set<ReactiveEffect>(), new Set<ReactiveEffect>(), new Set<ReactiveEffect>()];
  private requested = false;
  private flushing = false;
  private flushListeners = new Set<() => void>();
  constructor(readonly options: SchedulerOptions = {}) {}
  enqueue(effect: ReactiveEffect): void {
    this.queues[effect.priority].add(effect);
    if (batchDepth) deferredSchedulers.add(this); else this.request();
  }
  remove(effect: ReactiveEffect): void { this.queues[effect.priority].delete(effect); }
  request(): void {
    if (this.options.mode === "manual" || this.requested || this.flushing || !this.pending) return;
    this.requested = true;
    queueMicrotask(() => { this.requested = false; this.flush(); });
  }
  onFlush(listener: () => void): Dispose { this.flushListeners.add(listener); return () => this.flushListeners.delete(listener); }
  get pending(): number { return this.queues.reduce((sum, queue) => sum + queue.size, 0); }
  flush(): void {
    if (this.flushing) return;
    this.flushing = true;
    let count = 0;
    const errors: unknown[] = [];
    if (this.pending) this.stats.flushes++;
    try {
      while (this.pending) {
        if (++count > (this.options.maxRuns ?? 10000)) {
          this.queues.forEach(queue => queue.clear());
          throw new Error("UIF_REACTIVE_CYCLE: scheduler work limit exceeded");
        }
        // Structural work precedes property writes. Stable Set order is the tie-breaker.
        const queue = this.queues.find(queue => queue.size)!;
        const next = queue.values().next().value!;
        queue.delete(next);
        try {
          if (next!.run()) this.stats.executed++; else this.stats.skipped++;
        } catch (error) {
          this.stats.errors++;
          if (this.options.onError) {
            try { this.options.onError(error, next!.name); } catch (handlerError) { errors.push(handlerError); }
          } else errors.push(error);
        }
      }
    } finally { this.flushing = false; }
    for (const listener of this.flushListeners) { try { listener(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, "UIF_EFFECT: reactive effects failed");
  }
}
export const defaultScheduler = new Scheduler();
export interface EffectOptions { scheduler?: Scheduler; scope?: Scope; priority?: number; name?: string; }
class ReactiveEffect extends Observer {
  private initialized = false;
  private disposed = false;
  private runScope?: Scope;
  private unlink?: Dispose;
  readonly priority: number;
  readonly name: string;
  readonly scheduler: Scheduler;
  constructor(private fn: () => void | Dispose, options: EffectOptions) {
    super();
    this.priority = options.priority ?? 1;
    if (![0, 1, 2].includes(this.priority)) throw new Error("UIF_PRIORITY: expected 0, 1 or 2");
    this.name = options.name ?? "effect";
    this.scheduler = options.scheduler ?? defaultScheduler;
    const scope = options.scope ?? owner;
    if (scope) this.unlink = scope.add(() => this.dispose());
  }
  invalidate(): void { if (!this.disposed) this.scheduler.enqueue(this); }
  run(): boolean {
    if (this.disposed || (this.initialized && !this.changed())) return false;
    untrack(() => this.runScope?.dispose());
    this.detach();
    this.runScope = new Scope(null);
    const previous = observer;
    observer = this;
    try {
      this.runScope.run(() => {
        const cleanup = this.fn();
        if (cleanup) this.runScope!.add(cleanup);
      });
      this.initialized = true;
    } finally { observer = previous; }
    return true;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unlink?.();
    this.scheduler.remove(this);
    this.detach();
    untrack(() => this.runScope?.dispose());
  }
}
export function effect(fn: () => void | Dispose, options: EffectOptions = {}): Dispose {
  const instance = new ReactiveEffect(fn, options);
  try { instance.run(); } catch (error) { instance.dispose(); throw error; }
  return () => instance.dispose();
}
