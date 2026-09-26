# UI Final — validation report

## Verified environment and scope

Validation used Node **22.16.0**, TypeScript **5.8.3** and Chromium **144.0.7559.96** as reported by the launched browser. The code targets the supplied TypeScript/Pixi YAGE source archive; the UI Final backend itself uses the browser DOM.

The isolated compiler uses strict TypeScript, ES2020 output and ES2021/DOM libraries. `strictPropertyInitialization: false` matches the supplied engine configuration. No new third-party runtime library was added. The browser runner uses the repository's existing Playwright Core interface and an installed Chromium executable.

## Results

| Check | Result | What the result establishes |
|---|---|---|
| Isolated TypeScript build | Passed | All Final runtime modules, their InputManager dependency and the showcase compile |
| Core regression tests | 41 passed | Signals, scheduling, dependency selection, models, assets, resources, commands, priority and pure list/focus helpers |
| Engine-adapter contract tests | 3 passed | Real Scene/UiLoader source with controlled legacy/platform adapters |
| Browser checks | 41 passed | Retained DOM, input, focus, modals, lists, reload, lifecycle and complete showcase behavior |
| Total automated checks | **85 passed, 0 failed** | No skipped checks in these two runners |
| Source package export preflight | Passed | Declared non-dist package entries exist, including `yage/ui/final` |
| Pristine patch application and repeat test run | Passed | Patch applies to the supplied snapshot; both suites pass again after application |
| Standalone demo build | Passed | Local single-file HTML, no downloaded art/fonts/assets |

The adapter tests transpile the real Scene and UiLoader files, while substituting Pixi/legacy services and ticker/asset adapters. They verify integration contracts and error cleanup; they are not the full engine's graphics/physics/network integration tests.

## Concrete workload assertions

A single leaf mutation among **10,000 established model bindings** schedules exactly one affected job. A static mounted browser fixture executes **1,000 idle frames** without changing its renderer counters or running bindings. This excludes unrelated browser work and does not assert literally zero instructions per frame.

The virtual-list fixture contains **100,000 source items**, with row height 40, viewport height 400 and overscan two. It creates **12 rows at the top** and **no more than 14** at interior scroll positions. Its source array/key index remains proportional to the dataset; virtualization bounds realized controls, not source storage or filtering.

A seeded test checks **50 reorderings of 32 native inputs**, retaining their identities without additional creation. The pure visible-range tests include **5,000 randomized cases**. Other checks cover 40 successive offscreen virtual-navigation steps, list shrink/clamp behavior, duplicate keys, native caret retention, disabled/hidden focus repair and cross-root modal ownership.

Real browser input checks use actual Playwright keyboard, touch and pointer actions: Enter/Space each activate once, touch activates once, captured dragging continues outside its original element, and native input editing retains its caret behavior. Composition event behavior is separately tested with synthetic IME events; this is not a substitute for testing actual OS IMEs in every shipping locale.

The complete equipment showcase is exercised at **1440×980** and **390×844**, including 100,000-item data, search filtering, item selection, modal confirmation, command consumption, RTL switching, horizontal-overflow checks and final disposal. Browser tests run under a CSP without `unsafe-eval`. They use precompiled local code in an offline page, not an asset-expression evaluator.

## Reproduction

```sh
npm run test:ui-final
UI_FINAL_BROWSER=/path/to/chromium npm run test:ui-final:browser
npm run demo:ui-final:offline
```

`UI_FINAL_BROWSER` is optional when the Playwright installation can locate Chromium. `UI_FINAL_PLAYWRIGHT_MODULE` optionally points to an already-installed Playwright module in a constrained environment. `UI_FINAL_SCREENSHOT_DIR` enables desktop/mobile showcase screenshots. The runner does not download a browser or compiler.

The delivery bundle includes the actual core TAP log and browser JSON report. Run again on the target development machine rather than treating the bundled logs as a substitute for local validation.

## Not verified / not claimed

The original `npm run typecheck` was attempted and stopped at `TS2688: Cannot find type definition file for vite/client`. The original full engine dependency installation was blocked by unavailable DNS/network access to the npm registry in the execution environment. Therefore the **complete original engine build, Vite development session and existing engine-wide Vitest/end-to-end suites were not run**. The isolated subsystem and controlled adapter tests do not establish that every old game or external consumer compiles unchanged. The package preflight checked source entries, not a newly generated full-engine `dist` distribution.

Physical gamepads, console/browser embeddings, other browser engines, mobile GPU performance, OS-level IMEs, screen readers, real game fonts, multiplayer/replay authority integration and long-duration soak behavior were not validated here. The built-in controller tests exercise the engine input bridge and logical navigation, not physical hardware discovery.

No measured cross-device millisecond/FPS budget, GPU batching result, zero-allocation guarantee, accessibility certification or native-renderer claim is made. The specification distinguishes implementation contracts from shipping-game release gates.

## Patch integrity

The patch is produced against the supplied source snapshot. Delivery verification applies it to a pristine copy and reruns the isolated and browser suites there. `PATCH_README.md` records the source archive fingerprint and application commands. The source-overlay directory contains only changed text/code files, not the original game's fonts or other binary assets.
