import { UIFinal, h, compileDocument } from "../../.ui-final-build/engine/ui/final/index.js";

const host = document.createElement("div");
document.body.appendChild(host);
const ui = new UIFinal({ host, scheduling: "manual" });
const state = { direct: 0, document: 0, activations: 0, defaults: [] };
const authored = compileDocument({ schema: "ui-final/1", root: {
  type: "button", props: { id: "authored", text: "Authored" }, on: { contextMenu: "copy" },
} }, { actions: { copy: event => { state.document++; event.preventDefault(); } } });
ui.mount([
  h("button", { id: "copy", text: "Copy", on: {
    activate: () => state.activations++,
    contextMenu: event => { state.direct++; event.preventDefault(); },
  } }),
  h("button", { id: "ordinary", text: "Ordinary" }),
  authored,
]);
host.addEventListener("contextmenu", event => state.defaults.push({ id: event.target.dataset.uifId, prevented: event.defaultPrevented }));
const saved = ui.element("copy");
window.contextMenuTest = { state, dispose: () => ui.dispose(), dispatchAfterDispose: () => saved.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })) };
