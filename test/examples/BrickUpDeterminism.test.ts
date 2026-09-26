import { beforeAll, expect, test } from "vitest";
import JSON5 from "json5";
import { Graphics, Container, Application } from "pixi.js";
import { createWorld, serializeWorld, SerialMode } from "minecs";
import { cloneDeep } from "lodash";
import { GameModel } from "yage/game/GameModel";
import type { KeyMap } from "yage/inputs/InputManager";
import { InputManager } from "yage/inputs/InputManager";
import { PlayerEventManager } from "yage/inputs/PlayerEventManager";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { Transform } from "yage/schemas/entity/Transform";
import { EntityFactory } from "yage/entity/EntityFactory";
import type { FlexibleEntityDefinition } from "yage/entity/EntityFactory";
import { hashWorldState } from "yage/game/StateHash";
import { PhysicsSystem } from "yage/systems/physics/Physics";
import { enableRapierArena, getBoard, type PhysicsMode } from "../../examples/brickup/systems/BrickUpField";
import {
  paddleForSide,
} from "../../examples/brickup/systems/BrickUpPlayers";
import { BrickUpPaddle } from "../../examples/brickup/systems/BrickUpComponents";
import {
  fillAiPaddles,
  onObserverJoin,
  onPlayerJoin,
  onPlayerLeave,
  playerEntityForPid,
} from "../../examples/brickup/systems/BrickUpPlayers";
import { initRapier, setupRealPhysicsGlobals } from "../helpers/realPhysics";

// Both physics paths run here: the manual integrator needs nothing but the
// standard stubs, the Rapier path needs real WASM and a window-like global.
// minecs constructs every registered system at world creation, including
// draw systems whose constructors touch pixi and DOM listeners — headless,
// those only need to exist.
beforeAll(async () => {
  setupRealPhysicsGlobals();
  const graphicsPrototype = Graphics.prototype as unknown as Record<string, unknown>;
  graphicsPrototype.clear = () => {};
  graphicsPrototype.beginFill = () => {};
  graphicsPrototype.endFill = () => {};
  graphicsPrototype.lineStyle = () => {};
  graphicsPrototype.drawRect = () => {};
  graphicsPrototype.drawCircle = () => {};
  graphicsPrototype.drawEllipse = () => {};
  graphicsPrototype.drawPolygon = () => {};
  graphicsPrototype.position = { set: () => {} };
  (Container.prototype as unknown as Record<string, unknown>).destroy = () => {};
  (Application.prototype as unknown as Record<string, unknown>).stop = () => {};
  await initRapier();
  await import("../../examples/brickup/systems");
  EntityFactory.configureEntityFactory(loadEntityDefinitions());
});

// Raw-loading the template files works under both vitest (?raw glob) and the
// examples vite config, which parses the same files as json5 for the browser.
const rawTemplates = import.meta.glob("../../examples/brickup/entities/*.json5", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const loadEntityDefinitions = (): FlexibleEntityDefinition[] =>
  Object.values(rawTemplates).map((raw) => JSON5.parse(raw) as FlexibleEntityDefinition);

const SEED = "brickup-proof";
const ROOM = "brickup-proof";
const P1 = "p1";
const P2 = "p2";
const P3 = "p3";
const P4 = "p4";
const P5 = "p5";
const BOOT_PLAYERS = [P1, P2, P3, P4];

const makePeer = (mode: PhysicsMode = "manual") => {
  const peer = GameModel({
    seed: SEED,
    roomId: ROOM,
    world: createWorld(512),
    inputManager: new InputManager(),
    playerEventManager: new PlayerEventManager(),
  });
  if (mode === "rapier") {
    enableRapierArena(peer);
  }
  return peer;
};

const bootPeers = (mode: PhysicsMode, playerIds: string[] = BOOT_PLAYERS) => {
  const peers = [makePeer(mode), makePeer(mode), makePeer(mode), makePeer(mode)];
  for (const pid of playerIds) {
    for (const peer of peers) {
      onPlayerJoin(peer, pid);
    }
  }
  return peers;
};

// Square-wave drives so paddles sweep their full sides (including the
// extremes), with a per-player phase offset; a pure function of (pid, frame).
const phaseOf = (pid: string): number => {
  let hash = 0;
  for (let i = 0; i < pid.length; i++) {
    hash = (hash * 31 + pid.charCodeAt(i)) | 0;
  }
  return ((hash >>> 0) % 97) / 97;
};

const keysFor = (pid: string, frame: number): KeyMap => {
  const cycle = (frame + Math.floor(phaseOf(pid) * 384)) % 384;
  const keys = new Map<string, boolean>();
  keys.set("right", cycle < 96);
  keys.set("left", cycle >= 192 && cycle < 288);
  keys.set("down", cycle >= 96 && cycle < 192);
  keys.set("up", cycle >= 288);
  return keys;
};

const applyInputs = (peer: GameModel, pids: string[], frame: number) => {
  for (const pid of pids) {
    const player = playerEntityForPid(peer, pid);
    if (player === undefined) {
      continue;
    }
    const input = peer.getTypedUnsafe(PlayerInput, player);
    input.prevKeyMap = input.keyMap;
    input.keyMap = keysFor(pid, frame);
  }
};

const assertHashesEqual = (peers: GameModel[]) => {
  const hashes = peers.map((peer) => hashWorldState(peer));
  for (const hash of hashes) {
    expect(hash, "world digest diverged between peers").toBe(hashes[0]);
  }
};

// Component-level state equality: every peer serializes its ECS world to the
// exact same bytes. Rapier solver state is verified separately per test.
const assertComponentStatesEqual = (peers: GameModel[]) => {
  const snapshots = peers.map((peer) => JSON.stringify(serializeWorld(SerialMode.JSON, peer)));
  for (const snapshot of snapshots) {
    expect(snapshot, "serialized component state diverged between peers").toBe(snapshots[0]);
  }
};

// Steps every peer in lockstep, feeding the scripted inputs, and asserts
// digest equality every 60 frames.
const runLockstep = (peers: GameModel[], pids: string[], fromFrame: number, toFrame: number) => {
  for (let step = fromFrame + 1; step <= toFrame; step++) {
    for (const peer of peers) {
      applyInputs(peer, pids, step);
    }
    for (const peer of peers) {
      peer.step();
    }
    if (step % 60 === 0) {
      assertHashesEqual(peers);
    }
  }
};

const paddleCount = (peer: GameModel) => peer.getComponentActives("BrickUpPaddle").length;

// The full multiplayer scenario, run once per physics mode: 4 players, a
// rage-quit, a late join (via the host's state snapshot), another quit —
// with digest checks every 60 frames through every phase.
const runFullScenario = async (mode: PhysicsMode) => {
  const peers = bootPeers(mode);
  let pids = [...BOOT_PLAYERS];

  runLockstep(peers, pids, 0, 300);

  // Four human joins claimed all four sides, so the frame-1 AI fill had
  // nothing left to occupy.
  for (const peer of peers) {
    expect(paddleCount(peer)).toBe(4);
    for (let side = 0; side < 4; side++) {
      expect(peer.getTypedUnsafe(BrickUpPaddle, paddleForSide(peer, side)!).ownerPid).not.toBe("");
    }
  }

  // Frame 300: p4 rage-quits on every peer simultaneously — the paddle stays
  // on the field and reverts to AI control.
  for (const peer of peers) {
    onPlayerLeave(peer, P4);
  }
  pids = pids.filter((pid) => pid !== P4);
  for (const peer of peers) {
    expect(paddleCount(peer)).toBe(4);
    expect(peer.getTypedUnsafe(BrickUpPaddle, paddleForSide(peer, 3)!).ownerPid).toBe("");
  }
  assertHashesEqual(peers);

  runLockstep(peers, pids, 300, 420);

  // Frame 420: a late join. Existing peers spawn the player; the joining
  // peer boots fresh and converges from the host's state snapshot — exactly
  // what a mid-game join does over the wire.
  for (const peer of peers) {
    onPlayerJoin(peer, P5);
  }
  const latecomer = makePeer(mode);
  await latecomer.deserializeState(cloneDeep(peers[0].serializeState()));
  peers.push(latecomer);
  pids = [...pids, P5];

  assertHashesEqual(peers);
  assertComponentStatesEqual(peers);
  for (const peer of peers) {
    expect(paddleCount(peer)).toBe(4);
    // The late joiner took the freed side 3 over from the AI.
    expect(peer.getTypedUnsafe(BrickUpPaddle, paddleForSide(peer, 3)!).ownerPid).toBe(P5);
  }

  runLockstep(peers, pids, 420, 700);

  // Frame 700: p2 leaves the four-peer game; the AI takes their side over.
  for (const peer of peers) {
    onPlayerLeave(peer, P2);
  }
  pids = pids.filter((pid) => pid !== P2);
  for (const peer of peers) {
    expect(paddleCount(peer)).toBe(4);
    expect(peer.getTypedUnsafe(BrickUpPaddle, paddleForSide(peer, 1)!).ownerPid).toBe("");
  }
  assertHashesEqual(peers);

  runLockstep(peers, pids, 700, 960);
  assertComponentStatesEqual(peers);

  // The sim must have actually done something: bricks destroyed, upgrades
  // collected — otherwise the proof above would be vacuous.
  const board = getBoard(peers[0]);
  expect(board.physicsMode).toBe(mode);
  expect(board.score).toBeGreaterThan(0);
  expect(board.upgradesApplied).toBeGreaterThan(0);

  // Everyone stayed in the same game: same round counter, same score, same
  // upgrade history.
  for (const peer of peers) {
    const finalBoard = getBoard(peer);
    expect(finalBoard.round).toBe(board.round);
    expect(finalBoard.score).toBe(board.score);
    expect(finalBoard.upgradesApplied).toBe(board.upgradesApplied);
  }
};

test("manual physics: four peers stay bit-identical through a leave, a late join and another leave", async () => {
  await runFullScenario("manual");
});

test("rapier physics: four peers stay bit-identical through a leave, a late join and another leave", async () => {
  await runFullScenario("rapier");

  // The late joiner in the scenario above replayed from a snapshot that
  // bundles the Rapier solver snapshot; assert that bundle is present and
  // byte-identical across lockstep peers.
  const peers = bootPeers("rapier");
  runLockstep(peers, [...BOOT_PLAYERS], 0, 120);
  const states = peers.map((peer) => peer.serializeState());
  for (const state of states) {
    expect(state.physics).toBeDefined();
    expect(state.physics?.data).toBe(states[0].physics?.data);
  }
});

test("rapier physics without snapshot bundling: component-only rebuilds converge and stay in lockstep", async () => {
  // Three players so a side stays free for a no-bundle late join later.
  const pids = [P1, P2, P3];
  const source = bootPeers("rapier", pids);
  runLockstep(source, pids, 0, 480);

  // Playback WITHOUT the Rapier blob: strip the physics snapshot from the
  // state; the restored peers rebuild the solver purely from components
  // (positions from Transform, velocities from the velocityLock mirror).
  const stripped = cloneDeep(source[0].serializeState());
  expect(stripped.physics).toBeDefined();
  delete stripped.physics;

  const restored: GameModel[] = [];
  for (let i = 0; i < 4; i++) {
    const peer = makePeer("manual");
    await peer.deserializeState(cloneDeep(stripped));
    // deserializeState skips physics entirely when no blob is bundled, so
    // the solver world is initialized by hand; bodies then resurrect from
    // components during the next step.
    peer.getSystem(PhysicsSystem).init(peer, peer.coreEntity);
    restored.push(peer);
  }

  assertHashesEqual([...source, ...restored]);
  runLockstep([...source, ...restored], pids, 480, 600);
  assertComponentStatesEqual([...source, ...restored]);

  // Frame 600: a late join that also replays without a physics blob.
  for (const peer of [...source, ...restored]) {
    onPlayerJoin(peer, P4);
  }
  const joiner = makePeer("manual");
  const joinState = cloneDeep(source[0].serializeState());
  delete joinState.physics;
  await joiner.deserializeState(joinState);
  joiner.getSystem(PhysicsSystem).init(joiner, joiner.coreEntity);

  const everyone = [...source, ...restored, joiner];
  assertHashesEqual(everyone);
  runLockstep(everyone, [...pids, P4], 600, 720);
  assertComponentStatesEqual(everyone);

  // Every replayed peer ended up with a live solver of its own.
  for (const peer of [...restored, joiner]) {
    expect(peer.serializeState().physics).toBeDefined();
  }
});

test("a single human gets three AI players, and the AI plays deterministically", async () => {
  const peers = [makePeer("manual"), makePeer("manual"), makePeer("manual"), makePeer("manual")];
  for (const peer of peers) {
    onPlayerJoin(peer, P1);
  }

  // The frame-1 AI fill covers every side the humans did not claim.
  runLockstep(peers, [P1], 0, 2);
  for (const peer of peers) {
    expect(paddleCount(peer)).toBe(4);
    expect(peer.getTypedUnsafe(BrickUpPaddle, paddleForSide(peer, 0)!).ownerPid).toBe(P1);
    for (const side of [1, 2, 3]) {
      expect(peer.getTypedUnsafe(BrickUpPaddle, paddleForSide(peer, side)!).ownerPid).toBe("");
    }
  }

  // The AI actually plays: its paddles move, and identically on every peer.
  const aiAlong = (peer: GameModel, side: number) => {
    const transform = peer.getTypedUnsafe(Transform, paddleForSide(peer, side)!);
    return side === 0 || side === 1 ? transform.x : transform.y;
  };
  const before = aiAlong(peers[0], 1);
  runLockstep(peers, [P1], 2, 300);
  expect(aiAlong(peers[0], 1)).not.toBe(before);
  assertComponentStatesEqual(peers);
});

test("observer view: no paddle for the observer, four AI players, full lockstep", async () => {
  const peers = [makePeer("rapier"), makePeer("rapier"), makePeer("rapier"), makePeer("rapier")];
  for (const peer of peers) {
    onObserverJoin(peer, P1);
  }

  runLockstep(peers, [P1], 0, 360);
  for (const peer of peers) {
    expect(paddleCount(peer)).toBe(4);
    for (let side = 0; side < 4; side++) {
      expect(peer.getTypedUnsafe(BrickUpPaddle, paddleForSide(peer, side)!).ownerPid).toBe("");
    }
    expect(playerEntityForPid(peer, P1)).toBeDefined();
  }
  assertComponentStatesEqual(peers);

  const board = getBoard(peers[0]);
  expect(board.score).toBeGreaterThan(0);
});
