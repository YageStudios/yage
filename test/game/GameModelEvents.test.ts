import { test, expect } from "vitest";
import { createWorld } from "minecs";
import { GameModel } from "yage/game/GameModel";
import { InputManager } from "yage/inputs/InputManager";
import { PlayerEventManager } from "yage/inputs/PlayerEventManager";

// Lockstep peers must serialize the same event data identically. Object key
// insertion order is an implementation detail of the code that built the
// object, so the wire format must not depend on it.
test("event serialization does not depend on object key order", () => {
  const eventsA = new PlayerEventManager();
  const eventsB = new PlayerEventManager();
  const a = GameModel({
    seed: "events",
    roomId: "room",
    world: createWorld(),
    inputManager: new InputManager(),
    playerEventManager: eventsA,
  });
  const b = GameModel({
    seed: "events",
    roomId: "room",
    world: createWorld(),
    inputManager: new InputManager(),
    playerEventManager: eventsB,
  });

  a.event("player-1", "hit", { target: 3, amount: 10, crit: true });
  b.event("player-1", "hit", { crit: true, amount: 10, target: 3 });

  expect(eventsB.getEvents("player-1")).toEqual(eventsA.getEvents("player-1"));
});

test("nested object key order does not leak into event serialization", () => {
  const eventsA = new PlayerEventManager();
  const eventsB = new PlayerEventManager();
  const a = GameModel({
    seed: "events",
    roomId: "room",
    world: createWorld(),
    inputManager: new InputManager(),
    playerEventManager: eventsA,
  });
  const b = GameModel({
    seed: "events",
    roomId: "room",
    world: createWorld(),
    inputManager: new InputManager(),
    playerEventManager: eventsB,
  });

  a.event("player-1", "spawn", { at: { x: 1, y: 2 }, kind: "goblin" });
  b.event("player-1", "spawn", { kind: "goblin", at: { y: 2, x: 1 } });

  expect(eventsB.getEvents("player-1")).toEqual(eventsA.getEvents("player-1"));
});
