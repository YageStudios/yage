import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFileSync,readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {load,fixture,hash,home} from './load.mjs';
const require=createRequire(import.meta.url),coverage=process.argv.includes('--coverage')?require('/home/robert/.npm/_npx/b8d86e6551a4f492/node_modules/istanbul-lib-instrument').createInstrumenter({produceSourceMap:true,compact:false,coverageVariable:'__surfaceCoverage'}):null;
function equal(f,per=2,lift=3,rise=.75){
 const original=load('original',{trace:true}),candidate=load('candidate',{trace:true,instrument:coverage}),a=original.paintSurface(f.art,f.heights,f.cell,per,lift,rise),b=candidate.paintSurface(f.art,f.heights,f.cell,per,lift,rise);
 assert.equal(a.width,b.width);assert.equal(a.height,b.height);assert.deepEqual(b.data,a.data);assert.deepEqual(candidate.enqueue,original.enqueue,'same seed/frontier append sequence');return b;
}
test('existing surface golden from the former pixel-step ray marcher stays exact',()=>{
 const ts=require('/data/workspace/sky-harbor/worldmap-integration/infected/node_modules/typescript'),source=readFileSync(home+'/original/historical-surface-fixture.ts','utf8'),tree=ts.createSourceFile('fixture.ts',source,ts.ScriptTarget.Latest,true),statement=tree.statements.find(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&d.name.text==='atlas'));
 assert.ok(statement);const js=ts.transpileModule(statement.getText(tree)+'\nexports.atlas=atlas;', {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,exports={};new Script('(function(exports){'+js+'})').runInThisContext()(exports);const f=exports.atlas(),out=equal(f,2,3,.75);assert.equal(hash(out.data),'0b89ab41387b07b1bf514ac2e5d66b1f71260625609d911f3ef1a0ab83c595c2');
});
test('empty, opaque, no-hit and threshold silhouettes preserve output and frontier order',()=>{for(const kind of['empty','opaque','no-heights','mixed'])for(const [w,h,cw,ch]of[[13,19,5,7],[48,64,24,32]])equal(fixture(w,h,cw,ch,kind));});
test('lift, raised underside, top and side encodings remain byte identical',()=>{for(const per of[.5,2,3.2])for(const lift of[-2,0,3,15])for(const rise of[.25,.75,2])equal(fixture(23,31,8,12),per,lift,rise);});
test('seeds at array index zero, all cell edges and partial bottom cells preserve propagation',()=>{
 const f=fixture(11,13,5,5,'no-heights');for(const [x,y]of[[0,0],[4,4],[5,5],[9,9],[10,12]]){const i=4*(y*f.art.width+x);f.heights.data[i]=0;f.heights.data[i+2]=7;f.heights.data[i+3]=255;}const out=equal(f,1,0,1);assert.ok(out.data[3]>0);
});
test('fringes do not cross cell boundaries or continue beyond four rounds',()=>{
 const f=fixture(24,8,12,8,'no-heights');const i=4*(0*f.art.width+11);f.heights.data[i]=0;f.heights.data[i+2]=9;f.heights.data[i+3]=255;const out=equal(f,1,0,1);assert.equal(out.data[4*12+3],255,'neighbor in next cell remains ground');assert.equal(out.data[4*7+3],9,'fourth fringe keeps solid');assert.equal(out.data[4*6+3],255,'fifth fringe remains ground');
});
test('large seeded/frontier queues grow with identical append order and bytes',()=>{const a=equal(fixture(128,128,32,32,'opaque'),2,3,.75);assert.ok(a.data.some(v=>v!==0));});
test('visited backing drops by exactly3N without other constructor/queue changes',()=>{
 const f=fixture(37,41,8,9,'mixed'),oldAlloc=[],newAlloc=[],a=load('original',{allocations:oldAlloc}),b=load('candidate',{allocations:newAlloc}),old=a.paintSurface(f.art,f.heights,f.cell,2,3,.75),now=b.paintSurface(f.art,f.heights,f.cell,2,3,.75);
 assert.deepEqual(old.data,now.data);assert.equal(oldAlloc.reduce((n,x)=>n+x.bytes,0)-newAlloc.reduce((n,x)=>n+x.bytes,0),3*f.art.width*f.art.height);assert.equal(newAlloc.filter(x=>x.type==='Uint8Array'&&x.length===f.art.width*f.art.height).length,1);assert.equal(oldAlloc.filter(x=>x.type==='Int32Array'&&x.length===f.art.width*f.art.height).length,1);
});
after(()=>{if(coverage)writeFileSync(home+'/coverage-raw.json',JSON.stringify(globalThis.__surfaceCoverage));});
