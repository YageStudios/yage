import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SaveStorage } from '../../server/saves/storage.mjs';
import { SaveService } from '../../server/saves/service.mjs';
import { WalletClient } from '../../server/authority/client.mjs';
const operatorCredential='operator-test-credential-32-characters';

/** A real save service behind a socket double whose acknowledgements can be lost after the server applied them. */
async function wallet(t,{lose=0}={}){
 const directory=await mkdtemp(join(tmpdir(),'yage-wallet-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const service=new SaveService((await SaveStorage.open(directory)).storage,{operatorCredential});
 const fam=(await service.request('createFamily',{operatorCredential})).value;
 const career=(await service.request('putCareer',{familyId:fam.familyId,credential:fam.memberCredential,gameId:'g',version:1,seq:0,doc:{}})).value;
 let dropped=0,calls=0;
 const socket={timeout:()=>({emitWithAck:async(event,payload)=>{calls++;assert.equal(event,'save:request');const result=await service.request(payload.action,payload.input);
  if(payload.action==='ledgerApply'&&dropped<lose){dropped++;throw new Error('ack lost');}return result;}})};
 let n=0;return {client:new WalletClient(socket,{careerId:career.careerId,credential:fam.memberCredential,newId:()=>`cmd-${++n}`}),calls:()=>calls};
}

test('a lost acknowledgement is retried with the same id and never charges twice',async t=>{
 const {client,calls}=await wallet(t,{lose:2});assert.ok((await client.open(100)).ok);
 const spent=await client.spend(60,'room-a','p1','gate');assert.ok(spent.ok);assert.equal(spent.id,'cmd-1');assert.equal(spent.value.balanceAfter,40);assert.equal(calls(),4);
 const state=(await client.since(0)).value;assert.equal(state.balance,40);assert.equal(state.events.length,1);
 const refused=await client.spend(60,'room-b','p2','gate');assert.equal(refused.error.code,'insufficient_funds');
 assert.equal((await client.collect(25,'room-b','p2','floor cash')).value.balanceAfter,65);
});

test('when every acknowledgement is lost the caller learns it and can retry later with the same id',async t=>{
 const {client}=await wallet(t,{lose:6});await client.open(100);
 const lost=await client.spend(30,'room-a','p1','gate');assert.equal(lost.error.code,'connection_error');
 const again=await client.apply({kind:'debit',amount:30,roomId:'room-a',personId:'p1',reason:'gate',id:lost.id});assert.equal(again.error.code,'connection_error');
 const settled=await client.apply({kind:'debit',amount:30,roomId:'room-a',personId:'p1',reason:'gate',id:lost.id});
 assert.ok(settled.ok);assert.equal(settled.value.balanceAfter,70);assert.equal((await client.since(0)).value.events.length,1);
});

test('malformed acknowledgements count as lost, and server errors are not retried',async t=>{
 let calls=0;const socket={timeout:()=>({emitWithAck:async()=>{calls++;return calls===1?null:{ok:false,error:{code:'unauthorized',message:'no'}};}})};
 const client=new WalletClient(socket,{careerId:'c',credential:'x'});
 const result=await client.spend(1,'room-a','p1','gate');assert.equal(result.error.code,'unauthorized');assert.equal(calls,2);assert.match(result.id,/^[0-9a-f-]{36}$/);
});
