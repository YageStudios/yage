import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browserBundle } from "./ui-final-browser-bundle.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.argv.includes("--no-build"))
    execFileSync(process.execPath, ["scripts/build-ui-final.mjs"], { cwd: root, stdio: "inherit" });
const { chromium } = await import(process.env.UI_FINAL_PLAYWRIGHT_MODULE || "playwright-core");
const browser = await chromium.launch({ executablePath: process.env.UI_FINAL_BROWSER || undefined, headless: true, args: ["--no-sandbox"] });
const outputDirectory = process.env.UI_FINAL_SCREENSHOT_DIR;
if (outputDirectory) await mkdir(outputDirectory, { recursive: true });
const results = [], uncaught = [], layerSamples = [], pixelSamples = [];
const deviceScaleFactors = process.argv.includes("--smoke") ? [1] : [1, 1.25, 2];
async function check(name, run) {
    try { await run(); results.push({ name, pass: true }); console.error(`PASS ${name}`); }
    catch (error) { results.push({ name, pass: false, error: String(error.stack ?? error) }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function save(name, png) {
    if (outputDirectory) await writeFile(resolve(outputDirectory, `${name}.png`), png);
}
// Browser compositors may change edge antialiasing after retiring a layer.
// Compare decoded pixels rather than PNG compression bytes. No pixel may differ
// by more than 32/255 in any channel; the hidden-upper-S negative control below
// proves this allowance cannot conceal the reported kind of missing face.
const maxChannelDelta = 32;
async function comparePixels(page, actual, expected) {
    if (actual.equals(expected)) return { significantPixels: 0, maximumDelta: 0 };
    return page.evaluate(async ({ actual, expected, tolerance }) => {
        async function decode(png) {
            const image = new Image();
            image.src = `data:image/png;base64,${png}`;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d", { willReadFrequently: true });
            if (!context) throw new Error("2D canvas unavailable for pixel comparison");
            context.drawImage(image, 0, 0);
            return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
        }
        const [a, b] = await Promise.all([decode(actual), decode(expected)]);
        if (a.width !== b.width || a.height !== b.height) throw new Error("screenshot dimensions changed");
        let significantPixels = 0, maximumDelta = 0;
        for (let i = 0; i < a.pixels.length; i += 4) {
            const delta = Math.max(Math.abs(a.pixels[i] - b.pixels[i]), Math.abs(a.pixels[i + 1] - b.pixels[i + 1]), Math.abs(a.pixels[i + 2] - b.pixels[i + 2]), Math.abs(a.pixels[i + 3] - b.pixels[i + 3]));
            maximumDelta = Math.max(maximumDelta, delta);
            if (delta > tolerance) significantPixels++;
        }
        return { significantPixels, maximumDelta };
    }, { actual: actual.toString("base64"), expected: expected.toString("base64"), tolerance: maxChannelDelta });
}
function assertFlat(state) {
    assert.equal(state.tasks, 0, "idle animation tasks");
    assert.deepEqual(state.errors, []);
    assert.equal(state.cells, 150);
    assert.deepEqual(state.upper, state.lower, "committed upper/lower glyphs disagree");
    assert.equal(state.culledFixedFaces, 0, "stationary glyphs still use backface culling");
    assert.equal(state.renderedFlaps, 0, "inactive overlays still participate in rendering");
    assert.equal(state.transforms, 0, "completed overlays retain 3D state");
}
try {
    const bundle = browserBundle(root, "test/ui-final/flap-render-browser.mjs");
    for (const dpr of deviceScaleFactors) {
        const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: dpr });
        page.on("pageerror", error => uncaught.push(String(error)));
        const session = await page.context().newCDPSession(page);
        let layers = [];
        session.on("LayerTree.layerTreeDidChange", event => { layers = event.layers ?? []; });
        await session.send("LayerTree.enable");
        try {
            await page.setContent('<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:"></head><body style="margin:0;background:#e6ecdc"></body></html>');
            await page.addScriptTag({ content: bundle });
            for (const [pose, scale] of [["wall-x", .51], ["wall-x", .73], ["wall-y", .73], ["flat", 1]]) {
                const label = `${pose}-${scale}-dpr${dpr}`;
                await page.evaluate(({ pose, scale }) => window.flapRender.setup(pose, scale), { pose, scale });
                await check(`${label}: cold mount has flat fixed faces and no rendering overlays`, async () => {
                    assertFlat(await page.evaluate(() => window.flapRender.state()));
                });
                await page.evaluate(() => window.flapRender.exercise());
                await check(`${label}: painted animation completion releases all transient 3D state`, async () => {
                    const state = await page.evaluate(() => window.flapRender.state());
                    assertFlat(state);
                    assert.ok(state.fallingFrames > 0 && state.landingFrames > 0, "test must paint both moving phases, not just snap to the destination");
                });
                const animated = await page.screenshot();
                layerSamples.push({ label, count: layers.length });
                await save(`${label}-settled`, animated);
                await check(`${label}: settled compositor layer count stays below 20`, async () => {
                    // A loose Chromium smoke-test budget, not a portable performance contract.
                    // The old board creates ~300 layers even with its animation clock stopped.
                    assert.ok(layers.length < 20, `${layers.length} compositor layers for an idle board`);
                });
                await page.evaluate(() => window.flapRender.reference());
                const expected = await page.screenshot();
                await save(`${label}-reference`, expected);
                await check(`${label}: settled pixels match a cold flat-face reference`, async () => {
                    const comparison = await comparePixels(page, animated, expected);
                    pixelSamples.push({ label, ...comparison });
                    assert.equal(comparison.significantPixels, 0, `settled pixels differ from the flat-face reference: ${JSON.stringify(comparison)}`);
                });
                // Check the oracle itself: a missing upper S MUST change the pixels,
                // even though data-character and both text nodes still contain S.
                if (pose === "wall-x" && scale === .51) {
                    await page.evaluate(() => window.flapRender.hideFirstUpperFace());
                    const missing = await page.screenshot();
                    await save(`${label}-negative-control`, missing);
                    await check(`${label}: pixel oracle detects a hidden upper S with intact state`, async () => {
                        const state = await page.evaluate(() => window.flapRender.state());
                        assert.equal(state.upper[0], "S");
                        assert.equal(state.lower[0], "S");
                        const comparison = await comparePixels(page, missing, expected);
                        pixelSamples.push({ label: `${label}-negative-control`, ...comparison });
                        assert.ok(comparison.significantPixels > 0, "oracle missed an invisible upper face");
                    });
                }
            }
            for (const mode of ["retarget", "reduced", "power"]) {
                const label = `${mode}-dpr${dpr}`;
                await page.evaluate(() => window.flapRender.setup("wall-x", .73));
                if (mode === "retarget") await page.evaluate(() => window.flapRender.retarget());
                else await page.evaluate(mode => window.flapRender.interrupt(mode), mode);
                await check(`${label}: endpoint releases 3D state`, async () => assertFlat(await page.evaluate(() => window.flapRender.state())));
                const actual = await page.screenshot();
                await page.evaluate(() => window.flapRender.reference());
                const expected = await page.screenshot();
                await save(`${label}-actual`, actual);
                await save(`${label}-reference`, expected);
                await check(`${label}: endpoint pixels match the static reference`, async () => {
                    const comparison = await comparePixels(page, actual, expected);
                    pixelSamples.push({ label, ...comparison });
                    assert.equal(comparison.significantPixels, 0, `endpoint pixels differ from the flat-face reference: ${JSON.stringify(comparison)}`);
                });
            }
            await page.evaluate(() => window.flapRender.dispose());
        } finally { await session.detach(); await page.close(); }
    }
    await check("no unhandled browser exceptions", () => assert.deepEqual(uncaught, []));
    const report = { browser: await browser.version(), deviceScaleFactors, layerSamples, pixelSamples, pixelComparison: { maxChannelDelta, allowedPixelsAboveThreshold: 0, reference: "same browser and viewport, cold expected state with moving layers removed" }, results, passed: results.filter(result => result.pass).length, failed: results.filter(result => !result.pass).length };
    console.log(JSON.stringify(report, null, 2));
    if (report.failed) process.exitCode = 1;
} finally { await browser.close(); }
