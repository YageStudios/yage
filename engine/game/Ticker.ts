import { FIXED_TIMESTEP_HZ } from "./Timing";

/**
 * requestAnimationFrame scheduler with a real fixed-step accumulator.
 *
 * Fixed mode can invoke listeners more than once after a delayed RAF so the
 * simulation does not silently lose elapsed fixed steps. Elapsed time is
 * capped to keep a suspended tab from producing an unbounded spiral.
 */
export default class Ticker {
  private _started = false;
  private _lastTime = 0;
  private _tickerId = 0;
  private readonly _tickers = new Map<number, (dt: number) => void>();
  private readonly _type: "fixed" | "continuous";
  private readonly _stepMS: number;
  private readonly _maxElapsedMS = 100;
  private _accumulatorMS = 0;

  private readonly _tick: (time: number) => void;
  private _requestId: number | null = null;

  constructor(type: "fixed" | "continuous" = "fixed", targetFPS = FIXED_TIMESTEP_HZ) {
    this._type = type;
    this._stepMS = 1000 / (targetFPS > 0 ? targetFPS : FIXED_TIMESTEP_HZ);

    this._tick = (time: number): void => {
      this._requestId = null;
      if (!this._started) return;

      this.update(time);
      // Listener side effects may have stopped the ticker or removed listeners.
      if (this._started && this._requestId === null && this._tickers.size > 0) {
        this._requestId = requestAnimationFrame(this._tick);
      }
    };
  }

  private _requestIfNeeded(): void {
    if (!this._started || this._requestId !== null || this._tickers.size === 0) return;
    this._lastTime = performance.now();
    this._accumulatorMS = 0;
    this._requestId = requestAnimationFrame(this._tick);
  }

  private _cancelIfNeeded(): void {
    if (this._requestId === null) return;
    cancelAnimationFrame(this._requestId);
    this._requestId = null;
  }

  private update(currentTime: number): void {
    if (!(currentTime > 0)) return;
    const elapsedMS = Math.max(0, Math.min(this._maxElapsedMS, currentTime - this._lastTime));
    this._lastTime = currentTime;

    if (this._type === "continuous") {
      if (elapsedMS > 0) this.invoke(elapsedMS);
      return;
    }

    this._accumulatorMS += elapsedMS;
    // The elapsed cap also bounds this loop, but keep an explicit limit so a
    // future option cannot accidentally reintroduce a spiral of death.
    const maxSteps = Math.max(1, Math.ceil(this._maxElapsedMS / this._stepMS));
    let steps = 0;
    while (this._accumulatorMS + Number.EPSILON >= this._stepMS && steps < maxSteps) {
      this.invoke(this._stepMS);
      this._accumulatorMS -= this._stepMS;
      steps += 1;
      if (!this._started || this._tickers.size === 0) break;
    }
  }

  private invoke(dt: number): void {
    for (const ticker of [...this._tickers.values()]) ticker(dt);
  }

  start(): void {
    if (this._started) return;
    this._started = true;
    this._requestIfNeeded();
  }

  stop(): void {
    this._started = false;
    this._accumulatorMS = 0;
    this._cancelIfNeeded();
  }

  add(ticker: (dt: number) => void): number {
    const id = ++this._tickerId;
    this._tickers.set(id, ticker);
    // Starting before registering a callback is supported.
    this._requestIfNeeded();
    return id;
  }

  remove(id: number): void {
    this._tickers.delete(id);
    if (this._tickers.size === 0) this._cancelIfNeeded();
  }
}
