import { registerSchema } from "@/components/ComponentRegistry";
import { ComponentCategory } from "@/components/types";
import type { Schema } from "@/decorators/type";

const schemas = import.meta.glob("../schemas/**/*.ts", { eager: true });

const exports: {
  [key: string]: typeof Schema;
} = {};

for (const schemaImport of Object.values(schemas)) {
  const schema = schemaImport as unknown as { [key: string]: typeof Schema };

  const keys = Object.keys(schema);

  keys.forEach((key) => {
    if (typeof schema[key] !== "function") {
      throw new Error(`Schema ${key} is not a function`);
    }
    // @ts-ignore
    if (schema[key].__category === undefined) {
      registerSchema(ComponentCategory.NONE, schema[key]);
    } else {
      // @ts-ignore
      registerSchema(schema[key].__category, schema[key]);
    }
  });
}

export default exports;
