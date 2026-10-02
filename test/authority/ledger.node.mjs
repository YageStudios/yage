import test from 'node:test';
import assert from 'node:assert/strict';
import { CareerLedger } from '../../server/authority/ledger.mjs';
const debit=(id,amount,roomId='room-a',personId='p1')=>({id,kind:'debit',amount,roomId,personId,reason:'purchase'});
const credit=(id,amount,roomId='room-a',personId='p1')=>({id,kind:'credit',amount,roomId,personId,reason:'collect'});

test('two rooms spending concurrently can never overdraw one shared wallet',()=>{
 const ledger=new CareerLedger({balance:100});
 // Interleaved requests from two rooms that each saw 100 in their quote.
 const results=[debit('a1',70,'room-a'),debit('b1',70,'room-b'),debit('b2',30,'room-b'),debit('a2',1,'room-a')].map(c=>ledger.apply(c));
 assert.deepEqual(results.map(r=>r.ok),[true,false,true,false]);assert.equal(results[1].error.code,'insufficient_funds');
 assert.equal(ledger.balance,0);assert.deepEqual(ledger.events.map(e=>[e.seq,e.id,e.balanceAfter]),[[1,'a1',30],[2,'b2',0]]);
});

test('retries are idempotent, refusals stay refused, and a reused id with new contents is rejected',()=>{
 const ledger=new CareerLedger({balance:50});
 const first=ledger.apply(debit('buy-1',40));assert.deepEqual(ledger.apply(debit('buy-1',40)),first);assert.equal(ledger.balance,10);assert.equal(ledger.seq,1);
 const refused=ledger.apply(debit('buy-2',20));assert.equal(refused.ok,false);ledger.apply(credit('tips-1',100));
 assert.deepEqual(ledger.apply(debit('buy-2',20)),refused);assert.equal(ledger.balance,110);
 assert.equal(ledger.apply(debit('buy-1',41)).error.code,'duplicate_id');assert.equal(ledger.apply({...debit('buy-1',40),roomId:'room-b'}).error.code,'duplicate_id');
});

test('credits stop at the safe limit and malformed commands change nothing',()=>{
 const ledger=new CareerLedger({balance:5,maxBalance:10});
 assert.equal(ledger.apply(credit('c1',6)).error.code,'balance_limit');assert.ok(ledger.apply(credit('c2',5)).ok);assert.equal(ledger.balance,10);
 for(const bad of [null,{},debit('x',0),debit('x',1.5),debit('x',-1),debit('x',Number.MAX_SAFE_INTEGER+1),{...debit('x',1),kind:'mint'},debit('bad id',1),
  {...debit('x',1),roomId:''},{...debit('x',1),personId:'a b'},{...debit('x',1),reason:'r'.repeat(65)},{...debit('x',1),reason:5}])
  assert.equal(ledger.apply(bad).error.code,'invalid_command');
 assert.equal(ledger.balance,10);assert.equal(ledger.seq,1);
});

test('rooms catch up through numbered events exactly once, and compaction keeps retries idempotent',()=>{
 const ledger=new CareerLedger({balance:100});
 for(let n=1;n<=5;n++)ledger.apply(debit(`d${n}`,10,n%2?'room-a':'room-b'));
 assert.deepEqual(ledger.eventsSince(3).value.map(e=>e.seq),[4,5]);assert.deepEqual(ledger.eventsSince(5).value,[]);
 assert.equal(ledger.eventsSince(-1).ok,false);assert.equal(ledger.eventsSince(1.5).ok,false);
 assert.deepEqual(ledger.compact(3).value,{seq:5,retained:2});assert.equal(ledger.eventsSince(2).error.code,'compacted');assert.deepEqual(ledger.eventsSince(3).value.map(e=>e.seq),[4,5]);
 assert.equal(ledger.apply(debit('d1',10,'room-a')).ok,true);assert.equal(ledger.balance,50);
 for(const bad of [-1,6,1.5])assert.equal(ledger.compact(bad).ok,false);
 const empty=new CareerLedger({balance:3});assert.deepEqual(empty.eventsSince(0).value,[]);
});

test('snapshots restore exactly and tampered snapshots cannot mint money',()=>{
 const ledger=new CareerLedger({balance:100});ledger.apply(debit('d1',30));ledger.apply(credit('c1',5));ledger.apply(debit('d2',200));
 const snapshot=ledger.snapshot(),restored=CareerLedger.restore(structuredClone(snapshot));assert.ok(restored.ok);
 assert.deepEqual(restored.value.snapshot(),snapshot);assert.deepEqual(restored.value.apply(debit('d1',30)),ledger.apply(debit('d1',30)));
 ledger.compact(1);assert.ok(CareerLedger.restore(ledger.snapshot()).ok);assert.ok(CareerLedger.restore(new CareerLedger({balance:7}).snapshot()).ok);
 const tamper=[s=>s.balance+=1000,s=>s.events[0].amount=1,s=>s.events[1].seq=9,s=>s.events[0].kind='gift',s=>s.seq=99,s=>s.balance=-1,s=>s.maxBalance=1.5,
  s=>s.events=null,s=>s.results=[],s=>s.results['bad id']={fingerprint:'x',ok:true},s=>s.results.d1=null,s=>s.events[0].id='bad id',s=>s.events[0].balanceAfter=-5,s=>s.balance=s.maxBalance+1,s=>s.baseBalance+=5,s=>s.baseBalance=-1];
 for(const [n,mutate] of tamper.entries()){const bad=structuredClone(snapshot);mutate(bad);assert.equal(CareerLedger.restore(bad).ok,false,`tamper ${n}`);}
 for(const bad of [null,[],'x'])assert.equal(CareerLedger.restore(bad).ok,false);
});
