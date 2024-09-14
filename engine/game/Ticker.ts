export default class Ticker {
  private _started = false;
  private _lastTime = 0;
  private _lastFrame = 0;
  private _tickerId = 0;
  private _tickers = new Map<number, (dt: number) => void>();
  private _type: "fixed" | "continuous";
  private _targetFPS = 60;
  private _maxElapsedMS = 100;
  private _minElapsedMS = 0;
  private lastTime = 0;

  private _tick: (time: number) => void;
  private _requestId: number | null = null;

  constructor(type: "fixed" | "continuous" = "fixed", targetFPS = -1) {
    this._type = type;
    if (targetFPS > 0) {
      this._minElapsedMS = 1000 / targetFPS;
    }

    this._tick = (time: number): void => {
      this._requestId = null;

      if (this._started) {
        // Invoke listeners now
        this.update(time);
        // Listener side effects may have modified ticker state.
        if (this._started && this._requestId === null && this._tickers.size > 0) {
          this._requestId = requestAnimationFrame(this._tick);
        }
      }
    };
  }

  private _requestIfNeeded(): void {
    if (this._requestId === null && this._tickers.size > 0) {
      // ensure callbacks get correct delta
      this._lastTime = performance.now();
      this._lastFrame = this._lastTime;
      this._requestId = requestAnimationFrame(this._tick);
    }
  }

  private _cancelIfNeeded(): void {
    if (this._requestId !== null) {
      cancelAnimationFrame(this._requestId);
      this._requestId = null;
    }
  }

  private update = (currentTime: number) => {
    let elapsedMS: number;

    if (currentTime > 0) {
      // Save uncapped elapsedMS for measurement
      elapsedMS = currentTime - this._lastTime;

      if (elapsedMS < 1000 / 90) {
        // too high fps breaks physics
        return;
      }

      // cap the milliseconds elapsed used for deltaTime
      if (elapsedMS > this._maxElapsedMS) {
        elapsedMS = this._maxElapsedMS;
      }

      if (this._minElapsedMS && this._type === "fixed") {
        const delta = (currentTime - this._lastFrame) | 0;

        if (delta < this._minElapsedMS) {
          return;
        }
        elapsedMS = this._minElapsedMS;

        this._lastFrame = currentTime - (delta % this._minElapsedMS);
      }
      this._tickers.forEach((ticker) => {
        ticker(elapsedMS);
      });
      this._lastTime = currentTime;
    }
  };

  start() {
    this._started = true;
    this._requestIfNeeded();
  }

  stop() {
    this._started = false;
    this._cancelIfNeeded();
  }

  add(ticker: (dt: number) => void) {
    const id = ++this._tickerId;
    this._tickers.set(id, ticker);
    return id;
  }

  remove(id: number) {
    this._tickers.delete(id);
  }
}
