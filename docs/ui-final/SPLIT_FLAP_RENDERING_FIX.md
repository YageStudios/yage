# Split-flap board: settled-face rendering investigation

## Scope and confidence

This patch targets the latest supplied `Sky-Harbor-context.zip`, containing the integrated HTML-component support. The production change is confined to `examples/ui-final-airport/split-flap.ts`. There is no UI Final API change, asset migration, font replacement, or change to the world-surface projection. The original `sky-harbor-splitflap.html` is unchanged.

The reported symptom is an upper character half disappearing after the board has finished animating. In the supplied screenshot, the first `S` in the title is an example.

**Confirmed:** the original implementation keeps the stationary faces in the browser's backface/compositing path and leaves completed moving flaps with their final `matrix3d` values. Both are unnecessary for a settled board. The original code fails the new rendering-state, compositor-budget, and visual-reference tests; the patched code passes.

**Not confirmed:** the exact missing upper `S` shown in the user's screenshot did not reproduce in this Linux Chromium environment. The compositing setup is a likely explanation, not proof of a particular browser/driver defect. The patch removes the identified hazards and provides a browser-rendered regression test; verification in the reporting browser/GPU remains necessary. No synthetic missing-letter image is presented as a reproduction of the original defect.

## What the code was doing

A cell owns four half-panels: a stationary upper face, a stationary lower face, a falling upper flap, and a landing lower flap. During motion, the fixed top holds the next character while the fixed bottom holds the current character. On completion, both fixed faces receive the same committed character.

The original CSS placed `backface-visibility:hidden` on `.sf-half`, so the rule applied to all four panels, including the two panels that never rotate. The stock 150-cell board therefore had 300 stationary faces participating in that rendering path. In the original isometric test fixture, Chrome DevTools Protocol's `LayerTree` reported **311 compositor layers** after all animation tasks had stopped. The front-facing fixture reported 310. This count is for the entire fixture page, not a portable per-widget GPU guarantee.

A separate live-demo probe reported about 312 layers initially. Changing only the stationary faces' backface visibility to `visible` reduced that demo's count to five, without changing any character state. That experiment isolates the unnecessary stationary-face backface handling from the reactive model and the animation scheduler.

The original `Cell.snap()` and normal completion branch used `visibility:hidden` for the moving flaps. They cleared promotion hints only on some paths but did not remove the final 3D transform. The falling flap could keep a partially rotated matrix; the landing flap could retain a perspective matrix even at zero rotation. A retarget to the just-landed character between drum steps could also exit without clearing the remaining hints.

The original title does not change when `createAirportDemo` handles a departure refresh (`examples/ui-final-airport/demo.ts`). Consequently, a blank upper title face after that action is not explained by the refresh intentionally assigning a blank title. Stored character assertions alone cannot establish whether the browser painted that character.

### Source locations

In the patched `examples/ui-final-airport/split-flap.ts`:

- `Cell` construction and `paintRest()` / `hideFlap()`: lines 109–135.
- State retargeting, snapping, and physical animation completion: lines 136–203.
- The static/moving-face CSS boundary and cell-local stacking: lines 240–255.

The diff preserves the original code immediately around these locations, including the old visibility-only completion path.

## Changes

### 1. Stationary faces remain ordinary 2D content

`backface-visibility:hidden` now belongs only to `.sf-flap`. Fixed faces have no 3D transform, promotion hint, or backface-culling rule. `isolation:isolate` on the cell keeps each flap's and hinge's z-order local to that character.

This is not a `translateZ(0)` workaround. It removes unnecessary 3D involvement instead of promoting every character permanently.

### 2. One explicit resting state

`paintRest()` commits the same character to both stationary faces, zeroes the stationary lower shade, updates `data-character`, and retires both moving flaps. `hideFlap()` sets the native `hidden` attribute, removes `transform` and `will-change`, and zeroes the moving shade. A component-scoped `[hidden]` rule makes the moving panel `display:none`.

The shared path runs on initialization, every completed physical flap, and `snap()`. Reduced motion and power-off already use `snap()`, so they receive the same cleanup. Initial blank cells now have explicit space characters and the same valid resting state as every other cell.

Moving transforms and shading are prepared before their flap becomes visible. The falling and landing phases still use the existing perspective matrix and bounce function. The character drum, retarget behavior, flight IDs, row/cell identity, input events, and single owned animation clock are preserved.

### 3. No continuous repaint workaround

The fix does not add timers, forced layout reads, periodic repainting, DOM replacement, or a second animation clock. The board still has no active component frame task after settling. The idle regression advances 1,000 additional UI frames and verifies unchanged markup.

## Regression coverage

Three checks were added to `test/ui-final/html-browser.mjs`, with multiple assertions per check. They cover cold mount including spaces, normal completion, visible moving phases, reduced-motion and power-off interruption in both physical phases, retargeting to the just-landed character, and idle immutability. They check actual computed display/backface styles, both fixed glyphs, shades, hidden flags, and removal of transforms/hints—not only `data-character`.

The new `scripts/test-ui-final-flap-render.mjs` drives `test/ui-final/flap-render-browser.mjs` in Chromium. UI ticks are scheduled in browser animation frames, allowing intermediate falling and landing poses to paint. The main projection matrix uses short, real drum transitions; a separate rapid-retarget case exercises long wraps and temporary blank targets.

The rendering suite covers two isometric wall orientations, front inspection, fractional ancestor scales and translations, and device pixel ratios 1, 1.25, and 2. Each settled result is compared against a cold mount from the expected state, with the moving overlays removed and fixed faces explicitly made flat. It never copies the animated glyph DOM into the expected result.

Pixel comparison decodes the browser's PNGs through canvas. It allows a maximum difference of **32/255 per color channel**, with **zero pixels allowed above that threshold**. This accommodates small antialiasing changes following layer retirement; it is not a blanket percentage of ignored pixels. In the measured patched results the largest normal difference was 29, and the DPR 1.25 and 2 comparisons were identical.

A negative control deliberately hides the upper title `S` without changing either text node or `data-character`. The comparison detects it at every tested pixel ratio: 25, 36, and 82 significant pixels respectively. This demonstrates that the tolerance does not hide the reported class of error. The negative control is an intentional test mutation, not evidence that the original artifact was reproduced.

A loose Chromium-only idle layer budget of fewer than 20 layers guards against reintroducing hundreds of stationary compositor layers. All 12 patched projection/DPI fixtures reported **five layers**. This is not a shipping frame-time or GPU-memory benchmark.

## Results

Environment: Node 22.16.0, TypeScript 5.8.3, Chromium 144.0.7559.96, locally installed Playwright driver. Browser content and bundles load locally through `setContent` without network assets.

| Suite | Patched result |
| --- | ---: |
| Core and isolated engine-adapter tests | 54 passed |
| Existing UI Final browser regression tests | 41 passed |
| HTML/airport browser tests, including the three new checks | 51 passed |
| New painted-frame, layer, and pixel regression suite | 70 passed |
| Total | 216 passed, 0 failed |

The final regression tests were also run against a separate extraction of the original archive, with only the new test files copied in. The HTML suite reported 48 existing checks passing and all three new checks failing. The rendering smoke run reported 2 passing and 22 failing. Its unchanged original production code retained 310–311 idle layers; the visual-reference differences also exceeded the documented tolerance. Those failures establish that the tests distinguish the patch from the supplied baseline; they do not prove the exact screenshot's browser-specific failure mechanism.

The patch was applied to a fresh extraction of the latest uploaded archive with `git apply --check`, and all four suites were rerun there. Reverse-application checks also passed. The rebuilt standalone demo was then exercised with real browser animation frames (reduced motion off): departure refresh, announcement publication, front inspection, and return to the wall. It retained 150 cells, had no stale moving-flap styles or unequal settled glyphs, and reported five idle layers and no unhandled browser errors. These additional demo observations are not included in the 216-check total.

Raw JSON and command logs are included in the delivery's `test-reports/` directory. The report includes actual layer counts and pixel-difference measurements. Baseline reports are intentionally failing results, not failures in the patched delivery.

## Apply and reproduce

Run from the engine repository root (the directory containing `package.json`):

```sh
git apply --check /path/to/UI_FINAL_SPLIT_FLAP_FIX.patch
git apply /path/to/UI_FINAL_SPLIT_FLAP_FIX.patch

npm run test:ui-final
UI_FINAL_BROWSER=/path/to/chromium npm run test:ui-final:browser
UI_FINAL_BROWSER=/path/to/chromium npm run test:ui-final:html
UI_FINAL_BROWSER=/path/to/chromium npm run test:ui-final:flap-render

npm run demo:ui-final:airport
```

The browser scripts normally import the project's `playwright-core`. `UI_FINAL_PLAYWRIGHT_MODULE` can point to a compatible existing installation. No container-specific module or browser path is committed.

For a faster DPR-1 rendering run, use `npm run test:ui-final:flap-render -- --smoke`. To save actual/reference/negative-control screenshots, set `UI_FINAL_SCREENSHOT_DIR=test-reports/split-flap/pixels`. The builder clears `.ui-final-build`, so generate the standalone demo after running builds/tests.

The rebuilt demo uses the same component and needs no application-side changes. Refresh departures, publish an announcement, interrupt with reduced motion or power-off, and inspect the settled title and rows at different zoom levels.

## Limits

This validates the isolated UI Final build and the listed Chromium suites, not the full engine's Vite/Pixi/physics/network test matrix. The archive has no installed full dependency tree. Safari, Firefox, the reporting browser/driver, physical mobile GPUs, production font loading, and long-duration performance were not certified. No browser binaries or font files are included.
