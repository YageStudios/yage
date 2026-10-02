# Sky Harbor airport / UI Final HTML component demo

An interactive isometric terminal with a state-driven split-flap board mounted on its right-hand wall. The terminal uses procedural SVG. The billboard is real HTML/CSS with retained, animated cells; it is not a screenshot or iframe.

## Run

With the normal engine dependencies installed:

```sh
npm run examples
```

Open the `ui-final-airport` example, at `/ui-final-airport` or `/#/ui-final-airport` on the examples server (normally port 5173).

For a self-contained demo without the Vite/Pixi runtime dependency graph:

```sh
npm run demo:ui-final:airport
```

This builds `.ui-final-build/ui-final-airport-demo.html`. Open it in a browser or serve that directory with your local static server. The generated file needs no network assets. The isolated builder uses an installed TypeScript compiler, either the project's compiler or `tsc` on PATH. Any later isolated build clears `.ui-final-build`, so regenerate the HTML after running tests.

## Interact

Click a flight on the angled wall, change its gate/status, publish an announcement, or refresh departures. Each action goes through the demo's command queue into a UI Final signal. Adjust the flap speed, reduced-motion preference, power, and zoom. “Inspect board” changes the pose of the same live component; it does not mount a second board. On narrow touch screens, use inspection mode for flight selection.

The standalone page exposes `window.skyHarborAirportDemo` for experimentation:

```js
const demo = window.skyHarborAirportDemo;
demo.board.update(state => ({ ...state, message: "WELCOME HOME" }));
demo.ui.flush();
// demo.dispose(); // Stops clock, bindings, input ownership, and all retained views.
```

## Files

| File | Responsibility |
| --- | --- |
| `split-flap.ts` | Reusable, typed HTML component; board state/events; per-cell mechanics and one active clock. |
| `terminal.ts` | Isometric projection and local SVG scenery. |
| `demo.ts` | Normal UI Final inspector, presentation model, game-intent queue, zoom/inspection state. |
| `index.ts` | Examples-gallery entry and HMR cleanup. |
| `offline.mjs` | Entry for the standalone local bundle. |
| `billboard.ui.json` | Example registered-component asset; supply the registry and model as documented. |

The original `sky-harbor-splitflap.html` is retained unmodified. Its flap mechanics were adapted into an instance-owned component rather than executing its page-level script. The airport does not ship a copied font file or a third-party runtime.

## Test

```sh
npm run test:ui-final
UI_FINAL_BROWSER=/path/to/chromium npm run test:ui-final:browser
UI_FINAL_BROWSER=/path/to/chromium npm run test:ui-final:html
```

Browser tests require `playwright-core` and an installed Chromium/Chrome executable. `UI_FINAL_PLAYWRIGHT_MODULE` can point to another installed compatible Playwright module. Screenshots are optional:

```sh
UI_FINAL_BROWSER=/path/to/chromium \
UI_FINAL_SCREENSHOT_DIR=test-reports/airport \
npm run test:ui-final:html
```

The test runner builds locally, uses actual browser input for typing/touch/pointer actions, and performs no resource downloads. It does not exercise a physical gamepad; controller events enter through the real engine input bridge in the component tests.

See `docs/ui-final/HTML_COMPONENTS.md` for custom HTML authoring, lifecycle, assets, input, security constraints, and game integration. `WorldSurface` is a DOM overlay; it is not a GPU texture or a general 3D occlusion solution.
