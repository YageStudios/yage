import test from "node:test";
import assert from "node:assert/strict";
import { yageHotReload } from "../../tooling/hot-reload.mjs";

const configure = (plugins, root, command = "serve") => {
  for (const plugin of plugins) plugin.configResolved({ root, command });
};
test("wraps aliased MineCS System decorators and self-accepts the updated module", () => {
  const [systems] = yageHotReload();
  const root = "/tmp/yage-hot-reload-project";
  configure([systems], root);
  const transformed = systems.transform(
    'import { System as Decorator, SystemImpl } from "minecs";\n@Decorator(Position)\nexport class MoveSystem extends SystemImpl {}',
    `${root}/src/MoveSystem.ts`
  );

  assert.match(transformed.code, /beginHotSystems/);
  assert.match(transformed.code, /const Decorator = \(\.\.\.args\) => __yageHotSystem/);
  assert.match(transformed.code, /import \{ SystemImpl \} from "minecs"/);
  assert.doesNotMatch(transformed.code, /System as Decorator/);
  assert.match(transformed.code, /__yageFinish\([^\n]+yageLoaded/);
  assert.match(transformed.code, /import\.meta\.hot\.accept\(\)/);
  assert.match(transformed.code, /import\.meta\.hot\.invalidate\("System structure changed"\)/);
});

test("wraps direct System imports, and skips non-game, dependency, query, and non-decorator modules", () => {
  const [systems] = yageHotReload();
  const root = "/tmp/yage-hot-reload-project";
  configure([systems], root);
  const source = 'import { System, SystemImpl } from "minecs";\n@System(Position)\nclass MoveSystem extends SystemImpl {}';
  assert.match(systems.transform(source, `${root}/src/MoveSystem.ts`).code, /const System = /);
  assert.equal(systems.transform(source, "/tmp/other/MoveSystem.ts"), null);
  assert.equal(systems.transform(source, `${root}/node_modules/pkg/MoveSystem.ts`), null);
  assert.equal(systems.transform(source, `${root}/src/MoveSystem.ts?raw`), null);
  assert.equal(systems.transform('import { System } from "minecs";', `${root}/src/plain.ts`), null);
  configure([systems], root, "build");
  assert.equal(systems.transform(source, `${root}/src/MoveSystem.ts`), null);
});

test("stages exported entity JSON modules, including Vite import queries, while preserving raw assets", () => {
  const [, entities] = yageHotReload();
  const root = "/tmp/yage-hot-reload-project";
  configure([entities], root);
  const file = `${root}/src/entities/Player.json5`;
  const transformed = entities.transform("export default { name: 'Player' };", `${file}?import`);

  assert.match(transformed.code, /const __yageEntity = \{ name: 'Player' \};/);
  assert.match(transformed.code, /export default __yageEntity/);
  assert.match(transformed.code, /stageEntityDefinition/);
  assert.match(transformed.code, /Entity structure changed/);
  assert.match(transformed.code, /import\.meta\.hot\.accept\(\)/);
  assert.equal(entities.transform("export default {}", `${file}?raw`), null);
  assert.equal(entities.transform("export default {}", `${file}?url`), null);
  assert.equal(entities.transform("const value = {};", file), null);
  assert.equal(entities.transform("export default {};", `${root}/src/data/Player.json5`), null);
});

test("forces a full reload when an imported MineCS component schema changes", async () => {
  const [systems] = yageHotReload();
  const root = "/tmp/yage-hot-reload-project";
  configure([systems], root);
  const messages = [];
  const result = await systems.handleHotUpdate({
    file: `${root}/src/components/Position.ts`,
    read: async () => 'import { Component, Schema } from "minecs";\n@Component(Position)\nclass Position extends Schema {}',
    server: { ws: { send(message) { messages.push(message); } } },
  });

  assert.deepEqual(result, []);
  assert.deepEqual(messages, [{ type: "full-reload", path: "*" }]);
  assert.equal(await systems.handleHotUpdate({
    file: `${root}/src/systems/Move.ts`,
    read: async () => 'import { Component } from "minecs";\nconst value = 1;',
    server: { ws: { send() { assert.fail("non-decorator edits should not reload"); } } },
  }), undefined);
});

test("falls back to a full reload when the last system decorator is removed", async () => {
  const [systems] = yageHotReload();
  const root = "/tmp/yage-hot-reload-project";
  configure([systems], root);
  const file = `${root}/src/Changed.ts`;
  systems.transform(
    'import { System, SystemImpl } from "minecs";\n@System(Position)\nclass ChangedSystem extends SystemImpl {}',
    file
  );
  const messages = [];
  const result = await systems.handleHotUpdate({
    file,
    read: async () => 'import { System, SystemImpl } from "minecs";\nexport class ChangedSystem extends SystemImpl {}',
    server: { ws: { send(message) { messages.push(message); } } },
  });

  assert.deepEqual(result, []);
  assert.deepEqual(messages, [{ type: "full-reload", path: "*" }]);
});
