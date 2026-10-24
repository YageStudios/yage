import { Component, Schema, addComponent, addEntity, createWorld, defaultValue, deleteWorld, nullable, type } from "minecs";
import { describe, expect, test } from "vitest";
import { createLeanGameModel } from "yage/game/LeanGameModel";
import { assertNoNullableTypedColumns, nullableTypedColumns } from "yage/world/columns";
import { initializeWorldContext, leanWorldType } from "yage/world/lean";

@Component("ColumnsNullableNumber")
class NullableNumber extends Schema {
  @nullable() @type("number") pinned: number | null;
  @type("number") @defaultValue(0) tick: number;
}
@Component("ColumnsNullableFlag")
class NullableFlag extends Schema {
  @type("boolean") @nullable() on: boolean | null;
}
@Component("ColumnsNullableSlots")
class NullableSlots extends Schema {
  @type("Entity") @nullable() parent: number | null;
  @nullable() @type("string") season: string | null;
  @nullable() @type(["number"]) corners: number[] | null;
  @nullable() @type("object") buffer: Uint8Array | null;
}

describe("nullable typed columns", () => {
  test("a null written to a typed number column reads back as 0, which is why yage refuses it", () => {
    const world = createWorld(4, { components: [NullableNumber], systems: [] });
    const entity = addEntity(world);
    addComponent(world, NullableNumber, entity, { pinned: null });
    expect(world(NullableNumber, entity).pinned).toBe(0);
    deleteWorld(world);
  });

  test("names every nullable number or boolean column, and none of the plain-slot kinds", () => {
    expect(nullableTypedColumns([NullableNumber, NullableFlag, NullableSlots])).toEqual(["ColumnsNullableNumber.pinned", "ColumnsNullableFlag.on"]);
    expect(() => assertNoNullableTypedColumns([NullableSlots], "here")).not.toThrow();
    expect(() => assertNoNullableTypedColumns([NullableNumber, NullableFlag], "here")).toThrow(
      /here: @nullable\(\) on a typed number\/boolean column stores null as 0 in ColumnsNullableNumber\.pinned, ColumnsNullableFlag\.on/,
    );
  });

  test("lean world types and world contexts refuse them when they register the schema", () => {
    expect(() => leanWorldType({ components: [NullableNumber] })).toThrow(/yage lean world: .*ColumnsNullableNumber\.pinned/);
    const slots = leanWorldType({ components: [NullableSlots] }).create();
    expect(() => initializeWorldContext(slots, { components: [NullableFlag] })).toThrow(/yage world context: .*ColumnsNullableFlag\.on/);
  });

  test("entity, string, array and object slots keep null apart from zero", () => {
    const model = createLeanGameModel({ world: leanWorldType({ components: [NullableSlots] }) });
    const entity = model.addEntity();
    model.addComponent(NullableSlots, entity, { parent: null, season: null, corners: null, buffer: null });
    expect(model.getTypedUnsafe(NullableSlots, entity)).toMatchObject({ parent: null, season: null, corners: null, buffer: null });
    model.destroy();
  });
});
