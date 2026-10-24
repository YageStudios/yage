/**
 * minecs stores @type("number"/"boolean"/int/float) fields in typed-array columns. @nullable() only
 * adds "null" to the JSON schema, so a null written to such a column reads back as 0 (or false).
 * That silently changes behaviour, so yage refuses those schemas when a world registers them.
 * Keep a flag plus a value, or a sentinel the readers check. Entity, string, object and array
 * fields are plain per-entity slots and hold null fine.
 */
import type { Schema } from "minecs";

type Columns = { type?: string; primativesSchema?: Record<string, unknown>; schema?: { properties?: Record<string, { type?: unknown }> } };

/** The `Component.field` names whose nullable values a typed column would store as 0. */
export const nullableTypedColumns = (components: Iterable<typeof Schema>): string[] => {
  const found: string[] = [];
  for (const component of components) {
    const { type, primativesSchema, schema } = component as unknown as Columns;
    for (const key of Object.keys(primativesSchema ?? {})) {
      const declared = schema?.properties?.[key]?.type;
      if (declared === "null" || (Array.isArray(declared) && declared.includes("null"))) found.push(`${type ?? component.name}.${key}`);
    }
  }
  return found;
};

/** Throws naming every nullable field that sits in a typed column. */
export const assertNoNullableTypedColumns = (components: Iterable<typeof Schema>, where: string): void => {
  const found = nullableTypedColumns(components);
  if (found.length) {
    throw new Error(
      `${where}: @nullable() on a typed number/boolean column stores null as 0 in ${found.join(", ")}. ` +
        "Keep a flag plus a value, or a sentinel the readers check.",
    );
  }
};
