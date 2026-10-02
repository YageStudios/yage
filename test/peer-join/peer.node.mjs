import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
let serial=0,collision=false;
class Emitter {
 handlers=new Map();
 on(name,callback){const list=this.handlers.get(name)??[];list.push(callback);this.handlers.set(name,list);return this;}
 once(name,callback){const once=(...args)=>{this.handlers.set(name,(this.handlers.get(name)??[]).filter(fn=>fn!==once));callback(...args);};return this.on(name,once);}
 off(name){this.handlers.delete(name);}
 fire(name,...args){for(const callback of [...(this.handlers.get(name)??[])])callback(...args);}
}
class Peer extends Emitter {
 destroyed=false;connections=[];
 constructor(id,options){super();this.id=id;this.options=options;queueMicrotask(()=>{if(collision){collision=false;this.fire('error',{type:'unavailable-id',message:'Already registered'});}else this.fire('open',id);});}
 connect(target){const connection=new Emitter();connection.peer=target;connection.closed=false;connection.close=()=>{connection.closed=true;};this.connections.push(connection);return connection;}
 destroy(){this.destroyed=true;}
}
globalThis.PeerTestBase=class {
 constructor(player){this.player={...player,connected:false};this.address='';this.connections={};this.synced=false;this.roomSyncResolve=()=>{this.synced=true;};}
 connect(){}
};
globalThis.PeerTestMock=Peer;globalThis.PeerTestId=()=>String(++serial);globalThis.PeerTestConnections=[];globalThis.location={protocol:'http:'};
const {PeerMultiplayerInstance}=await import(pathToFileURL(process.env.PEER_JOIN_MODULE));
const create=options=>new PeerMultiplayerInstance({netId:'captain'}, {},{prefix:'test-',...options});
const begin=async instance=>{await instance.connectionPromise;const pending=instance.connect();await Promise.resolve();return {pending,connection:instance.peer.connections[0]};};
test('default host behaviour and already-prefixed addresses remain supported',async()=>{
 for(const options of [{address:'room'},{address:'test-room'},{}]){
  const instance=create(options);await instance.connect();assert.equal(instance.player.connected,true);assert.equal(instance.synced,true);assert.equal(instance.peer.connections.length,0);
 }
});
test('explicit joining uses a unique registration, then opens the requested room',async()=>{
 const instance=create({address:'room',requireExistingHost:true,host:'127.0.0.1:5185/peer'}),{pending,connection}=await begin(instance);
 assert.notEqual(instance.selfAddress,'test-room');assert.equal(connection.peer,'test-room');connection.fire('open');await pending;
 assert.equal(instance.player.connected,true);assert.equal(instance.connections['test-room'],connection);assert.equal(instance.rejectJoin,null);
 assert.deepEqual(instance.peer.options,{host:'127.0.0.1',port:5185,path:'peer',secure:false});
});
test('signaling TLS selection and incoming connection callbacks remain intact',async()=>{
 const publicPeer=create({address:'room',host:'peer.yage.games'});await publicPeer.connectionPromise;assert.equal(publicPeer.peer.options.secure,true);assert.equal(publicPeer.peer.options.path,'/');
 const original=location.protocol;location.protocol='https:';
 const secure=create({address:'room',host:'host:8443/path'});await secure.connectionPromise;assert.equal(secure.peer.options.secure,true);location.protocol=original;
 const incoming=new Emitter();publicPeer.peer.fire('connection',incoming);assert.ok(PeerTestConnections.includes(incoming));assert.equal(publicPeer.peer.handlers.has('error'),false);
});
test('existing default collision retries preserve a joining connection',async()=>{
 collision=true;const instance=create({address:'room'}),{pending,connection}=await begin(instance);assert.notEqual(instance.selfAddress,'test-room');connection.fire('open');await pending;assert.equal(instance.player.connected,true);
});
test('unavailable explicit room rejects and destroys temporary signaling and data connection',async()=>{
 const instance=create({address:'missing',requireExistingHost:true}),{pending,connection}=await begin(instance);
 const rejected=assert.rejects(pending,/Room unavailable or running a different game build/);instance.peer.fire('error',{type:'peer-unavailable',message:'No room'});await rejected;
 assert.equal(connection.closed,true);assert.equal(instance.peer.destroyed,true);assert.equal(instance.player.connected,false);assert.equal(instance.rejectJoin,null);
});
test('explicit join cannot accidentally become the requested host',async()=>{
 const instance=create({address:'room',requireExistingHost:true});await instance.connectionPromise;instance.selfAddress='test-room';await assert.rejects(instance.connect(),/Room unavailable/);assert.equal(instance.peer.destroyed,true);
});
test('timeouts reject both joining modes and release pending callbacks',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const required of [false,true]){
  const instance=create({address:'room',requireExistingHost:required});await instance.connectionPromise;instance.selfAddress='test-other';const {pending,connection}=await begin(instance);
  const rejected=assert.rejects(pending,required?/Room unavailable/:/Connection timed out/);t.mock.timers.tick(10000);await rejected;
  assert.equal(connection.closed,true);assert.equal(instance.peer.destroyed,required);assert.equal(instance.rejectJoin,null);
 }
});
test('an explicit peer-id collision retries rather than reporting room unavailable',async()=>{
 collision=true;const instance=create({address:'room',requireExistingHost:true}),{pending,connection}=await begin(instance);connection.fire('open');await pending;assert.equal(instance.player.connected,true);
});
test('pre-open signaling errors reject the retained promise and ignore late open',async()=>{
 const instance=create({address:'room',requireExistingHost:true});const peer=instance.peer;
 peer.fire('error',{type:'network',message:'Signaling unavailable'});
 await assert.rejects(instance.connect(),/Room unavailable/);await new Promise(resolve=>setImmediate(resolve));
 peer.fire('open','late');assert.equal(instance.player.connected,false);assert.equal(instance.player.connectionId,undefined);assert.equal(peer.destroyed,true);
});
test('signaling error, timeout and late data open settle once without reconnecting',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const instance=create({address:'room',requireExistingHost:true}),{pending,connection}=await begin(instance);
 let closed=0;connection.close=()=>closed++;
 const rejected=assert.rejects(pending,/Room unavailable/);instance.peer.fire('error',{type:'peer-unavailable',message:'Missing'});await rejected;
 t.mock.timers.tick(10000);connection.fire('open');instance.peer.fire('error',{type:'network',message:'Late failure'});
 assert.equal(closed,1);assert.equal(instance.player.connected,false);assert.equal(instance.rejectJoin,null);
});
