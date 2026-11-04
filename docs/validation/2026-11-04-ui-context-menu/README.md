# Native context-menu UI capability

UI Final exposes contextMenu through the standard typed event handlers, native contextmenu mapping, and authored-document allowlist. No document-wide default cancellation or custom event routing was added.

Run `UI_FINAL_BROWSER=/usr/bin/chromium node scripts/test-ui-final-context-menu.mjs`. This builds only UI Final's isolated strict TypeScript target and runs the focused real-browser DOM case. It passed: actual right-click routes once on a direct button and an authored document button; default is canceled only when that handler requests it; an ordinary button preserves its native default; left-click still activates once; disposing the UI removes the handler. `native.log` records the successful isolated build and case. No full engine/UI suite was run.

The two new executable event-capability entries (native mapping and document allowlist) are both exercised directly; the type addition is checked by the isolated strict build. This does not claim aggregate coverage of unchanged UI Final code. The app's separate screenshot-clipboard module tests cover its added request/lifecycle branches above80%, and its native integration preserves the OS clipboard behind an explicit API stub.
