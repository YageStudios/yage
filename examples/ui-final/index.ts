import { createUIFinalDemo } from "./demo";
const demo = createUIFinalDemo();
// Presentation teardown is explicit, including RAF, bindings, input, modals and resources.
if (import.meta.hot) import.meta.hot.dispose(() => demo.dispose());
