/** CPU-only merge contract benchmark; inputs and output checks are outside the measured loops. */
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { transform } from "esbuild";
import assert from "node:assert/strict";
const [beforePath, output] = process.argv.slice(2);
assert(beforePath && output, "Provide the original vector.ts and output JSON paths");
const source = await readFile(new URL("../engine/streaming/vector.ts", import.meta.url), "utf8");
const beforeSource = await readFile(beforePath, "utf8");
const load = async text => { const compiled = await transform(text, { loader: "ts", format: "esm" }); return import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`); };
const before = await load(beforeSource), after = await load(source);
const traces = JSON.parse(gunzipSync(await readFile(new URL("../test/streaming/ny-road-traces.json.gz", import.meta.url))));
const pieces = traces.paths.map(row => before.strokePolyline(row.path.map(([x, y]) => ({ x, y })), .00001));
const hash = mesh => createHash("sha256").update(JSON.stringify(mesh)).digest("hex");
const whole = before.mergeMeshes(pieces);
assert.equal(hash(after.mergeMeshes(pieces)), hash(whole), "dense source-piece geometry changed");
assert.equal(hash(after.mergeMeshes([whole])), hash(whole), "dense monolithic geometry changed");
let originalDenseFailure;
try { before.mergeMeshes([whole]); } catch (error) { originalDenseFailure = { name: error.name, message: error.message }; }
assert.equal(originalDenseFailure?.name, "RangeError");
const cases = [{ name: "normal", meshes: pieces.slice(0, 30), iterations: 100 }, { name: "dense-parts", meshes: pieces, iterations: 10 }, { name: "dense-monolithic", meshes: [whole], iterations: 10 }];
const results = [];
let sink = 0;
for (const test of cases) {
  const valid = test.name === "dense-monolithic" ? ["after"] : ["before", "after"];
  for (const key of valid) for (let i = 0; i < 5; i++) sink += ({ before, after }[key].mergeMeshes(test.meshes)).indices.length;
  const samples = { before: [], after: [] };
  const order = ["before", "after", "after", "before", "before", "after", "after", "before"].filter(key => valid.includes(key));
  for (const key of order) {
    const begin = performance.now();
    for (let i = 0; i < test.iterations; i++) sink += ({ before, after }[key].mergeMeshes(test.meshes)).indices.length;
    samples[key].push((performance.now() - begin) / test.iterations);
  }
  const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2 : null; };
  results.push({ name: test.name, parts: test.meshes.length, iterations: test.iterations, samplesMs: samples, medianMs: { before: median(samples.before), after: median(samples.after) } });
}
const report = { node: process.version, sourceSha256: createHash("sha256").update(source).digest("hex"), beforeSourceSha256: createHash("sha256").update(beforeSource).digest("hex"),
  recovery: traces.source, sourceRoads: pieces.length, positions: whole.positions.length, indices: whole.indices.length,
  attributes: Object.fromEntries(Object.entries(whole.attributes).map(([name, attribute]) => [name, { size: attribute.size, length: attribute.data.length }])),
  exactMeshSha256: hash(whole), originalDenseFailure, results, sink, note: "Recovered real NY source geometry aggregation, not the discarded native chunk. CPU merge duration is not game frame duration." };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
