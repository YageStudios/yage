import base from "/data/workspace/sky-harbor/worldmap-integration/yage/vite.config.js";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url);
const {createInstrumenter}=require("/home/robert/.npm/_npx/b8d86e6551a4f492/node_modules/istanbul-lib-instrument");
export default {...base, plugins:[...(base.plugins??[]),{name:"vector-coverage",enforce:"post",transform(code,id){
if(!id.endsWith("/engine/streaming/vector.ts"))return;
const i=createInstrumenter({esModules:true,produceSourceMap:true});
return {code:i.instrumentSync(code,id,this.getCombinedSourcemap()),map:i.lastSourceMap()};
}}],test:{...base.test,setupFiles:[...base.test.setupFiles,"/tmp/highway-vector-coverage/setup.ts"]}};
