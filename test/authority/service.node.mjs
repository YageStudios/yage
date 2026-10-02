import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SaveStorage, checksum } from '../../server/saves/storage.mjs';
import { SaveService } from '../../server/saves/service.mjs';
const operatorCredential='operator-test-credential-32-characters';
const debit=(id,amount,roomId)=>({id,kind:'debit',amount,roomId,personId:'p1',reason:'purchase'});

async function family(t){
 const directory=await mkdtemp(join(tmpdir(),'yage-ledger-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const open=async()=>{const opened=await SaveStorage.open(directory);assert.ok(opened.ok);return new SaveService(opened.storage,{operatorCredential});};
 const service=await open(),created=(await service.request('createFamily',{operatorCredential})).value;
 const career=(await service.request('putCareer',{familyId:created.familyId,credential:created.memberCredential,gameId:'game-one',version:1,seq:0,doc:{}})).value;
 return {directory,open,service,credential:created.memberCredential,careerId:career.careerId};
}
const call=(ctx,action,input={})=>ctx.service.request(action,{careerId:ctx.careerId,credential:ctx.credential,...input});

test('the save server orders concurrent room purchases durably so the family wallet is never overdrawn',async t=>{
 const ctx=await family(t);
 assert.equal((await call(ctx,'ledgerApply',{command:debit('x',1,'room-a')})).error.code,'not_found');
 assert.ok((await call(ctx,'ledgerOpen',{balance:100})).ok);assert.equal((await call(ctx,'ledgerOpen',{balance:5})).error.code,'ledger_exists');
 const results=await Promise.all([debit('a1',70,'room-a'),debit('b1',70,'room-b'),debit('b2',30,'room-b')].map(command=>call(ctx,'ledgerApply',{command})));
 assert.deepEqual(results.map(r=>r.ok),[true,false,true]);assert.equal(results[1].error.code,'insufficient_funds');
 const since=(await call(ctx,'ledgerSince',{seq:0})).value;assert.equal(since.balance,0);assert.deepEqual(since.events.map(e=>e.id),['a1','b2']);
 // A restarted server keeps the balance, the order and the remembered refusal.
 ctx.service=await ctx.open();
 assert.equal((await call(ctx,'ledgerSince',{seq:1})).value.events[0].id,'b2');
 assert.equal((await call(ctx,'ledgerApply',{command:{id:'credit-1',kind:'credit',amount:500,roomId:'room-a',personId:'p1',reason:'collect'}})).value.balanceAfter,500);
 assert.equal((await call(ctx,'ledgerApply',{command:debit('b1',70,'room-b')})).error.code,'insufficient_funds');
 assert.equal((await call(ctx,'ledgerApply',{command:debit('a1',70,'room-a')})).value.seq,1);
});

test('ledger actions need the family credential and valid input, and old databases open with no ledgers',async t=>{
 const ctx=await family(t);await call(ctx,'ledgerOpen',{balance:10});
 assert.equal((await ctx.service.request('ledgerApply',{careerId:ctx.careerId,credential:'wrong',command:debit('x',1,'room-a')})).error.code,'unauthorized');
 for(const balance of [-1,1.5,'10'])assert.equal((await call(ctx,'ledgerOpen',{balance})).ok,false);
 assert.equal((await call(ctx,'ledgerApply',{command:{id:'bad id'}})).error.code,'invalid_command');assert.equal((await call(ctx,'ledgerSince',{seq:-1})).ok,false);
 const before=await readFile(join(ctx.directory,'saves.json'),'utf8');await call(ctx,'ledgerApply',{command:{id:'bad'}});
 assert.equal(await readFile(join(ctx.directory,'saves.json'),'utf8'),before);
 const envelope=JSON.parse(before);delete envelope.data.ledgers;envelope.checksum=checksum(envelope.data);await writeFile(join(ctx.directory,'saves.json'),JSON.stringify(envelope));
 const reopened=await SaveStorage.open(ctx.directory);assert.ok(reopened.ok);assert.deepEqual(reopened.storage.snapshot().ledgers,{});
 envelope.data.ledgers=[];envelope.checksum=checksum(envelope.data);await writeFile(join(ctx.directory,'saves.json'),JSON.stringify(envelope));
 for(const i of [1,2,3])await rm(join(ctx.directory,`backup-${i}.json`),{force:true});
 assert.equal((await SaveStorage.open(ctx.directory)).ok,false);
});

test('a tampered stored ledger is refused rather than spent from, and long histories compact',async t=>{
 const ctx=await family(t);await call(ctx,'ledgerOpen',{balance:5000});
 for(let n=0;n<1005;n++)assert.ok((await call(ctx,'ledgerApply',{command:debit(`d${n}`,1,'room-a')})).ok);
 const head=(await call(ctx,'ledgerSince',{seq:1004})).value;assert.equal(head.seq,1005);assert.equal(head.balance,3995);
 assert.equal((await call(ctx,'ledgerSince',{seq:0})).error.code,'compacted');
 await ctx.service.storage.transact(next=>{next.ledgers[ctx.careerId].balance+=1000;return {ok:true};});
 assert.equal((await call(ctx,'ledgerApply',{command:debit('z',1,'room-a')})).error.code,'invalid_snapshot');
 assert.equal((await call(ctx,'ledgerSince',{seq:1004})).error.code,'invalid_snapshot');
});
