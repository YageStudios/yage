import type { StyleValue } from "./nodes";

export type Theme = Readonly<Record<`--uif-${string}`, StyleValue>>;
export const defaultTheme: Theme = {
  "--uif-font": "system-ui, sans-serif",
  "--uif-font-size": "16px",
  "--uif-text": "#edf2f8",
  "--uif-muted": "#aab8ca",
  "--uif-surface": "#172232",
  "--uif-surface-raised": "#24344a",
  "--uif-accent": "#79c7ff",
  "--uif-border": "#40536b",
  "--uif-radius": "8px",
  "--uif-focus-0": "#89d3ff",
  "--uif-focus-1": "#ffbc7f",
  "--uif-focus-2": "#b6ee94",
  "--uif-focus-3": "#e2b1ff",
  "--uif-motion": "120ms",
};
/** Scoped styles. No mutation of body, legacy #ui, Pixi canvas, or legacy input overlays. */
export const baseCSS = `
[data-uif-root] { font-family:var(--uif-font);font-size:var(--uif-font-size);color:var(--uif-text);line-height:1.4;isolation:isolate;pointer-events:none; }
[data-uif-root], [data-uif-root] * { box-sizing:border-box; }
[data-uif-root] [data-uif-node] { min-width:0;min-height:0; }
[data-uif-root] [hidden] { display:none!important; }
[data-uif-root] [data-uif-node="panel"] { position:relative; }
[data-uif-root] [data-uif-node="row"] { display:flex;flex-direction:row; }
[data-uif-root] [data-uif-node="column"] { display:flex;flex-direction:column; }
[data-uif-root] [data-uif-node="grid"] { display:grid; }
[data-uif-root] [data-uif-node="text"] { white-space:pre-wrap;overflow-wrap:anywhere; }
[data-uif-root] [data-uif-node="scroll"], [data-uif-root] [data-uif-node="virtual"] { overflow:auto;overscroll-behavior:contain;pointer-events:auto; }
[data-uif-root] button, [data-uif-root] input, [data-uif-root] textarea { font:inherit;color:inherit;pointer-events:auto; }
[data-uif-root] button { padding:.6em 1em;border:1px solid var(--uif-border);border-radius:var(--uif-radius);background:var(--uif-surface);cursor:pointer;touch-action:manipulation;transition:background var(--uif-motion),opacity var(--uif-motion); }
[data-uif-root] button:hover { background:var(--uif-surface-raised); }
[data-uif-root] button:active { filter:brightness(1.15); }
[data-uif-root] input, [data-uif-root] textarea { padding:.5em .7em;border:1px solid var(--uif-border);border-radius:var(--uif-radius);background:var(--uif-surface);accent-color:var(--uif-accent); }
[data-uif-root] input[type=checkbox], [data-uif-root] input[type=range] { padding:0; }
[data-uif-root] [data-uif-node="image"] { display:block;max-width:100%;object-fit:contain; }
[data-uif-root] progress { accent-color:var(--uif-accent); }
[data-uif-root] :disabled, [data-uif-root] [aria-disabled=true] { opacity:.45;cursor:not-allowed; }
[data-uif-root] :focus-visible { outline:2px solid var(--uif-focus-0);outline-offset:3px; }
[data-uif-root] [data-uif-players] { --uif-ring-1:transparent;--uif-ring-2:transparent;--uif-ring-3:transparent;outline-offset:3px;box-shadow:0 0 0 5px var(--uif-ring-1),0 0 0 8px var(--uif-ring-2),0 0 0 11px var(--uif-ring-3); }
[data-uif-root] [data-uif-players~="0"] { outline:2px solid var(--uif-focus-0); }
[data-uif-root] [data-uif-players~="1"] { --uif-ring-1:var(--uif-focus-1); }
[data-uif-root] [data-uif-players~="2"] { --uif-ring-2:var(--uif-focus-2); }
[data-uif-root] [data-uif-players~="3"] { --uif-ring-3:var(--uif-focus-3); }
[data-uif-root] [data-uif-modal] { position:absolute;inset:0;display:grid;place-items:center;pointer-events:auto;background:transparent;padding:24px; }
[data-uif-root] [data-uif-dialog] { pointer-events:auto;max-width:calc(100vw - 48px);max-height:calc(100vh - 48px);overflow:auto;padding:0;border:0;color:inherit;background:transparent; }
[data-uif-root] [data-uif-dialog]::backdrop { background:rgb(0 0 0 / .65); }
[data-uif-root][data-uif-reduced-motion] *, [data-uif-root][data-uif-reduced-motion] *::before, [data-uif-root][data-uif-reduced-motion] *::after { animation-duration:0s!important;transition-duration:0s!important;scroll-behavior:auto!important; }
@media (prefers-reduced-motion:reduce) { [data-uif-root] * { animation-duration:0s!important;transition-duration:0s!important;scroll-behavior:auto!important; } }
@media (forced-colors:active) { [data-uif-root] [data-uif-players] { outline:3px solid Highlight; } }
`;
export const unitlessStyles = new Set([
  "opacity", "z-index", "font-weight", "line-height", "flex", "flex-grow", "flex-shrink", "order", "zoom",
  "grid-column", "grid-row", "grid-column-start", "grid-column-end", "grid-row-start", "grid-row-end", "scale", "aspect-ratio",
]);
export function cssName(key: string): string {
  return key.startsWith("--") ? key : key.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`);
}
export function cssValue(key: string, value: StyleValue): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`UIF_STYLE: ${key} must be finite`);
    return key.startsWith("--") || unitlessStyles.has(cssName(key)) ? String(value) : `${value}px`;
  }
  return value;
}
export function applyTheme(element: HTMLElement, theme: Theme): void {
  const entries = Object.entries(theme).map(([key, value]) => {
    if (!/^--uif-[a-z0-9-]+$/.test(key)) throw new Error(`UIF_THEME: invalid token ${key}`);
    return [key, cssValue(key, value)] as const;
  });
  for (const [key, value] of entries) {
    if (!value) element.style.removeProperty(key); else element.style.setProperty(key, value);
  }
}
