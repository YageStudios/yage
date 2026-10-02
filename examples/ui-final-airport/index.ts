import { createAirportDemo } from "./demo";
const demo = createAirportDemo();
if (import.meta.hot)
    import.meta.hot.dispose(() => demo.dispose());
