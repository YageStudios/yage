import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {Script} from 'node:vm';
const require=createRequire(import.meta.url),ts=require('/data/workspace/sky-harbor/worldmap-integration/infected/node_modules/typescript');
export const home='/tmp/paint-surface-markers';
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function load(variant,{trace=false,allocations=null,instrument=null}={}){
 const path=home+'/'+variant+'/shadow-pass.ts',text=readFileSync(path,'utf8'),manifest=JSON.parse(readFileSync(home+'/manifest.json'));
 if(hash(text)!==manifest[variant+'SHA256'])throw Error('Changed '+variant+' source');
 const tree=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true),names=new Set(['RISE_FRACTION','MAX_RISE','heightColor','paintSurface']),ranges=[];
 for(const node of tree.statements)if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&names.has(d.name.text)))ranges.push([node.getFullStart(),node.end]);
 if(ranges.length!==4)throw Error('Function dependencies changed');
 let masked='';for(let n=0;n<text.length;n++)masked+=ranges.some(([a,b])=>n>=a&&n<b)?text[n]:text[n]==='\n'?'\n':' ';
 const result=ts.transpileModule(masked,{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,sourceMap:true,inlineSources:true}});
 let body='(function(exports,Uint8Array,Uint8ClampedArray,Int32Array){\n'+result.outputText+'\n})';
 const map=JSON.parse(result.sourceMapText);map.mappings=';'+map.mappings;map.sources=[path];map.sourcesContent=[text];map.sourceRoot='';if(instrument)body=instrument.instrumentSync(body,path+'.js',map);
 const enqueue=[],exports={};let int32Calls=0;
 const wrapped=(Type,name)=>new Proxy(Type,{construct(target,args){const value=Reflect.construct(target,args);allocations?.push({type:name,length:value.length,bytes:value.byteLength});const queue=name==='Int32Array'&&++int32Calls>=(variant==='original'?3:2);if(!trace||!queue)return value;return new Proxy(value,{get(target,key){const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v},set(target,key,v){if(typeof key==='string'&&/^\d+$/.test(key))enqueue.push(v);return Reflect.set(target,key,v,target)}})}});
 new Script(body,{filename:path+'.js'}).runInThisContext()(exports,allocations?wrapped(Uint8Array,'Uint8Array'):Uint8Array,allocations?wrapped(Uint8ClampedArray,'Uint8ClampedArray'):Uint8ClampedArray,trace||allocations?wrapped(Int32Array,'Int32Array'):Int32Array);
 return{paintSurface:exports.paintSurface,heightColor:exports.heightColor,enqueue};
}
export function fixture(width,height,cw,ch,pattern='mixed'){
 const art={width,height,data:new Uint8ClampedArray(width*height*4)},heights={width,height,data:new Uint8ClampedArray(width*height*4)};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const k=4*(y*width+x),u=x%cw,v=y%ch;
  if(pattern==='empty')continue;
  art.data[k+3]=pattern==='opaque'?255:pattern==='no-heights'?255:((u*13+v*7)%31===0?7:((u-cw/2)**2/(cw*cw)+(v-ch*.4)**2/(ch*ch)<.15?255:0));
  if(pattern==='no-heights')continue;
  if(pattern==='opaque'||((u>cw*.2&&u<cw*.7)&&(v>ch*.35&&v<ch*.8))){heights.data[k]=12;heights.data[k+1]=u%3===0?3:0;heights.data[k+2]=1+(Math.floor(x/cw)%254);heights.data[k+3]=255;}
 }
 return{art,heights,cell:[cw,ch]};
}
