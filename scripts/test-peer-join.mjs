import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';
// Cover intact changed source seams; native PEER tests separately cover actual WebRTC integration.
const source=await readFile('engine/connection/PeerMultiplayerInstance.ts','utf8');
const parsed=ts.createSourceFile('Peer.ts',source,ts.ScriptTarget.Latest,true);
const peer=parsed.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='PeerMultiplayerInstance');
const members=peer.members.filter(node=>ts.isPropertyDeclaration(node)&&['peer','connections','connectionPromise','prefix','selfAddress','unloadDisconnectAnnounced','requireExistingHost','rejectJoin'].includes(node.name.getText(parsed))||ts.isConstructorDeclaration(node)||ts.isMethodDeclaration(node)&&['handshake','connect'].includes(node.name.getText(parsed)));
const module=`const CoreConnectionInstance=globalThis.PeerTestBase,Peer=globalThis.PeerTestMock,nanoid=globalThis.PeerTestId;
export class PeerMultiplayerInstance extends CoreConnectionInstance {${members.map(node=>node.getText(parsed)).join('\n')}
installPageDisconnectHandlers(){} handleConnection(connection){globalThis.PeerTestConnections.push(connection);} emit(){}}
`;
const output=await mkdtemp(join(tmpdir(),'yage-peer-join-'));
try{
 const compiled=ts.transpileModule(module,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
 await writeFile(join(output,'peer.mjs'),compiled.outputText);
 const result=spawnSync(process.execPath,['--test','--experimental-test-coverage',`--test-coverage-include=${output}/peer.mjs`,'--test-coverage-lines=80','--test-coverage-branches=80','--test-coverage-functions=80','test/peer-join/peer.node.mjs'],{stdio:'inherit',env:{...process.env,PEER_JOIN_MODULE:join(output,'peer.mjs')}});
 process.exitCode=result.status??1;
}finally{await rm(output,{recursive:true,force:true});}
