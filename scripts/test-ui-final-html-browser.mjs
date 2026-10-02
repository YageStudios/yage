import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browserBundle } from "./ui-final-browser-bundle.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.argv.includes("--no-build"))
    execFileSync(process.execPath, ["scripts/build-ui-final.mjs"], { cwd: root, stdio: "inherit" });
const { chromium } = await import(process.env.UI_FINAL_PLAYWRIGHT_MODULE || "playwright-core");
const browser = await chromium.launch({ executablePath: process.env.UI_FINAL_BROWSER || undefined, headless: true, args: ["--no-sandbox"] });
const results = [];
const uncaught = [];
const check = async (name, fn) => { try {
    await fn();
    results.push({ name, pass: true });
}
catch (error) {
    results.push({ name, pass: false, error: String(error.stack ?? error) });
} };
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1040 }, hasTouch: true });
    page.on("pageerror", error => uncaught.push(String(error)));
    page.setDefaultTimeout(6000);
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:"></head><body style="margin:0"></body></html>');
    await page.addScriptTag({ content: browserBundle(root, "test/ui-final/html-browser.mjs") });
    results.push(...await page.evaluate(() => window.runUIFinalHTMLTests()));
    await page.evaluate(() => window.setupNativeHTMLTest());
    await check("NATIVE: shadow input typing and caret movement remain native", async () => {
        const input = page.locator('[data-uif-id="native-html"] input');
        await input.focus();
        await page.keyboard.type("Sky Harbor");
        await page.keyboard.press("ArrowLeft");
        await page.keyboard.type("!");
        if (await input.inputValue() !== "Sky Harbo!r")
            throw new Error(await input.inputValue());
    });
    await check("NATIVE: shadow Enter, Space, pointer and touch activate exactly once each", async () => {
        const button = page.getByRole("button", { name: "Shadow action", exact: true });
        await button.focus();
        await page.keyboard.press("Enter");
        await page.keyboard.press("Space");
        await button.click();
        await button.tap();
        const count = await page.evaluate(() => window.nativeHTML.clicks);
        if (count !== 4)
            throw new Error(`expected 4, got ${count}`);
    });
    await check("NATIVE: Tab crosses into, within and out of a shadow component", async () => {
        await page.locator('[data-uif-id="native-before"]').focus();
        await page.keyboard.press("Tab");
        const current = () => page.evaluate(() => window.nativeHTML.ui.focus.current());
        if (await current() !== "native-html/edit")
            throw new Error(await current());
        await page.keyboard.press("Tab");
        if (await current() !== "native-html/button")
            throw new Error(await current());
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        if (await current() !== "native-after")
            throw new Error(await current());
    });
    await check("NATIVE: pointer capture continues dragging outside shadow control bounds", async () => {
        const box = await page.getByRole("button", { name: "Shadow drag" }).boundingBox();
        await page.mouse.move(box.x + 10, box.y + 10);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width + 130, box.y + box.height + 70, { steps: 4 });
        await page.mouse.up();
        const state = await page.evaluate(() => ({ moves: window.nativeHTML.pointerMoves, captures: window.nativeHTML.captures }));
        if (state.captures !== 1 || state.moves < 1)
            throw new Error(JSON.stringify(state));
    });
    await page.evaluate(() => window.cleanupHTMLTests());
    await page.addScriptTag({ content: browserBundle(root, "examples/ui-final-airport/offline.mjs") });
    await page.waitForFunction(() => !!window.skyHarborAirportDemo?.ui.element("departure-board"));
    await check("DEMO: EARLY DEPARTURE and BOARDING fit the desktop and mobile timetable", async () => {
        const screenshots = process.env.UI_FINAL_SCREENSHOT_DIR;
        if (screenshots)
            await mkdir(screenshots, { recursive: true });
        const originalBoard = await page.evaluate(() => window.skyHarborAirportDemo.board.peek());
        await page.evaluate(() => {
            const demo = window.skyHarborAirportDemo;
            demo.ui.setReducedMotion(true);
            demo.board.update(state => ({ ...state, flights: state.flights.map((flight, index) => ({
                ...flight,
                status: index === 0 ? "EARLY DEPARTURE" : index === 1 ? "BOARDING" : flight.status,
                time: "09:45",
            })) }));
            demo.ui.flush();
        });
        const layouts = [];
        for (const [label, viewport] of [["desktop", { width: 1440, height: 1040 }], ["mobile", { width: 390, height: 844 }]]) {
            await page.setViewportSize(viewport);
            await page.waitForTimeout(80);
            const layout = await page.evaluate(() => {
                const board = document.querySelector('[data-uif-id="departure-board"]')?.shadowRoot;
                const early = board?.querySelector('.flight-row[data-status="EARLY DEPARTURE"]');
                const boarding = board?.querySelector('.flight-row[data-status="BOARDING"]');
                if (!early || !boarding)
                    throw new Error("EARLY DEPARTURE or BOARDING row is missing");
                const status = early.querySelector(".status");
                const time = early.querySelector(".time");
                const cells = [...status.querySelectorAll(".sf-cell")];
                const statusBounds = status.getBoundingClientRect();
                const timeBounds = time.getBoundingClientRect();
                return {
                    viewport: { width: innerWidth, height: innerHeight },
                    earlyLabel: early.getAttribute("aria-label"),
                    boardingLabel: boarding.getAttribute("aria-label"),
                    earlyText: [...status.querySelectorAll(".sf-cell")].map(cell => cell.dataset.character ?? " ").join("").trimEnd(),
                    boardingText: [...boarding.querySelector(".status").querySelectorAll(".sf-cell")].map(cell => cell.dataset.character ?? " ").join("").trimEnd(),
                    visibleStatusGlyphs: cells.filter(cell => getComputedStyle(cell).display !== "none").length,
                    statusRight: statusBounds.right,
                    timeLeft: timeBounds.left,
                    billBoardBounds: board.querySelector(".billboard").getBoundingClientRect().toJSON(),
                };
            });
            if (layout.earlyText !== "EARLY DEPARTURE" || layout.visibleStatusGlyphs !== 15 || layout.boardingText !== "BOARDING")
                throw new Error(`${label}: status glyphs do not render fully: ${JSON.stringify(layout)}`);
            if (layout.statusRight > layout.timeLeft + 1)
                throw new Error(`${label}: EARLY DEPARTURE overlaps TIME: ${JSON.stringify(layout)}`);
            layouts.push({ label, ...layout });
            if (screenshots)
                await page.screenshot({ path: resolve(screenshots, `airport-${label}-early-departure.png`), fullPage: true });
        }
        console.log(`EARLY DEPARTURE LAYOUT ${JSON.stringify(layouts)}`);
        await page.setViewportSize({ width: 1440, height: 1040 });
        await page.evaluate(original => {
            const demo = window.skyHarborAirportDemo;
            demo.board.set(original);
            demo.ui.flush();
        }, originalBoard);
    });
    await check("DEMO: actual projected wall hit-testing selects the flight and retains the board", async () => {
        await page.getByRole("button", { name: "SH218, SEOUL, gate A07, ON TIME" }).click();
        await page.waitForFunction(() => window.skyHarborAirportDemo.board.peek().selectedId === "sh218");
        await page.evaluate(() => window.originalAirportBoard = window.skyHarborAirportDemo.ui.element("departure-board"));
        await page.locator('[data-uif-id="change-gate"]').click();
        await page.waitForFunction(() => window.skyHarborAirportDemo.board.peek().flights[1].gate === "A12");
        if (!await page.evaluate(() => window.originalAirportBoard === window.skyHarborAirportDemo.ui.element("departure-board")))
            throw new Error("board remounted");
    });
    await check("DEMO: announcement and departure actions go through the command queue", async () => {
        await page.locator('[data-uif-id="announcement"]').fill("GATE 12 IS OPEN");
        await page.locator('[data-uif-id="publish-message"]').click();
        await page.waitForFunction(() => window.skyHarborAirportDemo.board.peek().message === "GATE 12 IS OPEN");
        await page.locator('[data-uif-id="new-departures"]').click();
        await page.waitForFunction(() => window.skyHarborAirportDemo.board.peek().flights[0].flight === "SH111");
    });
    await check("DEMO: front inspection and isometric zoom preserve DOM and surface interaction", async () => {
        await page.locator('[data-uif-id="toggle-flat"]').click();
        await page.waitForFunction(() => window.skyHarborAirportDemo.flat.peek());
        await page.evaluate(() => { window.skyHarborAirportDemo.zoom.set(1.15); window.skyHarborAirportDemo.ui.flush(); });
        if (!await page.evaluate(() => window.originalAirportBoard === window.skyHarborAirportDemo.ui.element("departure-board")))
            throw new Error("board remounted");
        await page.locator('[data-uif-id="toggle-flat"]').click();
    });
    // Settle for deterministic screenshots and then restore motion for the standalone artifact.
    await page.evaluate(() => { const demo = window.skyHarborAirportDemo; demo.ui.setReducedMotion(true); demo.zoom.set(1); demo.board.set({ ...demo.board.peek(), ...{ title: "SKY HARBOR", message: "WELCOME TO SKY HARBOR", selectedId: "sh104", flights: [{ id: "sh104", flight: "SH104", destination: "LISBON", gate: "A04", status: "BOARDING" }, { id: "sh218", flight: "SH218", destination: "SEOUL", gate: "A07", status: "ON TIME" }, { id: "sh306", flight: "SH306", destination: "OSLO", gate: "B02", status: "GATE OPEN" }, { id: "sh442", flight: "SH442", destination: "CAIRO", gate: "B08", status: "DELAYED" }] } }); demo.draft.set("WELCOME TO SKY HARBOR"); demo.ui.flush(); });
    const screenshots = process.env.UI_FINAL_SCREENSHOT_DIR;
    if (screenshots) {
        await mkdir(screenshots, { recursive: true });
        await page.screenshot({ path: resolve(screenshots, "airport-desktop.png"), fullPage: true });
        await page.locator('[data-uif-id="toggle-flat"]').click();
        await page.screenshot({ path: resolve(screenshots, "airport-inspection.png"), fullPage: true });
        await page.locator('[data-uif-id="toggle-flat"]').click();
    }
    await check("DEMO: 390px mobile layout has no horizontal overflow and supports touch inspection", async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(80);
        const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
        if (size.scroll > size.width + 1)
            throw new Error(JSON.stringify(size));
        await page.locator('[data-uif-id="toggle-flat"]').tap();
        await page.waitForFunction(() => window.skyHarborAirportDemo.flat.peek());
        await page.getByRole("button", { name: "SH218, SEOUL, gate A07, ON TIME" }).tap();
        await page.waitForFunction(() => window.skyHarborAirportDemo.board.peek().selectedId === "sh218");
        await page.locator('[data-uif-id="toggle-flat"]').tap();
        if (screenshots)
            await page.screenshot({ path: resolve(screenshots, "airport-mobile.png"), fullPage: true });
    });
    await check("DEMO: disposing during animation releases every Final scope, frame task and host", async () => {
        const remaining = await page.evaluate(() => { const demo = window.skyHarborAirportDemo; demo.ui.setReducedMotion(false); demo.board.update(state => ({ ...state, message: "CLOSING TERMINAL" })); demo.ui.flush(); demo.dispose(); return { tasks: demo.ui.frameTaskCount, scopes: demo.ui.scope.resources, focus: demo.ui.focus.size, root: demo.ui.root.isConnected, errors: demo.ui.errors.map(String) }; });
        if (remaining.tasks || remaining.scopes || remaining.focus || remaining.root || remaining.errors.length)
            throw new Error(JSON.stringify(remaining));
    });
    await check("BROWSER: actual Trusted Types enforcement accepts only the application's policy", async () => {
        const trustedPage = await browser.newPage();
        try {
            const bundle = browserBundle(root, "test/ui-final/html-browser.mjs").replaceAll("</script", "<\\/script");
            await trustedPage.setContent(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; require-trusted-types-for 'script'; trusted-types ui-final-html-test"></head><body><script>${bundle}</script></body></html>`);
            await trustedPage.evaluate(() => window.runTrustedHTMLTest());
        }
        finally {
            await trustedPage.close();
        }
    });
    results.push({ name: "no unhandled browser exceptions", pass: !uncaught.length, ...(uncaught.length ? { error: uncaught.join("\n") } : {}) });
    const output = { browser: await browser.version(), networkAssets: false, cspUnsafeEval: false, results, passed: results.filter(result => result.pass).length, failed: results.filter(result => !result.pass).length };
    console.log(JSON.stringify(output, null, 2));
    if (output.failed)
        process.exitCode = 1;
}
finally {
    await browser.close();
}
