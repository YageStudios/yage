# HTML component extension: validation

## Baseline and environment

Baseline: the newly supplied integrated `Sky-Harbor-context.zip` containing `yage/sky-harbor-splitflap.html` and the already integrated UI Final runtime. The patch does not depend on applying the previous UI Final delivery first. The original split-flap HTML is unchanged.

Validation environment: Node 22.16.0, TypeScript 5.8.3, Chromium 144.0.7559.96, and an installed Playwright driver. Browser fixtures and the demo are bundled locally and loaded without external assets. Tests use a real browser DOM, shadow roots, layout, animation, native dialog behavior, and input events; they are not jsdom-only tests.

## Results

| Check | Result |
| --- | --- |
| `npm run test:ui-final` | 54 passed, 0 failed, 0 skipped. |
| `npm run test:ui-final:browser` | 41 passed, 0 failed; existing regression suite. |
| `npm run test:ui-final:html` | 48 passed, 0 failed; new HTML/surface/airport browser suite. |
| Isolated strict TypeScript build and declaration emission | Passed. |
| Offline airport demo bundling | Passed. |
| Patch against a pristine extraction of the new archive | Clean apply and reverse-apply checks passed; all three suites rerun there. |
| Exact standalone HTML artifact | Loaded and exercised in Chromium; real RAF animation settled correctly with no external requests. |
| Full repository `npm run typecheck` | Blocked by missing `vite/client`; see limitations below. |

Total: **143 passing checks** across the three suites, including the original 85 checks. Test assertions cover behavior and bounded work, not an end-to-end performance budget. Per-check runtime values in the raw reports are test timings, not reliable shipping frame-time benchmarks.

## What is exercised

The added core tests cover component definition identity and immutability, validation, isometric axis geometry, wall-x/wall-y/floor transforms and their inverse, invalid/collapsed projections, retained reactive surface properties, and registered asset compilation. Literal state containing fields named `component`, `type`, or `events` is not misidentified as another document node.

The added browser unit checks cover independent instances; retained inputs/caret; scoped CSS and override precedence; field-selector equality; replacement state sources; updated event handlers; keyed deep focus retention; synchronous virtual-row realization; definition replacement; hidden/disabled/player guards; light/shadow focus order; focus scopes; native modal ownership and restoration; player-aware checkbox defaults; the engine's input bridge; native editing/IME paths; nested UI Final children; dynamic native-control registration and rename/removal; duplicate local IDs; shadow-descendant animation ownership; setup/disposal failures; late cleanup; markup guardrails; extraction; safe text insertion; application policy/nonce propagation; registered document reload; surface-pose changes; and idle behavior.

The runner separately performs actual browser typing and caret movement, Enter/Space activation, mouse clicking, touch tapping, Tab traversal, and pointer capture while dragging beyond the control's bounds. Controller coverage uses the engine InputManager bridge with injected controller events, not a physical controller.

A separate browser document enables actual Trusted Types enforcement (`require-trusted-types-for 'script'`). A component mounts and updates with the application policy, while mounting without a policy fails as expected. The primary test document disallows `unsafe-eval` and external resource loads.

## Split-flap and demo assertions

- The default board creates **150 retained cells** and starts with **zero active component frame tasks**.
- An announcement change uses **one board animation task**, retains every cell, and leaves flight markup unchanged.
- Rapid updates settle to the latest target; active work never grows to one timer per cell.
- Reduced motion and power-off release the task and display the latest target without pending animation.
- Reordering flight records retains native row nodes and focus; removing a row releases its focus registration.
- Two instances have separate DOM, state, and animation work.
- Removing an actively animating board leaves zero active tasks and no queued bindings or later DOM mutations.
- Invalid flight IDs/counts are reported before partially modifying flight rows.
- The HTML idle fixture advances **1,000 presentation frames** with unchanged markup, no new binding execution, and no active frame callbacks.
- Actual mouse hit-testing on the angled wall selects the intended flight. Gate changes, announcements, and departure refreshes consume commands into state without remounting the board.
- Isometric/front-inspection switching and zoom retain the original board host.
- At **390 × 844**, the layout has no horizontal page overflow, and actual touch selection works in the front inspection view.
- Disposal during demo animation releases the runtime root, focus entries, owned resources, and frame callbacks without unhandled browser exceptions.

Desktop (1440 × 1040), front-inspection, and mobile screenshots are generated from the running demo. They are not concept renders. The small angled mobile rows are not claimed to be reliable finger-sized targets; use the inspection control.

## Reproduction

```sh
npm run test:ui-final
UI_FINAL_BROWSER=/path/to/chromium npm run test:ui-final:browser
UI_FINAL_BROWSER=/path/to/chromium \
UI_FINAL_SCREENSHOT_DIR=test-reports/airport \
npm run test:ui-final:html
npm run demo:ui-final:airport
```

The browser runner normally imports `playwright-core`. To use an existing compatible installation, set `UI_FINAL_PLAYWRIGHT_MODULE` to its module path. No environment-specific installation path is hard-coded into the committed scripts.

The isolated builder clears `.ui-final-build` before building. Generate the offline HTML last. The delivery includes command transcripts in `test-reports/`; no browser or dependency binaries are bundled.

## Verification limits

The repository-wide typecheck stops with:

```text
error TS2688: Cannot find type definition file for 'vite/client'.
The file is in the program because:
  Entry point of type library 'vite/client' specified in compilerOptions
```

The uploaded archive has no installed full engine dependency tree. Therefore this report does not claim a passed full Vite/Pixi/game build or complete repository test suite. The isolated UI Final build includes the new runtime code and demo, and the existing controlled Scene/UiLoader integration tests pass, but those are not a substitute for the full engine CI environment.

The container browser blocks navigation to file and localhost URLs (`ERR_BLOCKED_BY_ADMINISTRATOR`). Browser checks therefore use Playwright `setContent` and local script injection. The additional artifact check loads the exact generated HTML, including its inline script and CSP, through `setContent`; it does not claim a successful file-URL or Vite-server navigation in this environment.

Browser behavior was verified in the Chromium version above, not Safari, Firefox, a console runtime, or every embedded webview. Physical gamepad hardware, screen-reader certification, production font/loading behavior, graphics memory, mobile GPU timing, and long-duration load were not measured.

The world surface is a transformed DOM overlay. It has no automatic game-world occlusion, GPU depth participation, texture export, or lighting. The procedural SVG demonstration does not validate Pixi integration beyond the retained scene/UI ownership seams already tested. Custom HTML remains trusted project code; active-markup checks are not an untrusted-content sanitizer.
