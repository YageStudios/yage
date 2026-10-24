import { Component, defaultValue, DrawSystemImpl, Schema, System, type, type World } from "minecs";
import { describe, expect, test } from "vitest";
import { compileEntityDefinition } from "yage/entity/definitions";
import { createLeanGameModel } from "yage/game/LeanGameModel";
import { clearTransients, spawnTransient, Transient, TransientCleanup, transientsOf } from "yage/world/transient";

@Component("TransientTestNote")
class Note extends Schema {
  @type("string") @defaultValue("") text: string;
}

const note = compileEntityDefinition({ name: "test:note", components: [{ type: "TransientTestNote" }] });

/** Reads this frame's notes, in spawn order. */
@System(Note)
class NoteReader extends DrawSystemImpl<World> {
  static depth = 10;
  static runEmpty = true;
  seen: string[][] = [];
  runAll(world: World) {
    this.seen.push(transientsOf(world, Note).map((eid) => (world(Note, eid) as Note).text));
  }
}

const make = () => createLeanGameModel({ world: { components: [Note, Transient], systems: [NoteReader, TransientCleanup] } });

describe("transient entities", () => {
  test("seen by every system that frame, gone after it", () => {
    const model = make();
    spawnTransient(model, note, { overrides: { TransientTestNote: { text: "a" } } });
    spawnTransient(model, note, { overrides: { TransientTestNote: { text: "b" } } });
    model.run();
    model.run();
    expect(model.getSystem(NoteReader).seen).toEqual([["a", "b"], []]);
    expect([...model.getComponentActives(Transient)]).toEqual([]);
    model.destroy();
  });

  test("spawn order survives entity reuse", () => {
    const model = make();
    for (const text of ["x", "y", "z"]) spawnTransient(model, note, { overrides: { TransientTestNote: { text } } });
    model.run();
    // The freed ids come back in a different order; transientsOf still reads spawn order.
    for (const text of ["c", "d", "e", "f"]) spawnTransient(model, note, { overrides: { TransientTestNote: { text } } });
    model.run();
    expect(model.getSystem(NoteReader).seen).toEqual([["x", "y", "z"], ["c", "d", "e", "f"]]);
    model.destroy();
  });

  test("a world that only steps clears them itself; other entities stay", () => {
    const model = make();
    const kept = note.spawn(model);
    spawnTransient(model, note);
    clearTransients(model);
    expect([...model.getComponentActives(Note)]).toEqual([kept]);
    model.destroy();
  });
});
