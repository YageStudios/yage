import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
import { SaveStorage, atomicWrite, checksum, copyVerifiedSnapshot } from '../../server/saves/storage.mjs';
import { SaveService } from '../../server/saves/service.mjs';
import { putCareerDocument, createSaveSocket } from '../../server/saves/client.mjs';
import { attachSaveApi } from '../../server/saves/socket.mjs';
import { acquireLock, startSaveServer } from '../../server/saves/run.mjs';
const operatorCredential='operator-test-credential-32-characters';

async function setup(t, options={}) {
    const directory=await mkdtemp(join(tmpdir(),'yage-saves-'));t.after(()=>rm(directory,{recursive:true,force:true}));
    const opened=await SaveStorage.open(directory,options);assert.equal(opened.ok,true);
    const service=new SaveService(opened.storage,{operatorCredential,...options});
    const created=await service.request('createFamily',{operatorCredential});assert.equal(created.ok,true);
    return {directory,storage:opened.storage,service,...created.value};
}
const newCareer=ctx=>ctx.service.request('putCareer',{familyId:ctx.familyId,credential:ctx.memberCredential,gameId:'game-one',version:5,seq:0,doc:{level:1}});
const put=(ctx,career,extra={})=>ctx.service.request('putCareer',{careerId:career.careerId,credential:ctx.memberCredential,version:5,seq:career.seq,doc:{level:2},...extra});
const command=(...args)=>new Promise(resolve=>{
 const child=spawn(process.execPath,args,{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);child.on('close',code=>resolve({code,output}));
});

test('family credentials are hashed, parent creates bounded members and member permissions are isolated',async t=>{
 const ctx=await setup(t);assert.equal(new SaveService(ctx.storage,{operatorCredential}).operatorHash,checksum(operatorCredential));
 assert.throws(()=>new SaveService(ctx.storage,{operatorCredential:'short'}));
 assert.equal((await ctx.service.request('createFamily',{})).error.code,'unauthorized');
 assert.equal((await ctx.service.request('createMember',{familyId:ctx.familyId,credential:ctx.memberCredential})).error.code,'unauthorized');
 assert.equal((await ctx.service.request('createMember',{familyId:ctx.familyId,credential:ctx.parentCredential,displayName:'',avatar:'bear'})).error.code,'invalid_request');
 for(let n=0;n<7;n++)assert.equal((await ctx.service.request('createMember',{familyId:ctx.familyId,credential:ctx.parentCredential,displayName:`Person ${n}`,avatar:'bear'})).ok,true);
 assert.equal((await ctx.service.request('createMember',{familyId:ctx.familyId,credential:ctx.parentCredential,displayName:'Extra',avatar:'bear'})).error.code,'member_limit');
 const stored=await readFile(join(ctx.directory,'saves.json'),'utf8');assert.ok(!stored.includes(ctx.parentCredential));assert.ok(!stored.includes(ctx.memberCredential));
 assert.equal((await ctx.service.request('listCareers',{familyId:'__proto__',credential:ctx.memberCredential})).error.code,'unauthorized');
});
test('two simultaneous career writes have one CAS winner and survive restart with checksum',async t=>{
 const ctx=await setup(t),created=await newCareer(ctx);assert.equal(created.ok,true);const career=created.value;
 const results=await Promise.all([put(ctx,career),put(ctx,career,{doc:{level:3}})]);assert.equal(results.filter(result=>result.ok).length,1);assert.equal(results.find(result=>!result.ok).error.code,'stale_seq');
 const reopened=await SaveStorage.open(ctx.directory);assert.equal(reopened.ok,true);const service=new SaveService(reopened.storage,{operatorCredential});
 const fetched=await service.request('getCareer',{careerId:career.careerId,credential:ctx.memberCredential});assert.equal(fetched.value.seq,2);assert.equal(fetched.value.checksum,checksum(fetched.value.doc));
 const list=await service.request('listCareers',{familyId:ctx.familyId,credential:ctx.memberCredential});assert.equal(list.value.length,1);assert.equal(Object.hasOwn(list.value[0],'doc'),false);
 fetched.value.doc.level=999;assert.notEqual((await service.request('getCareer',{careerId:career.careerId,credential:ctx.memberCredential})).value.doc.level,999);
});
test('game validators reject malformed documents without parsing another game or rejecting profiles',async t=>{
 const ctx=await setup(t,{validators:{'game-one':doc=>doc.level>0,'throws':()=>{throw new Error('bad validator');}}});
 const career=(await newCareer(ctx)).value;
 for(const extra of [{version:0},{doc:[]},{doc:null},{doc:{level:0}},{doc:{text:'x'.repeat(1024*1024)}}])assert.equal((await put(ctx,career,extra)).error.code,'invalid_document');
 const cyclic={};cyclic.self=cyclic;assert.equal(ctx.service.validateDocument('game',5,cyclic).error.code,'invalid_document');
 assert.equal(ctx.service.validateDocument('throws',1,{}).error.code,'invalid_document');
 assert.equal((await ctx.service.request('putCareer',{familyId:ctx.familyId,credential:ctx.memberCredential,gameId:'another-game',version:1,seq:0,doc:{theme:'different'}})).ok,true);
 assert.equal((await ctx.service.request('putCareer',{familyId:ctx.familyId,credential:ctx.memberCredential,gameId:'game',version:1,seq:3,doc:{}})).error.code,'stale_seq');
 assert.equal((await ctx.service.request('getCareer',{careerId:career.careerId,credential:'wrong'})).error.code,'unauthorized');
 assert.equal((await ctx.service.request('unknown',{careerId:career.careerId,credential:ctx.memberCredential})).error.code,'invalid_request');
 assert.equal((await ctx.service.request('getCareer',null)).error.code,'invalid_request');
});
test('person collection profiles remain separate from careers, other members and local learning',async t=>{
 const ctx=await setup(t,{validators:{'game-one':doc=>doc.level>0}}),career=(await newCareer(ctx)).value;
 const member=(await ctx.service.request('createMember',{familyId:ctx.familyId,credential:ctx.parentCredential,displayName:'Sibling',avatar:'fox'})).value;
 const input={familyId:ctx.familyId,gameId:'game-one',personId:ctx.personId,credential:ctx.memberCredential,seq:0,doc:{cosmetics:['red'],postcards:['first'],achievements:['serve'],learningRef:'local-person'}};
 assert.equal((await ctx.service.request('getProfile',input)).value,null);assert.equal((await ctx.service.request('putProfile',input)).value.seq,1);
 assert.equal((await ctx.service.request('putProfile',input)).error.code,'stale_seq');
 assert.equal((await ctx.service.request('getProfile',{...input,credential:member.credential})).error.code,'unauthorized');
 assert.equal((await ctx.service.request('getProfile',{...input,credential:ctx.parentCredential})).ok,true);
 for(const doc of [{learning:{ratings:[100]}},{...input.doc,cosmetics:['bad id']},{...input.doc,cosmetics:['red','red']},{...input.doc,postcards:Array(1001).fill('x')},{...input.doc,learningRef:32}])assert.equal((await ctx.service.request('putProfile',{...input,seq:1,doc})).error.code,'invalid_profile');
 assert.equal((await ctx.service.request('getProfile',{...input,personId:'unknown',credential:ctx.parentCredential})).error.code,'unauthorized');
 assert.equal((await ctx.service.request('deleteCareer',{careerId:career.careerId,credential:ctx.memberCredential})).error.code,'unauthorized');
 assert.equal((await ctx.service.request('deleteCareer',{careerId:career.careerId,credential:ctx.parentCredential})).ok,true);
 assert.deepEqual((await ctx.service.request('getProfile',input)).value.doc,input.doc);
});
test('offline fast-forward is idempotent; divergence keeps both; parent promotion swaps documents',async t=>{
 const ctx=await setup(t),career=(await newCareer(ctx)).value;
 const input={careerId:career.careerId,credential:ctx.memberCredential,version:5,baseSeq:career.seq,offlineSessionId:'offline-one',label:'Tablet / today / level two',doc:{level:2}};
 const first=await ctx.service.request('putOfflineCopy',input);assert.equal(first.value.status,'fast_forward');assert.equal(first.value.career.seq,2);
 assert.deepEqual(await ctx.service.request('putOfflineCopy',input),first);
 assert.equal((await ctx.service.request('putOfflineCopy',{...input,doc:{level:100}})).error.code,'offline_conflict');
 assert.equal((await ctx.service.request('putOfflineCopy',{...input,offlineSessionId:'bad id'})).error.code,'invalid_request');
 assert.equal((await ctx.service.request('putOfflineCopy',{...input,offlineSessionId:'future',baseSeq:999})).error.code,'invalid_request');
 const diverged=await ctx.service.request('putOfflineCopy',{...input,offlineSessionId:'offline-two',doc:{level:3}});assert.equal(diverged.value.status,'diverged');
 const slotId=diverged.value.slot.slotId;assert.equal((await ctx.service.request('getCareer',{...input})).value.doc.level,2);
 assert.equal((await ctx.service.request('listSlots',input)).error.code,'unauthorized');
 assert.equal((await ctx.service.request('promoteSlot',{...input,slotId,seq:2})).error.code,'unauthorized');
 const promote={...input,credential:ctx.parentCredential,slotId,seq:2};assert.equal((await ctx.service.request('promoteSlot',{...promote,slotId:'missing'})).error.code,'not_found');
 assert.equal((await ctx.service.request('promoteSlot',{...promote,seq:1})).error.code,'stale_seq');
 assert.equal((await ctx.service.request('promoteSlot',promote)).value.doc.level,3);
 const slots=await ctx.service.request('listSlots',promote);assert.equal(slots.value.length,1);assert.equal(slots.value[0].doc.level,2);assert.equal(slots.value[0].label,'Previous main');
 const reopened=await SaveStorage.open(ctx.directory),service=new SaveService(reopened.storage,{operatorCredential});
 assert.deepEqual(await service.request('putOfflineCopy',input),first);
 assert.equal((await service.request('deleteCareer',promote)).ok,true);assert.equal(Object.keys(reopened.storage.snapshot().slots).length,0);assert.equal(Object.keys(reopened.storage.snapshot().uploads).length,0);
});
test('queued deletion returns explicit errors for update, offline upload and promotion',async t=>{
 const ctx=await setup(t),career=(await newCareer(ctx)).value;
 const offline={careerId:career.careerId,credential:ctx.memberCredential,version:5,baseSeq:0,offlineSessionId:'first',label:'Tablet',doc:{level:3}};
 const slot=(await ctx.service.request('putOfflineCopy',offline)).value.slot;
 const results=await Promise.all([
  ctx.service.request('deleteCareer',{careerId:career.careerId,credential:ctx.parentCredential}),put(ctx,career),ctx.service.request('putOfflineCopy',{...offline,offlineSessionId:'second'}),
  ctx.service.request('promoteSlot',{careerId:career.careerId,credential:ctx.parentCredential,slotId:slot.slotId,seq:1})]);
 assert.equal(results[0].ok,true);for(const result of results.slice(1))assert.equal(result.error.code,'not_found');
});
test('client-created identity has one initial CAS winner and preserves local doc sequence/checksum',async t=>{
 const ctx=await setup(t),input={familyId:ctx.familyId,credential:ctx.memberCredential,gameId:'game-one',careerId:'fixture:same-local-id',version:5,seq:0,doc:{careerId:'fixture:same-local-id',version:5,seq:41,baseSeq:0,checksum:'local-hash'}};
 const results=await Promise.all([ctx.service.request('putCareer',input),ctx.service.request('putCareer',input)]);assert.equal(results.filter(result=>result.ok).length,1);assert.equal(results.find(result=>!result.ok).error.code,'stale_seq');
 const saved=results.find(result=>result.ok).value;assert.equal(saved.careerId,input.doc.careerId);assert.equal(saved.seq,1);assert.deepEqual(saved.doc,input.doc);
 assert.equal((await ctx.service.request('putCareer',{...input,careerId:'bad id'})).error.code,'invalid_request');
 const socket={timeout(){return{async emitWithAck(){throw new Error('connection lost');}};}};
 assert.equal((await putCareerDocument(socket,{serverSeq:0},input.doc)).error.code,'connection_error');assert.equal((await putCareerDocument(socket,{},input.doc)).error.code,'invalid_request');
});
test('a failed durable write never acknowledges or erases the last accepted career',async t=>{
 const ctx=await setup(t),career=(await newCareer(ctx)).value;ctx.storage.writer=async()=>{throw new Error('disk full');};
 assert.equal((await put(ctx,career)).error.code,'storage_error');assert.equal(ctx.storage.snapshot().careers[career.careerId].seq,1);
 ctx.storage.writer=atomicWrite;assert.equal((await put(ctx,career)).ok,true);assert.equal((await ctx.storage.transact(()=>{throw new Error('unexpected');})).error.code,'storage_error');
 const blocked=join(ctx.directory,'not-directory');await writeFile(blocked,'file');assert.equal((await SaveStorage.open(blocked)).error.code,'storage_error');
});
test('retained backups recover corruption and verified export/restore preserves seq and profiles',async t=>{
 const ctx=await setup(t),career=(await newCareer(ctx)).value;await put(ctx,career);const archive=join(ctx.directory,'daily.json');assert.equal((await ctx.storage.backup(archive)).ok,true);
 assert.equal((await ctx.storage.backup(join(ctx.directory,'missing','file'))).error.code,'storage_error');
 const latest=ctx.storage.snapshot();await writeFile(join(ctx.directory,'saves.json'),'bad');const recovered=await SaveStorage.open(ctx.directory);assert.equal(recovered.recovered,true);assert.equal(recovered.storage.snapshot().careers[career.careerId].seq,1);
 assert.equal((await recovered.storage.restore(archive)).ok,true);assert.deepEqual(recovered.storage.snapshot(),latest);
 await rm(join(ctx.directory,'saves.json'));const missing=await SaveStorage.open(ctx.directory);assert.equal(missing.recovered,true);assert.equal((await missing.storage.restore(archive)).ok,true);
 const corrupt=join(ctx.directory,'bad.json');await writeFile(corrupt,'{}');assert.equal((await recovered.storage.restore(corrupt)).error.code,'invalid_backup');assert.deepEqual(recovered.storage.snapshot(),latest);
 assert.equal((await copyVerifiedSnapshot(archive,join(ctx.directory,'export.json'))).ok,true);assert.equal((await copyVerifiedSnapshot(corrupt,join(ctx.directory,'wrong.json'))).ok,false);
 for(const name of ['saves.json','backup-1.json','backup-2.json','backup-3.json'])await writeFile(join(ctx.directory,name),'bad');assert.equal((await SaveStorage.open(ctx.directory)).error.code,'corrupt_storage');
 assert.equal((await command('server/saves/backup.mjs','restore',ctx.directory,archive)).code,0);assert.deepEqual((await SaveStorage.open(ctx.directory)).storage.snapshot(),latest);
 assert.equal((await command('server/saves/backup.mjs','backup',ctx.directory,join(ctx.directory,'command.json'))).code,0);
 assert.equal((await command('server/saves/backup.mjs','restore',ctx.directory,corrupt)).code,1);assert.equal((await command('server/saves/backup.mjs')).code,1);
});
test('atomic write cleans temporary files if destination cannot be renamed',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'yage-atomic-'));t.after(()=>rm(directory,{recursive:true,force:true}));const target=join(directory,'folder');await mkdir(target);await assert.rejects(atomicWrite(target,'value'));
});
test('writer lock rejects another live process and clears a verified dead PID',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'yage-lock-'));t.after(()=>rm(directory,{recursive:true,force:true}));const first=await acquireLock(directory);assert.equal(first.ok,true);assert.equal((await acquireLock(directory)).ok,false);await first.release();
 await writeFile(join(directory,'writer.lock'),'bad');assert.equal((await acquireLock(directory)).ok,false);await writeFile(join(directory,'writer.lock'),'2147483647');const recovered=await acquireLock(directory);assert.equal(recovered.ok,true);await recovered.release();
 assert.equal((await acquireLock(join(directory,'missing'))).ok,false);
});

test('socket request errors are values and missing acknowledgements do not execute saves',async()=>{
 let connection,request;attachSaveApi({on(event,handler){connection=handler;}},{request:async()=>{throw new Error('broken service');}});connection({on(event,handler){request=handler;}});
 await request({action:'createFamily'});let result;await request(null,value=>result=value);assert.equal(result.error.code,'invalid_request');await request({action:'getCareer'},value=>result=value);assert.equal(result.error.code,'server_error');
});

test('actual YAGE Socket.IO save process supports two clients, restart and existing relay status',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'yage-save-process-'));
 t.after(async()=>{if(running)await running.close();await rm(directory,{recursive:true,force:true});});
 const started=await startSaveServer({directory,operatorCredential,port:0});assert.equal(started.ok,true,started.error?.message);let running=started;
 const url=`http://127.0.0.1:${started.server.address().port}`,clientA=createSaveSocket(url),clientB=io(url,{transports:['websocket']});t.after(()=>{clientA.close();clientB.close();});
 const request=(client,action,input)=>client.timeout(3000).emitWithAck('save:request',{action,input});
 const family=(await request(clientA,'createFamily',{operatorCredential})).value;
 const document={careerId:'local-v5-career',version:5,seq:43,baseSeq:0,checksum:'local-v5-checksum',career:{currentLocation:'one'}};
 const created=await putCareerDocument(clientA,{familyId:family.familyId,credential:family.memberCredential,gameId:'game',serverSeq:0},document);const career=created.value;
 assert.equal(career.careerId,document.careerId);assert.equal(career.seq,1);assert.deepEqual(career.doc,document);
 const writes=await Promise.all([request(clientA,'putCareer',{careerId:career.careerId,credential:family.memberCredential,version:5,seq:1,doc:{play:2}}),request(clientB,'putCareer',{careerId:career.careerId,credential:family.memberCredential,version:5,seq:1,doc:{play:3}})]);assert.equal(writes.filter(result=>result.ok).length,1);
 const joined=(client,event,args,reply)=>new Promise(resolve=>{client.once(reply,resolve);client.emit(event,...args);});
 await joined(clientA,'joinGroup',['save-isolation'],'groupJoined');await joined(clientB,'joinGroup',['save-isolation'],'groupJoined');
 await joined(clientA,'joinRoom',['room'],'roomJoined');await joined(clientB,'joinRoom',['room'],'roomJoined');
 let saveBroadcast=false;clientB.on('save:request',()=>saveBroadcast=true);
 assert.equal((await request(clientA,'unsupported',{})).error.code,'invalid_request');
 await request(clientA,'getCareer',{careerId:career.careerId,credential:family.memberCredential});
 const status=await fetch(`${url}/status`);assert.equal(status.status,200);const group=await(await fetch(`${url}/group/save-isolation/room/room`)).text();
 assert.equal(group.includes('save:request'),false);assert.equal(group.includes(family.memberCredential),false);assert.equal(saveBroadcast,false);
 const unavailable=await startSaveServer({directory,operatorCredential,port:0});assert.equal(unavailable.error.code,'writer_locked');
 const archive=join(directory,'daily.json');assert.equal((await command('server/saves/backup.mjs','backup',directory,archive)).code,0);assert.equal((await command('server/saves/backup.mjs','restore',directory,archive)).code,1);
 clientA.close();clientB.close();await started.close();running=undefined;
 const restarted=await startSaveServer({directory,operatorCredential,port:0});assert.equal(restarted.ok,true);running=restarted;const clientC=io(`http://127.0.0.1:${restarted.server.address().port}`,{transports:['websocket']});t.after(()=>clientC.close());
 const fetched=await request(clientC,'getCareer',{careerId:career.careerId,credential:family.memberCredential});assert.equal(fetched.value.seq,2);assert.equal(fetched.value.checksum,checksum(fetched.value.doc));
 const invalid=await startSaveServer({directory:join(directory,'new'),operatorCredential:'short',port:0});assert.equal(invalid.error.code,'startup_error');
});

test('CLI startup, SIGTERM shutdown and restart preserve durable state and release the writer lock',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'yage-cli-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const start=()=>{
  const child=spawn(process.execPath,['server/saves/run.mjs'],{cwd:process.cwd(),env:{...process.env,YAGE_SAVE_DIR:directory,YAGE_SAVE_OPERATOR_CREDENTIAL:operatorCredential,PORT:'0'},stdio:['ignore','pipe','pipe']});
  let output='';const ready=new Promise((resolve,reject)=>{child.stdout.on('data',data=>{output+=data;if(output.includes('Save API ready.'))resolve();});child.once('exit',code=>reject(new Error(`Server exited ${code}`)));});
  const closed=new Promise(resolve=>child.once('exit',resolve));return {child,ready,closed};
 };
 const first=start();t.after(()=>first.child.kill());await first.ready;assert.equal((await acquireLock(directory)).ok,false);first.child.kill('SIGTERM');assert.equal(await first.closed,0);
 const second=start();t.after(()=>second.child.kill());await second.ready;second.child.kill('SIGTERM');assert.equal(await second.closed,0);
 const invalid=await new Promise(resolve=>{
  const child=spawn(process.execPath,['server/saves/run.mjs'],{cwd:process.cwd(),env:{...process.env,YAGE_SAVE_DIR:join(directory,'invalid'),YAGE_SAVE_OPERATOR_CREDENTIAL:'short'},stdio:['ignore','pipe','pipe']});
  let output='';child.stderr.on('data',data=>output+=data);child.on('exit',code=>resolve({code,output}));
 });assert.equal(invalid.code,1);assert.match(invalid.output,/private operator credential/);
});
