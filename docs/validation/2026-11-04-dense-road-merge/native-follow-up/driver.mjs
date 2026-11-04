/** Native game captures only; same camera in the frozen baseline and integration. */
import { chromium } from "playwright-core";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, join, sep, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const url = process.argv[2], out = process.argv[3];
assert(url && out);
const snapshotRoot = process.env.HIGHWAY_SOURCE_ROOT && resolve(process.env.HIGHWAY_SOURCE_ROOT);
const manifestBytes = snapshotRoot && await readFile(join(snapshotRoot, "manifest.json"));
const moduleMapBytes = snapshotRoot && await readFile(join(snapshotRoot, "module-map.json"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
if (snapshotRoot) assert.equal(sha(manifestBytes), process.env.HIGHWAY_MANIFEST_SHA, "immutable cohort manifest differs from requested pin");
const manifest = snapshotRoot && JSON.parse(manifestBytes), moduleMap = snapshotRoot && JSON.parse(moduleMapBytes);
const sourceProof = snapshotRoot ? { root: snapshotRoot, manifestSha256: sha(manifestBytes), appHead: manifest.appHead,
  engineHead: manifest.engineHead, sourceFiles: manifest.files.length, assets: manifest.assets.length } : { root: process.cwd() };
sourceProof.driverSha256 = sha(await readFile(fileURLToPath(import.meta.url)));
const sourceFiles = snapshotRoot ? manifest.files : [...new Set(execFileSync("git",["ls-files","--cached","--others","--exclude-standard","src"],{encoding:"utf8"}).trim().split("\n"))].sort();
const sourceDigest=async()=>{
  const hash=createHash("sha256");
  if (!snapshotRoot) {
    for(const file of sourceFiles){hash.update(file);hash.update(await readFile(file));}
    return hash.digest("hex");
  }
  assert.equal(sha(await readFile(join(snapshotRoot, "manifest.json"))), sourceProof.manifestSha256);
  assert.deepEqual(await readFile(join(snapshotRoot, "module-map.json")), moduleMapBytes);
  hash.update(manifestBytes);hash.update(moduleMapBytes);
  for (const record of [...manifest.files, ...manifest.assets]) {
    const source = moduleMap[record.path];
    const file = source ? resolve(source.file) : resolve(snapshotRoot, "public", record.path);
    assert(file.startsWith(snapshotRoot + sep), "cohort pin escapes immutable root");
    const digest=createHash("sha256");let bytes=0;
    // Stream large assets so proving a source pin cannot allocate another complete city pack.
    for await (const chunk of createReadStream(file)) {digest.update(chunk);bytes+=chunk.length;}
    assert.equal(bytes, record.bytes, `cohort size differs: ${record.path}`);
    const actual=digest.digest("hex");assert.equal(actual,record.sha256,`cohort bytes differ: ${record.path}`);
    hash.update(record.path);hash.update(actual);
  }
  return hash.digest("hex");
};
const coordinatePath = fileURLToPath(new URL("../src/realworld/coordinates.ts",import.meta.url));
const compiledModule = async path => {
const compiled = await build({entryPoints:[path],bundle:true,platform:"node",format:"esm",write:false,logLevel:"silent",
  ...(snapshotRoot ? {plugins:[{name:"pinned-cohort",setup(builder){builder.onLoad({filter:/.*/},async args=>{
    const source=moduleMap[args.path];assert(source,`coordinate dependency absent from cohort: ${args.path}`);
    return {contents:await readFile(source.file,"utf8"),loader:args.path.endsWith(".ts")?"ts":"js",resolveDir:dirname(args.path)};
  });}}]} : {})});
return import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
};
const { geographicToGame } = await compiledModule(coordinatePath);
const { WORLD_ZOOM, worldBlend } = await compiledModule(fileURLToPath(new URL("../src/worldmap/zoom.ts",import.meta.url)));
const requestedZoom = process.env.HIGHWAY_ZOOM ? Number(process.env.HIGHWAY_ZOOM) : process.env.HIGHWAY_NATIVE ? 0.5 : null;
assert(requestedZoom === null || Number.isFinite(requestedZoom) && requestedZoom > 0,"Invalid requested zoom");
if(process.env.HIGHWAY_NATIVE) assert(requestedZoom > WORLD_ZOOM,"Native painted readiness requires zoom above the pinned WORLD_ZOOM cutoff");
sourceProof.captureMode = { native: !!process.env.HIGHWAY_NATIVE, requestedZoom, worldZoom: WORLD_ZOOM };
const sourceBefore=await sourceDigest();
await mkdir(out,{recursive:true});
const targets = [
  {name:"george-washington-bridge",longitude:-73.9527,latitude:40.8517,zoom:0.08},
  {name:"seville-west-flat-crossing",longitude:-6.104288,latitude:37.368834,zoom:0.474},
  {name:"a4-east-cloverleaf",longitude:-5.9232,latitude:37.4181,zoom:0.055},
  {name:"se30-a4-crossing",longitude:-5.9492,latitude:37.4086,zoom:0.065},
  {name:"a66-west-interchange",longitude:-6.034,latitude:37.414,zoom:0.055},
];
const launch = {executablePath:"/usr/bin/chromium",headless:process.env.HIGHWAY_HEADED !== "1",args:process.env.HIGHWAY_HEADED === "1" ? [] : ["--enable-gpu","--ignore-gpu-blocklist","--use-angle=vulkan","--enable-features=Vulkan"]};
const browser = await chromium.launch(launch);
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors = [], states = [], workerRows = [];
page.on("worker",worker=>{
  const row={url:worker.url(),worker};workerRows.push(row);
  void worker.evaluate(()=>{
    globalThis.__highwayWorkerEvents=[];
    for(const type of ["message","error","messageerror"])self.addEventListener(type,event=>{
      const data=event.data, rows=globalThis.__highwayWorkerEvents;
      rows.push({type,at:performance.now(),message:event.message??null,data:data&&typeof data==="object"?{keys:Object.keys(data).slice(0,20),type:data.type??data.kind??null,cx:data.cx??null,cy:data.cy??null}:typeof data});
      if(rows.length>64)rows.shift();
    });
  }).catch(error=>row.observerError=String(error));
});
page.on("pageerror",error=>{errors.push(error.stack);console.error("PAGE ERROR",error.message);void page.close()});
try {
  console.log("BOOT",url);
  await page.goto(url);
  await page.waitForFunction(()=>globalThis.__infected?.view && globalThis.__infected.hudBus.state.get("generating") === null,null,{timeout:180000});
  console.log("BOOT READY");
  const generation=await page.evaluate(()=>globalThis.__highwayCaptureGeneration=crypto.randomUUID());
  await page.getByRole("button",{name:/Begin/}).click();
  const offer=page.getByRole("dialog",{name:"Mutation: choose one",exact:true});
  if(await offer.isVisible())await offer.getByRole("button",{name:/^1: /}).click();
  for(const target of targets.filter(target => !process.env.HIGHWAY_TARGET || target.name === process.env.HIGHWAY_TARGET)){
    console.log("VISIT",target.name);
    const anchor=await page.evaluate(()=>{const a=globalThis.__infected.worldMap.geography.anchor;return a.frames?.list[0]??a;});
    const point=geographicToGame(anchor,target.longitude,target.latitude);
    await page.evaluate(p=>Object.assign(globalThis.__infected.view,{following:false,diving:false,zoom:0.00001,x:p.x,y:p.y}),point);
    await page.waitForTimeout(1000);
    await page.evaluate(p=>Object.assign(globalThis.__infected.view,{following:false,diving:false,zoom:1,x:p.x,y:p.y}),point);
    await page.waitForFunction(()=>{const g=globalThis.__infected;const c=g.sceneModel.componentList.find(c=>c?.schema?.name==="HotWatch");const w=c&&g.sceneModel.single(c.schema);return !g.step.geographicLoading&&!w?.geographic?.pending&&!w?.geographic?.dirty;},null,{timeout:120000});
    await page.waitForTimeout(4000);
    await page.evaluate(zoom=>Object.assign(globalThis.__infected.view,{zoom,following:false,diving:false}),requestedZoom ?? target.zoom);
    await page.waitForTimeout(5000);
    if(await offer.isVisible()) await offer.getByRole("button",{name:/^1: /}).click();
    await page.waitForTimeout(500);
    if(process.env.HIGHWAY_NATIVE) await page.waitForFunction(()=>{const g=globalThis.__infected,c=g.sceneModel.componentList.find(c=>c?.schema?.name==="GroundResources");return g.sceneModel.single(c.schema).painted.size>0;},null,{timeout:60000});
    const data=await page.evaluate(async()=>{
      const g=globalThis.__infected, c=g.sceneModel.componentList.find(c=>c?.schema?.name==="GroundResources"),ground=g.sceneModel.single(c.schema);
      const times=[];await new Promise(resolve=>{let last=performance.now();const frame=now=>{times.push(now-last);last=now;if(times.length>=120)resolve();else requestAnimationFrame(frame)};requestAnimationFrame(frame)});
      const gl=g.app.renderer.gl, debug=gl.getExtension("WEBGL_debug_renderer_info");
      const graphics={contextLost:gl.isContextLost(),renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
      const source=ground.planning.source;
      const plans=[...source.atlas.preparedPlans(source.space)];
      return {graphics,view:{x:g.view.x,y:g.view.y,zoom:g.view.zoom},frameMs:times,tick:g.step.last,loading:g.step.geographicLoading,
        plans:plans.map(p=>({id:p.skeleton.id,bounds:p.skeleton.bounds,streets:p.streets.map(s=>({...s})),buildings:p.buildings.map(b=>({id:b.id,box:b.box,unit:b.unit?.native?"native":null})),links:p.skeleton.links.filter(l=>l.road==="highway").map(l=>({id:l.id,path:l.path,source:l.source,level:l.level,ramp:l.ramp,oneWay:l.oneWay,sourceJoints:l.sourceJoints}))})),
        painted:[...ground.painted.entries()].map(([key,p])=>({key,roads:p.art.roads,junctions:p.art.junctionAreas})),
      };
    });
    assert.equal(data.graphics.contextLost,false,"native capture lost its WebGL context");
    await page.screenshot({path:`${out}/${target.name}.png`});
    states.push({target,...data});
    await writeFile(`${out}/result.json`,JSON.stringify({url,launch,sourceProof,sourceDigest:sourceBefore,errors,states},null,2));
    assert.equal(await page.evaluate(()=>globalThis.__highwayCaptureGeneration),generation,"app reloaded during native capture");
    assert.equal(await sourceDigest(),sourceBefore,"app source changed during native capture");
    assert.equal(errors.length,0,errors.join("\n"));
    console.log("CAPTURED",target.name,"plans",data.plans.length,"roads",data.painted.reduce((n,p)=>n+(p.roads?.length??0),0));
  }
} catch(error) {
  const failure={message:String(error),state:null,workers:[]};
  try {
    failure.state=await page.evaluate(()=>{
      const g=globalThis.__infected,model=g?.sceneModel;
      const actual=name=>{const type=model?.componentList.find(type=>type?.schema?.name===name);return type?model.single(type.schema):null};
      const resources=actual("GroundResources"),state=actual("GroundState"),watch=actual("HotWatch")?.geographic;
      const keys=value=>value?{count:value.size??value.length,keys:[...(value.keys?.()??value)].slice(0,32)}:null;
      const source=resources?.planning?.source,gl=g?.app?.renderer?.gl;
      return {view:g?.view?{x:g.view.x,y:g.view.y,zoom:g.view.zoom,diving:g.view.diving,following:g.view.following}:null,
        frame:g?.worldMap?.geography?.anchor?.frames??null,loading:g?.step?.geographicLoading,tick:g?.step?.last,
        geographic:watch?{pending:watch.pending,dirty:watch.dirty,error:watch.error,failures:watch.failures,requested:keys(watch.requested),ready:watch.ready?.map(r=>({cx:r.cx,cy:r.cy,bytes:r.bytes.length}))}:null,
        ground:state?{zoom:state.zoom,paintBudget:state.paintBudget,budgeted:state.budgeted,focusX:state.focusX,focusY:state.focusY,reachX:state.reachX,reachY:state.reachY,queued:state.queued.slice(0,32),queueCount:state.queued.length}:null,
        resources:resources?{asked:keys(resources.asked),prepared:keys(resources.prepared),painted:keys(resources.painted),ahead:keys(resources.ahead),workerPending:resources.aheadSource?.pending,views:keys(resources.scene?.views)}:null,
        planning:source?{constructor:source.constructor.name,space:source.space,atlas:!!source.atlas,keys:Object.keys(source),plans:[...(source.atlas?.preparedPlans(source.space)??[])].slice(0,64).map(p=>({id:p.skeleton.id,bounds:p.skeleton.bounds}))}:null,
        contextLost:gl?.isContextLost()??null};
    });
    if(failure.state?.view) failure.state.blend=worldBlend(failure.state.view.zoom);
    failure.workers=await Promise.all(workerRows.map(async row=>({url:row.url,observerError:row.observerError,
      events:await Promise.race([row.worker.evaluate(()=>globalThis.__highwayWorkerEvents??[]).catch(error=>String(error)),new Promise(resolve=>setTimeout(()=>resolve("Worker observer unavailable within 200ms"),200))])})));
    await page.screenshot({path:`${out}/failure.compositor.png`,timeout:3000});
  } catch(captureError) {failure.captureError=String(captureError)}
  await writeFile(`${out}/failure-state.json`,JSON.stringify(failure,null,2));
  throw error;
} finally {await writeFile(`${out}/result.json`,JSON.stringify({url,launch,sourceProof,sourceDigest:sourceBefore,errors,states},null,2));await browser.close();}
