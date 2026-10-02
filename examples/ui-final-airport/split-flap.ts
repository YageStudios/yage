import { defineHTMLComponent, type HTMLComponentContext, type Dispose } from "../../engine/ui/final/index";
export interface AirportFlight {
    readonly id: string;
    readonly flight: string;
    readonly destination: string;
    readonly gate: string;
    readonly time?: string;
    readonly status: "EARLY DEPARTURE" | "EARLY" | "ON TIME" | "BOARDING" | "DELAYED" | "DEPARTED" | "GATE OPEN";
}
export interface BillboardState {
    readonly title: string;
    readonly message: string;
    readonly flights: readonly AirportFlight[];
    readonly selectedId?: string;
    readonly flipMs?: number;
    readonly powered?: boolean;
}
export interface BillboardEvents {
    selectFlight: {
        id: string;
    };
}
export const BILLBOARD_WIDTH = 940;
export const BILLBOARD_HEIGHT = 316;
const CHARSET = Array.from(" ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:-/+%$#!?×•→✈");
const CELL_W = .64, CELL_H = .88, GAP = .032, HALF = CELL_H / 2 - GAP / 2;
/** Ported from sky-harbor-splitflap.html: column-major perspective × rotateX. */
export function flapMatrix(degrees: number, perspective = 300): string {
    const radians = degrees * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians), p = -1 / perspective;
    return `matrix3d(1,0,0,0,0,${c},${s},${s * p},0,${-s},${c},${c * p},0,0,0,1)`;
}
const bounce = (t: number) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d)
        return n * t * t;
    if (t < 2 / d)
        return n * (t -= 1.5 / d) * t + .75;
    if (t < 2.5 / d)
        return n * (t -= 2.25 / d) * t + .9375;
    return n * (t -= 2.625 / d) * t + .984375;
};
interface Half {
    element: HTMLDivElement;
    glyph: HTMLSpanElement;
    shade: HTMLDivElement;
}
function half(document: Document, className: string): Half {
    const element = document.createElement("div"), glyph = document.createElement("span"), shade = document.createElement("div");
    element.className = `sf-half ${className}`;
    glyph.className = "sf-glyph";
    shade.className = "sf-shade";
    element.append(glyph, shade);
    return { element, glyph, shade };
}
/** One clock per BILLBOARD, not one requestAnimationFrame/timeout per cell. No idle tasks. */
class FlapClock {
    readonly active = new Set<Cell>();
    private stop?: Dispose;
    reduced = false;
    flipMs = 80;
    flips = 0;
    constructor(private context: HTMLComponentContext<BillboardState, BillboardEvents>, private board: HTMLElement) {
        context.onCleanup(() => { this.stop?.(); this.stop = undefined; this.active.clear(); });
    }
    wake(cell: Cell): void {
        this.active.add(cell);
        this.board.dataset.animatedCells = String(this.active.size);
        if (!this.stop)
            this.stop = this.context.onFrame(dt => {
                for (const item of this.active)
                    if (!item.tick(dt))
                        this.active.delete(item);
                this.board.dataset.animatedCells = String(this.active.size);
                this.board.dataset.flips = String(this.flips);
                if (!this.active.size) {
                    this.stop?.();
                    this.stop = undefined;
                }
            });
    }
    remove(cell: Cell): void {
        this.active.delete(cell);
        if (!this.active.size) {
            this.stop?.();
            this.stop = undefined;
        }
        this.board.dataset.animatedCells = String(this.active.size);
    }
    settle(): void {
        for (const cell of this.active)
            cell.snap();
        this.active.clear();
        this.stop?.();
        this.stop = undefined;
        this.board.dataset.animatedCells = "0";
    }
}
class Cell {
    readonly element: HTMLDivElement;
    private top: Half;
    private bottom: Half;
    private falling: Half;
    private landing: Half;
    current = " ";
    target = " ";
    private to = " ";
    private elapsed = -1;
    private duration = 80;
    private delay = 0;
    constructor(document: Document, private clock: FlapClock, private order: string[]) {
        this.element = document.createElement("div");
        this.element.className = "sf-cell";
        this.top = half(document, "sf-top");
        this.bottom = half(document, "sf-bottom");
        this.falling = half(document, "sf-top sf-flap");
        this.landing = half(document, "sf-bottom sf-flap");
        const hinge = document.createElement("div");
        hinge.className = "sf-hinge";
        this.element.append(this.top.element, this.bottom.element, this.falling.element, this.landing.element, hinge);
        this.paintRest();
    }
    /** The resting display is two ordinary 2D faces. Retire the moving layers
     * completely; visibility:hidden alone leaves their 3D transforms attached. */
    private paintRest(): void {
        this.top.glyph.textContent = this.bottom.glyph.textContent = this.current;
        this.hideFlap(this.falling);
        this.hideFlap(this.landing);
        this.bottom.shade.style.opacity = "0";
        this.element.dataset.character = this.current;
    }
    private hideFlap(flap: Half): void {
        flap.element.hidden = true;
        flap.element.style.removeProperty("transform");
        flap.element.style.removeProperty("will-change");
        flap.shade.style.opacity = "0";
    }
    set(character: string, animate: boolean, delay: number): void {
        if (this.target === character && (animate || this.current === character))
            return;
        this.target = character;
        if (!this.order.includes(character))
            this.order.push(character);
        if (!animate || this.clock.reduced) {
            this.snap();
            this.clock.remove(this);
            return;
        }
        // A retarget changes the destination; finish the in-flight physical flap before advancing.
        if (!this.clock.active.has(this))
            this.delay = delay;
        if (this.current !== character || this.elapsed >= 0)
            this.clock.wake(this);
    }
    snap(): void {
        this.current = this.target;
        this.elapsed = -1;
        this.delay = 0;
        this.paintRest();
    }
    tick(dt: number): boolean {
        if (this.delay > 0) {
            this.delay -= dt;
            return true;
        }
        if (this.elapsed < 0) {
            if (this.current === this.target)
                return false;
            this.to = this.order[(Math.max(0, this.order.indexOf(this.current)) + 1) % this.order.length];
            this.elapsed = 0;
            this.duration = this.clock.flipMs;
            this.top.glyph.textContent = this.to;
            this.bottom.glyph.textContent = this.current;
            this.falling.glyph.textContent = this.current;
            this.landing.glyph.textContent = this.to;
            this.falling.element.style.willChange = this.landing.element.style.willChange = "transform";
        }
        this.elapsed += dt;
        const t = Math.min(1, this.elapsed / this.duration);
        if (t >= 1) {
            this.current = this.to;
            this.elapsed = -1;
            this.clock.flips++;
            this.paintRest();
            return this.current !== this.target;
        }
        if (t < .5) {
            const k = (t * 2) ** 3;
            this.falling.element.style.transform = flapMatrix(-90 * k);
            this.falling.shade.style.opacity = String(.55 * k);
            this.bottom.shade.style.opacity = String(.35 * k);
            this.landing.element.hidden = true;
            this.falling.element.hidden = false;
        }
        else {
            const k = bounce((t - .5) * 2);
            this.landing.element.style.transform = flapMatrix(90 * (1 - k));
            this.landing.shade.style.opacity = String(.5 * (1 - k));
            this.bottom.shade.style.opacity = String(.35 * (1 - k));
            this.falling.element.hidden = true;
            this.landing.element.hidden = false;
        }
        return true;
    }
    dispose(): void { this.clock.remove(this); this.element.remove(); }
}
class FlapRow {
    readonly element: HTMLDivElement;
    readonly cells: Cell[] = [];
    private value = "";
    constructor(document: Document, length: number, private clock: FlapClock) {
        this.element = document.createElement("div");
        this.element.className = "sf-row";
        this.element.setAttribute("aria-hidden", "true");
        const order = CHARSET.slice();
        for (let index = 0; index < length; index++) {
            const cell = new Cell(document, clock, order);
            this.cells.push(cell);
            this.element.appendChild(cell.element);
        }
    }
    set(text: string, animate: boolean): void {
        const characters = Array.from(text.toUpperCase()).slice(0, this.cells.length);
        while (characters.length < this.cells.length)
            characters.push(" ");
        const next = characters.join("");
        if (next === this.value && animate)
            return;
        this.value = next;
        Array.from(next).forEach((character, index) => this.cells[index]?.set(character, animate, (index * 37) % 120));
    }
    dispose(): void { this.cells.forEach(cell => cell.dispose()); this.element.remove(); }
}
const template = `
<section class="billboard" aria-label="Airport departure board" data-animated-cells="0" data-flips="0">
  <header><div class="board-title"></div><div class="board-meta">TERMINAL 01<span>LOCAL DEPARTURES · LIVE</span></div></header>
  <div class="headings"><span>FLIGHT</span><span>DESTINATION</span><span>GATE</span><span>STATUS</span><span class="time">TIME</span></div>
  <div class="departures"></div>
  <footer><span class="live-dot"></span><div class="board-message"></div><span class="maker">SH / 01</span></footer>
  <i class="screw tl"></i><i class="screw tr"></i><i class="screw bl"></i><i class="screw br"></i>
</section>`;
// Never promote stationary halves with backface-visibility or will-change:
// an idle projected board must not retain hundreds of independent 3D layers.
// Keep moving flap/hinge z-order local to each character.
const styles = `
.time,.sf-row.time{display:none}:host([data-timetable=on]) .time{display:inline-flex}
.status .sf-cell:nth-child(n+10){display:none}:host([data-timetable=on]) .status .sf-cell:nth-child(n+10),.flight-row[data-status="EARLY DEPARTURE"] .status .sf-cell:nth-child(n+10){display:block}
:host(:not([data-timetable=on])) .flight-row[data-status="EARLY DEPARTURE"] .status{font-size:22px}
:host([data-timetable=on]) .headings,:host([data-timetable=on]) .flight-row{grid-template-columns:114px 244px 56px 284px 114px;column-gap:14px}
:host([data-timetable=on]) .flight-row{font-size:30px}
:host([data-timetable=on]) .flight-row .status{font-size:27px}
:host([data-timetable=on]) .flight-row>:nth-child(2){font-size:29px}

:host{--sf-ink:#ffe29a;--sf-tile:#222b2c;--sf-font:ui-monospace,"Liberation Mono",Consolas,monospace;display:block;width:100%;height:100%;line-height:1}
.billboard{position:relative;width:${BILLBOARD_WIDTH}px;height:${BILLBOARD_HEIGHT}px;padding:18px 24px 15px;background:#111a1c;color:#f5d36f;border:5px solid #304244;border-radius:9px;box-shadow:0 7px 0 #102126,0 13px 17px #081c204d,inset 0 0 0 2px #080f11;overflow:hidden}
header{display:flex;align-items:center;justify-content:space-between;height:49px;margin-bottom:11px}.board-title{font-size:44px;--sf-ink:#ffc947}.board-meta{text-align:right;font:700 13px/1.5 system-ui;letter-spacing:2px;color:#bfd0cd}.board-meta span{display:block;font-size:9px;letter-spacing:1.6px;color:#8daba6}
.headings,.flight-row{display:grid;grid-template-columns:126px 306px 84px 236px;column-gap:25px;align-items:center}.headings{height:20px;color:#829d98;font:600 10px/1 system-ui;letter-spacing:2px;padding:0 6px}
.departures{height:158px}.flight-row{width:100%;height:38px;padding:3px 6px;margin:0 0 2px;border:0;border-radius:3px;background:transparent;box-shadow:none;cursor:pointer;text-align:left;font-size:32px;touch-action:manipulation;transition:none}.flight-row:hover{background:#344239}.flight-row[aria-pressed=true]{background:#405547;box-shadow:inset 3px 0 #e8c767}.flight-row:focus-visible{outline:2px solid #8ddace;outline-offset:0}.flight-row:disabled{cursor:default;opacity:.6}.flight-row .status{--sf-ink:#ffcc65}.flight-row[data-status=DELAYED] .status{--sf-ink:#ff917d}.flight-row[data-status=BOARDING] .status{--sf-ink:#9ad1a8}.flight-row[data-status=DEPARTED] .status{--sf-ink:#79908e}
footer{display:flex;align-items:center;gap:13px;margin-top:8px;padding-top:10px;border-top:1px solid #314043}.board-message{font-size:24px;--sf-ink:#a8dabb}.live-dot{width:5px;height:5px;background:#a8dabb;border-radius:50%;box-shadow:0 0 8px #77cd92}.maker{margin-left:auto;font:600 10px system-ui;letter-spacing:2px;color:#718b83}
.screw{position:absolute;width:5px;height:5px;border-radius:50%;background:linear-gradient(130deg,#788783 44%,#142320 47% 55%,#788783 57%);box-shadow:0 0 0 1px #0c1415}.tl{top:4px;left:4px}.tr{top:4px;right:4px}.bl{bottom:4px;left:4px}.br{bottom:4px;right:4px}
:host([data-power=off]) .sf-row,:host([data-power=off]) .live-dot{opacity:.13}
.sf-row{display:inline-flex;gap:.065em;font-family:var(--sf-font);font-weight:700;vertical-align:top}.sf-cell{position:relative;width:${CELL_W}em;height:${CELL_H}em;flex:none;isolation:isolate}
.sf-half{position:absolute;left:0;width:100%;height:${HALF}em;overflow:hidden;background:var(--sf-tile);color:var(--sf-ink)}.sf-top{top:0;border-radius:.05em .05em 0 0;transform-origin:50% calc(100% + ${GAP / 2}em);background:linear-gradient(#2d3737,#222b2c)}.sf-bottom{top:${CELL_H / 2 + GAP / 2}em;border-radius:0 0 .05em .05em;transform-origin:50% -${GAP / 2}em}
.sf-glyph{position:absolute;left:0;width:100%;height:${CELL_H}em;line-height:${CELL_H}em;white-space:pre;text-align:center;letter-spacing:0}.sf-top .sf-glyph{top:0}.sf-bottom .sf-glyph{top:-${CELL_H / 2 + GAP / 2}em}.sf-shade{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none}.sf-flap{z-index:2;backface-visibility:hidden}.sf-flap[hidden]{display:none!important}.sf-hinge{position:absolute;top:${CELL_H / 2 - GAP / 2}em;height:${GAP}em;left:-.02em;right:-.02em;z-index:3;background:linear-gradient(90deg,#0a1314 0 .05em,transparent .05em calc(100% - .05em),#0a1314 0)}
`;
interface FlightView {
    element: HTMLButtonElement;
    columns: FlapRow[];
    stop: Dispose;
}
export const SplitFlapBillboard = defineHTMLComponent<BillboardState, BillboardEvents>({
    name: "sky-harbor/split-flap-billboard", template, styles,
    setup(context) {
        const board = context.query(".billboard"), container = context.query(".departures");
        const clock = new FlapClock(context, board);
        const title = new FlapRow(context.document, 10, clock), message = new FlapRow(context.document, 24, clock);
        context.query(".board-title").append(title.element);
        context.query(".board-message").append(message.element);
        const flights = new Map<string, FlightView>();
        let mounted = false, commits = 0;
        context.bind(() => context.reducedMotion.get() || context.state.get().powered === false, reduced => {
            clock.reduced = reduced;
            if (reduced)
                clock.settle();
        });
        context.bind(context.state, state => {
            if (!Array.isArray(state.flights) || state.flights.length > 4 || new Set(state.flights.map(flight => flight.id)).size !== state.flights.length || state.flights.some(flight => !flight.id))
                throw new Error("SPLIT_FLAP_STATE: expected up to four flights with unique nonempty IDs");
            if (typeof state.title !== "string" || typeof state.message !== "string" || state.flights.some(flight => ![flight.flight, flight.destination, flight.gate, flight.status].every(value => typeof value === "string")))
                throw new Error("SPLIT_FLAP_STATE: display values must be strings");
            if (state.flights.some(flight => flight.time !== undefined && typeof flight.time !== 'string')) throw new Error('SPLIT_FLAP_STATE: time must be a string');
            context.host.dataset.timetable = state.flights.some(flight => flight.time !== undefined) ? 'on' : 'off';
            const duration = state.flipMs ?? 80;
            if (!Number.isFinite(duration) || duration < 16 || duration > 2000)
                throw new Error("SPLIT_FLAP_STATE: flipMs must be 16..2000");
            clock.flipMs = duration;
            context.host.dataset.power = state.powered === false ? "off" : "on";
            const animate = mounted && !clock.reduced && state.powered !== false;
            title.set(state.title, animate);
            message.set(state.message, animate);
            context.query(".board-message").setAttribute("aria-label", state.message);
            board.setAttribute("aria-label", `${state.title} departure board${state.powered === false ? ", powered off" : ""}`);
            const ids = new Set(state.flights.map(flight => flight.id));
            for (const [id, view] of flights)
                if (!ids.has(id)) {
                    view.stop();
                    view.columns.forEach(column => column.dispose());
                    view.element.remove();
                    flights.delete(id);
                }
            const focused = context.root.activeElement as HTMLElement | null;
            let before: ChildNode | null = container.firstChild;
            for (const flight of state.flights) {
                let view = flights.get(flight.id);
                const existed = !!view;
                if (!view) {
                    const element = context.document.createElement("button");
                    element.type = "button";
                    element.className = "flight-row";
                    element.dataset.focus = `flight-${flight.id}`;
                    element.dataset.flight = flight.id;
                    const columns = [5, 12, 3, 15, 5].map(length => new FlapRow(context.document, length, clock));
                    columns[3].element.classList.add("status");
                    columns[4].element.classList.add("time");
                    columns.forEach(column => element.append(column.element));
                    const stop = context.listen(element, "click", () => context.emit("selectFlight", { id: flight.id }));
                    view = { element, columns, stop };
                    flights.set(flight.id, view);
                }
                // Do not move retained rows on value-only updates (preserves native focus/caret).
                if (view.element !== before)
                    container.insertBefore(view.element, before);
                before = view.element.nextSibling;
                view.element.dataset.status = flight.status;
                view.element.disabled = state.powered === false;
                view.element.setAttribute("aria-label", `${flight.flight}, ${flight.destination}, gate ${flight.gate}, ${flight.status}${flight.time ? `, ${flight.time}` : ''}`);
                view.element.setAttribute("aria-pressed", String(flight.id === state.selectedId));
                [flight.flight, flight.destination, flight.gate, flight.status, flight.time ?? ''].forEach((value, index) => view!.columns[index].set(value, animate && existed));
            }
            if (focused?.isConnected && context.root.activeElement !== focused)
                focused.focus({ preventScroll: true });
            mounted = true;
            board.dataset.stateCommits = String(++commits);
            context.refreshFocus();
        });
        return () => { title.dispose(); message.dispose(); for (const view of flights.values())
            view.columns.forEach(column => column.dispose()); flights.clear(); };
    },
});
