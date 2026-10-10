import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { spawnSync } from 'node:child_process';
const out = '.audio-build';
fs.rmSync(out, { recursive: true, force: true });
function compile(directory, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const source = path.join(directory, entry.name), dest = path.join(target, entry.name);
    if (entry.isDirectory()) compile(source, dest);
    else if (entry.name.endsWith('.ts')) {
      const result = ts.transpileModule(fs.readFileSync(source, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
      fs.writeFileSync(dest.replace(/\.ts$/, '.js'), result.outputText.replace(/(from\s+['"])(\.[^'"]+)(['"])/g, '$1$2.js$3'));
    }
  }
}
compile('engine/audio', out);
compile('test/helpers', out + '/helpers');
fs.writeFileSync(out + '/package.json', '{"type":"module"}');
const result = spawnSync(process.execPath, ['--test', '--experimental-test-coverage',
  '--test-coverage-include=.audio-build/SpatialPlayback.js', '--test-coverage-include=.audio-build/runtime.js',
  '--test-coverage-include=.audio-build/buffer-cache.js', '--test-coverage-include=.audio-build/buffer-render.js',
  '--test-coverage-include=.audio-build/buffer-playback.js',
  '--test-coverage-lines=80', '--test-coverage-branches=80', '--test-coverage-functions=80',
  'test/audio/audio.node.mjs', 'test/audio/buffer.node.mjs'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
