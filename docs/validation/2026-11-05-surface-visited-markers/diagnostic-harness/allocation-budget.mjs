import assert from 'node:assert/strict';import{load,fixture}from'./load.mjs';
const variant=process.argv[2];if(!['original','candidate'].includes(variant))throw Error('Specify variant');
const allocations=[],f=fixture(37,41,8,9),n=f.art.width*f.art.height;load(variant,{allocations}).paintSurface(f.art,f.heights,f.cell,2,3,.75);
const bytes=allocations.filter(a=>a.length===n).reduce((sum,a)=>sum+a.bytes,0);console.log(JSON.stringify({variant,pixels:n,visitedBackingBytes:bytes,budgetBytes:n}));assert.ok(bytes<=n,'visited marker budget: at most one byte per pixel');
