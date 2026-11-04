import {afterAll} from "/data/workspace/sky-harbor/worldmap-integration/yage/node_modules/vitest/dist/index.js";
import {writeFileSync} from "node:fs";
afterAll(()=>writeFileSync("/tmp/highway-vector-coverage/raw/vector.json",JSON.stringify(globalThis.__coverage__??{})));
