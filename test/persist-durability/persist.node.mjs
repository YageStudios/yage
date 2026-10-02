import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { IndexedDB } = await import(pathToFileURL(process.env.PERSIST_DURABILITY_MODULE));

function write() {
    const calls=[], request={result:'saved-key',error:null}, transaction={error:null,objectStore(name){calls.push(['store',name]);return{put(value){calls.push(['put',value]);return request;}};}};
    const storage=new IndexedDB('persist');storage.db={transaction(stores,mode){calls.push(['transaction',stores,mode]);return transaction;}};
    const promise=storage.saveObject('career','{"version":5}');return {promise,calls,request,transaction};
}
test('save remains pending after a successful request until the transaction commits',async()=>{
    const ctx=write();let settled=false;ctx.promise.then(()=>settled=true,()=>settled=true);assert.deepEqual(ctx.calls,[['transaction',['persist'],'readwrite'],['store','persist'],['put',{key:'career',data:'{"version":5}'}]]);
    ctx.request.onsuccess?.();await Promise.resolve();assert.equal(settled,false);ctx.transaction.oncomplete();assert.equal(await ctx.promise,'saved-key');assert.equal(settled,true);
});
for(const [event,errorField,message] of [['onabort','transaction','Save transaction aborted'],['onerror','transaction','Save transaction failed'],['onerror','request','Save request failed']]){
    test(`${errorField} ${event} rejects the original storage error after request success`,async()=>{
        const ctx=write(),error=new Error('disk failure');ctx.request.onsuccess?.();ctx[errorField].error=error;
        const rejected=assert.rejects(ctx.promise,value=>value===error);ctx[errorField][event]();await rejected;ctx.transaction.oncomplete();
    });
    test(`${errorField} ${event} without an error supplies a useful failure value`,async()=>{
        const ctx=write(),rejected=assert.rejects(ctx.promise,new RegExp(message));ctx[errorField][event]();await rejected;
    });
}
