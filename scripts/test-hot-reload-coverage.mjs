import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const engineRoot = fileURLToPath(new URL("../", import.meta.url));
const output = fs.mkdtempSync(path.join(os.tmpdir(), "yage-hot-reload-coverage-"));
const compile = filename => {
  const source = fs.readFileSync(path.join(engineRoot, filename), "utf8");
  const code = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      experimentalDecorators: true,
    },
  }).outputText;
  const target = path.join(output, path.basename(filename, ".ts") + ".js");
  fs.writeFileSync(target, code);
};

try {
  compile("engine/dev/hotReload.ts");
  compile("engine/entity/hotDefaults.ts");
  fs.writeFileSync(path.join(output, "package.json"), '{"type":"module"}');
  fs.symlinkSync(path.join(engineRoot, "node_modules"), path.join(output, "node_modules"), "dir");
  const runtimeCoverageTargets = ["hotReload.js", "hotDefaults.js"].map(file =>
    `--test-coverage-include=${path.join(output, file)}`
  );
  const runCoverage = (coverageTargets, testFile) => spawnSync(process.execPath, [
    "--experimental-test-coverage",
    ...coverageTargets,
    "--test-coverage-lines=80",
    "--test-coverage-branches=80",
    "--test-coverage-functions=80",
    testFile,
  ], {
    cwd: engineRoot,
    env: { ...process.env, YAGE_HOT_RELOAD_BUILD: output },
    stdio: "inherit",
  });
  const runtime = runCoverage(runtimeCoverageTargets, "test/hot-reload-coverage.node.mjs");
  const tooling = runCoverage(
    [`--test-coverage-include=${path.join(engineRoot, "tooling/hot-reload.mjs")}`],
    "test/tooling/hot-reload.test.mjs"
  );
  process.exitCode = runtime.status === 0 && tooling.status === 0 ? 0 : 1;
} finally {
  fs.rmSync(output, { force: true, recursive: true });
}
