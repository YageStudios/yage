/**
 * True when a real browser DOM is available for presentation UI.
 * Headless runs (vitest, node) stub `document` without DOM construction APIs,
 * so draw-system HUDs must check this before creating a UIFinal runtime.
 */
export const canPresentUI = (): boolean =>
  typeof document !== "undefined" && typeof document.createComment === "function";
