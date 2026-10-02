import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

// Execute the changed source method intact; unrelated Persist methods are outside this coverage gate.
const source = await readFile('engine/persist/persist.ts', 'utf8');
const parsed = ts.createSourceFile('persist.ts', source, ts.ScriptTarget.Latest, true);
const indexedDB = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'IndexedDB');
const constructor = indexedDB.members.find(ts.isConstructorDeclaration);
const saveObject = indexedDB.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(parsed) === 'saveObject');
const module = `export class IndexedDB { storeName: string; db: IDBDatabase; ${constructor.getText(parsed)} ${saveObject.getText(parsed)} }`;
const output = await mkdtemp(join(tmpdir(), 'yage-persist-durability-'));
try {
    const compiled = ts.transpileModule(module, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
    await writeFile(join(output, 'persist.mjs'), compiled.outputText);
    const result = spawnSync(process.execPath, ['--test', '--experimental-test-coverage', `--test-coverage-include=${output}/persist.mjs`, '--test-coverage-lines=80', '--test-coverage-branches=80', '--test-coverage-functions=80', 'test/persist-durability/persist.node.mjs'],
        { stdio: 'inherit', env: { ...process.env, PERSIST_DURABILITY_MODULE: join(output, 'persist.mjs') } });
    process.exitCode = result.status ?? 1;
} finally { await rm(output, { recursive: true, force: true }); }
