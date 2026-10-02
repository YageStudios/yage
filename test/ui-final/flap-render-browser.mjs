// Real-paint fixture. Each UI tick yields to the browser; synchronous DOM-only
// tests do not exercise compositor promotion, clipping, or layer retirement.
import { UIFinal, signal, Panel, WorldSurface, isometricSurface } from "../../.ui-final-build/engine/ui/final/index.js";
import { SplitFlapBillboard, BILLBOARD_WIDTH, BILLBOARD_HEIGHT } from "../../.ui-final-build/examples/ui-final-airport/split-flap.js";
import { initialBillboard } from "../../.ui-final-build/examples/ui-final-airport/demo.js";

let fixture;
const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
function mount(pose, scale, state) {
    fixture?.ui.dispose();
    const ui = new UIFinal({ host: document.body, placement: "inline", scheduling: "manual" });
    ui.setReducedMotion(false); // Do not let the test machine's accessibility setting skip the animation.
    const model = signal(state);
    const surface = pose === "flat"
        ? { width: BILLBOARD_WIDTH, height: BILLBOARD_HEIGHT, origin: { x: 24.375, y: 40.625 }, xAxis: { x: BILLBOARD_WIDTH, y: 0 }, yAxis: { x: 0, y: BILLBOARD_HEIGHT } }
        : isometricSurface({ plane: pose, position: { x: 0, y: 0, z: 0 }, width: BILLBOARD_WIDTH, height: BILLBOARD_HEIGHT, worldUnitsPerPixel: .535, camera: { origin: { x: pose === "wall-y" ? 555.375 : 24.375, y: 40.625 } } });
    ui.mount(Panel({ style: { position: "relative", width: 1100, height: 720, transform: `translate(13.375px,9.625px) scale(${scale})`, transformOrigin: "0 0" } },
        WorldSurface({ pose: surface }, SplitFlapBillboard({ id: "render-board", state: model }))));
    fixture = { ui, model, pose, scale, fallingFrames: 0, landingFrames: 0 };
    return fixture;
}
function shadow() { return fixture.ui.element("render-board").shadowRoot; }
async function frames(count, dt = 16) {
    for (let i = 0; i < count; i++) {
        // Advance inside a browser frame and schedule the next tick for the
        // following RAF, so every intermediate pose has a paint opportunity.
        await new Promise(resolve => requestAnimationFrame(() => {
            fixture.ui.frame(dt);
            for (const phase of ["top", "bottom"]) {
                const visible = [...shadow().querySelectorAll(`.sf-${phase}.sf-flap`)].some(flap => {
                    const style = getComputedStyle(flap);
                    return style.display !== "none" && style.visibility === "visible";
                });
                if (visible) fixture[phase === "top" ? "fallingFrames" : "landingFrames"]++;
            }
            resolve();
        }));
    }
}
async function settle() {
    for (let i = 0; i < 240 && fixture.ui.frameTaskCount; i++) await frames(1);
    if (fixture.ui.frameTaskCount) throw new Error("flaps did not settle within 240 painted ticks");
    if (fixture.ui.errors.length) throw new Error(fixture.ui.errors.map(String).join("\n"));
    await paint();
}
const target = {
    ...initialBillboard, title: "SKY HARBOR", message: "WELCOME TO SKY HARBOR", flipMs: 48,
    flights: initialBillboard.flights.map((flight, index) => ({ ...flight, flight: `SH${111 + index * 114}`, destination: ["LISBON", "NAIROBI", "SEOUL", "OSLO"][index], gate: ["A02", "A05", "B08", "B11"][index], status: ["BOARDING", "GATE OPEN", "DELAYED", "ON TIME"][index] })),
};
window.flapRender = {
    async setup(pose = "wall-x", scale = .73) {
        // Seed numeric cells one drum position behind the target. The DPI/pose
        // matrix then exercises real falling/landing paints without spending
        // dozens of identical revolutions on each screenshot. retarget() below
        // separately covers long wraps, spaces, and interruption mid-flight.
        const precedingDigit = text => text.slice(0, -1) + String(Number(text.slice(-1)) - 1);
        mount(pose, scale, { ...target, flights: target.flights.map(flight => ({ ...flight, flight: precedingDigit(flight.flight), gate: precedingDigit(flight.gate) })) });
        await paint();
    },
    async exercise() {
        // The title intentionally remains unchanged here: the reported missing S
        // belongs to the title, not the departure rows that were updated.
        fixture.model.set(target);
        fixture.ui.flush();
        await settle();
    },
    async retarget() {
        fixture.model.update(state => ({ ...state, title: "DEPARTURES", message: "GATE A12 IS OPEN" }));
        fixture.ui.flush();
        await frames(8);
        fixture.model.update(state => ({ ...state, title: "          ", message: "" }));
        fixture.ui.flush();
        await frames(4);
        fixture.model.set(target);
        fixture.ui.flush();
        await settle();
    },
    async interrupt(mode) {
        fixture.model.update(state => ({ ...state, title: "ZZZZZZZZZZ", message: "POWER CHECK", flipMs: 80 }));
        fixture.ui.flush();
        await frames(1, mode === "power" ? 56 : 16);
        if (mode === "power") fixture.model.update(state => ({ ...state, powered: false }));
        else fixture.ui.setReducedMotion(true);
        fixture.ui.flush();
        await paint();
        if (fixture.ui.frameTaskCount) throw new Error("interrupted board still has an animation task");
    },
    async reference() {
        const { pose, scale, model } = fixture;
        mount(pose, scale, model.peek());
        // Independent static reference: cold-mount from EXPECTED STATE, remove
        // moving overlays entirely and opt fixed faces out of backface culling.
        // Do not copy glyphs or markup from the animated component under test.
        shadow().querySelectorAll(".sf-flap").forEach(flap => flap.remove());
        const style = document.createElement("style");
        style.textContent = ".sf-half { backface-visibility:visible!important; transform:none!important; will-change:auto!important; }";
        shadow().append(style);
        await paint();
    },
    async hideFirstUpperFace() {
        shadow().querySelector(".board-title .sf-top:not(.sf-flap)").style.visibility = "hidden";
        await paint();
    },
    state() {
        const cells = [...shadow().querySelectorAll(".sf-cell")];
        return { fallingFrames: fixture.fallingFrames, landingFrames: fixture.landingFrames, tasks: fixture.ui.frameTaskCount, errors: fixture.ui.errors.map(String), cells: cells.length,
            upper: cells.map(cell => cell.querySelector(".sf-top:not(.sf-flap) .sf-glyph").textContent),
            lower: cells.map(cell => cell.querySelector(".sf-bottom:not(.sf-flap) .sf-glyph").textContent),
            transforms: [...shadow().querySelectorAll(".sf-flap")].filter(flap => flap.style.transform || flap.style.willChange).length,
            renderedFlaps: [...shadow().querySelectorAll(".sf-flap")].filter(flap => getComputedStyle(flap).display !== "none").length,
            culledFixedFaces: [...shadow().querySelectorAll(".sf-half:not(.sf-flap)")].filter(face => getComputedStyle(face).backfaceVisibility !== "visible").length };
    },
    dispose() { fixture?.ui.dispose(); fixture = undefined; },
};
