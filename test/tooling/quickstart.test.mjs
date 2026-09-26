import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Optional override only for running against an already-installed TypeScript compiler.
// Normal engine installations resolve the pinned devDependency without an override.
let ts;
try { ts = (await import(process.env.YAGE_TYPESCRIPT_PATH ?? "typescript")).default; } catch {}
const skip = !ts ? "Install engine devDependencies to run QuickStart execution tests." : false;

async function harness(e2e = false) {
  let resolveRoom, rejectRoom;
  const room = new Promise((resolve, reject) => { resolveRoom = resolve; rejectRoom = reject; });
  const state = { roomStarted: false, stopped: false, instance: null, initializeRoomArgs: null };
  const context = vm.createContext({ window: { location: { search: e2e ? "?e2e=true" : "" } }, URLSearchParams });
  class GameInstance {
    constructor(options) { this.options = options; state.instance = this; }
    async initializeRoom(roomId, seed) {
      state.roomStarted = true;
      state.initializeRoomArgs = [roomId, seed];
      await room;
      this.ticker = { stop: () => { state.stopped = true; } };
    }
  }
  class Connection { async connect() {} }
  // Mirrors the real class: in-memory history is applied in the constructor,
  // so replayHistory is available right after construction.
  class HistoryConnection extends Connection {
    constructor(history) {
      super();
      this.replayHistory = history ? history[Object.keys(history)[0]] : undefined;
    }
  }
  class InputManager {}
  class KeyboardListener { init() {} destroy() {} }
  class MouseManager {}
  class E2EBridge { ready = false; }
  const stubs = {
    ConnectionInstance: { isPlayerConnect: () => false },
    SingleplayerConnectionInstance: { SingleplayerConnectionInstance: Connection },
    GameInstance: { GameInstance },
    InputManager: { InputManager, MappedKeys: { UP: "w" } },
    MouseManager: { MouseManager },
    KeyboardListener: { KeyboardListener },
    AssetLoader: { default: { getInstance: () => ({ load: async () => {} }) } },
    PlayerInput: { PlayerInput: class {} },
    UIService: { UIService: { getInstance: () => ({}) } },
    HistoryConnectionInstance: { HistoryConnectionInstance: HistoryConnection },
    PeerMultiplayerInstance: { PeerMultiplayerInstance: Connection, isPeerMultiplayerInstanceOptions: () => true },
    SocketIoMultiplayerInstance: { SocketIoMultiplayerInstance: Connection, isSocketIoMultiplayerInstanceOptions: () => true },
    E2EConnectionInstance: { E2EConnectionInstance: Connection },
    E2EBridge: { E2EBridge },
    CoopConnectionInstance: { CoopConnectionInstance: Connection },
    mobileFullscreen: { ensureMobileFullscreenButton: () => {} },
  };
  const source = readFileSync(new URL("../../engine/game/QuickStart.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  });
  const module = new vm.SourceTextModule(outputText, { context });
  await module.link((specifier) => {
    const values = stubs[specifier.split("/").at(-1)];
    assert.ok(values, `Unexpected runtime dependency: ${specifier}`);
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  const start = () => module.namespace.QuickStart({
    gameName: "test", connection: "SINGLEPLAYER", onPlayerJoin: () => 1, preload: async () => {},
  });
  return { start, quickStart: module.namespace.QuickStart, HistoryConnection, state, context, resolveRoom, rejectRoom };
}

async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

test("QuickStart does not resolve until room initialization finishes", { skip }, async () => {
  const h = await harness();
  let complete = false;
  const startup = h.start().then((instance) => { complete = true; return instance; });
  await flush();
  assert.equal(h.state.roomStarted, true);
  assert.equal(complete, false);
  h.resolveRoom();
  assert.equal(await startup, h.state.instance);
});

test("E2E readiness and ticker stop occur after room initialization", { skip }, async () => {
  const h = await harness(true);
  const startup = h.start(); await flush();
  assert.equal(h.context.window.__YAGE_E2E__, undefined);
  assert.equal(h.state.stopped, false);
  h.resolveRoom(); await startup;
  assert.equal(h.context.window.__YAGE_E2E__.ready, true);
  assert.equal(h.state.stopped, true);
});

test("room initialization errors reject QuickStart", { skip }, async () => {
  const h = await harness(); const startup = h.start();
  const failure = assert.rejects(startup, /initialization failed/);
  await flush(); h.rejectRoom(new Error("initialization failed"));
  await failure;
});

test("a replay connection bootstraps the recorded seed, not the default", { skip }, async () => {
  const h = await harness();
  const connection = new h.HistoryConnection({ "recorded-room": { seed: "recorded-seed" } });
  const startup = h.quickStart({
    gameName: "test", connection, onPlayerJoin: () => 1, preload: async () => {},
  });
  await flush();
  assert.equal(h.state.initializeRoomArgs?.[1], "recorded-seed");
  h.resolveRoom();
  await startup;
});
