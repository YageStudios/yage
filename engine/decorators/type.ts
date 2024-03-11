import Ajv from "ajv";
import { clone } from "@/utils/clone";

import * as bitecs from "bitecs";

import { StringToEnum } from "@/utils/typehelpers";
import { ComponentCategory } from "@/constants/enums";
import { assignGlobalSingleton } from "@/global";

export class Schema {
  constructor(args?: any) {
    // @ts-ignore
    if (this.constructor.__constructables) {
      // @ts-ignore
      Object.entries(this.constructor.__constructables).forEach(
        // @ts-ignore
        ([key, Constructor]: [string, typeof Schema]) => {
          // @ts-ignore
          if (Array.isArray(this[key])) {
            // @ts-ignore
            this[key] = this[key].map((x) => new Constructor(x));
            // @ts-ignore
          } else if (this[key] !== undefined) {
            // @ts-ignore
            this[key] = new Constructor(this[key]);
          }
        }
      );
    }
  }

  toJSON?() {
    const data: { [key: string]: any } = {};
    Object.entries(this).forEach(([key, value]) => {
      if (typeof value === "object" && value?.toJSON) {
        data[key] = value.toJSON();
      } else {
        data[key] = value;
      }
    });
    return data;
  }
}

export class BitecsSchema extends Schema {
  static store: any;
  static id: number;
  static encode(ids: number[], snapshot = false) {
    // @ts-ignore
    const bitecsKeys = Object.keys(this.__bitecs).filter((x) => !x.startsWith("_"));
    let size = 4;
    let entityCount = 0;

    for (let i = 0; i < ids.length; ++i) {
      if (this.store.__changes[ids[i]]) {
        size += 4;
        const change = this.store.__changes[ids[i]];
        if (change) {
          entityCount++;
          for (let j = 0; j < bitecsKeys.length; j++) {
            if (snapshot) {
              this.store.__changes[ids[i]] |= 1 << j;
            }
            if (change & (1 << j) || snapshot) {
              size += 4;
            }
          }
        }
      }
    }
    const buffer = new ArrayBuffer(size);
    let offset = 0;
    const componentIdSlot = new Uint16Array(buffer, offset, 1);
    // @ts-ignore
    componentIdSlot[0] = this.__id;

    offset += 2;
    const entityCountSlot = new Uint16Array(buffer, offset, 1);
    entityCountSlot[0] = entityCount;
    offset += 2;

    for (let i = 0; i < ids.length; ++i) {
      if (this.store.__changes[ids[i]]) {
        const idSlot = new Uint16Array(buffer, offset, 1);
        idSlot[0] = ids[i];
        offset += 2;
        const changeSlot = new Uint16Array(buffer, offset, 1);
        changeSlot[0] = this.store.__changes[ids[i]];
        offset += 2;

        const change = this.store.__changes[ids[i]];
        this.store.__changes[ids[i]] = 0;
        for (let j = 0; j < bitecsKeys.length; j++) {
          if (change & (1 << j)) {
            let valueSlot;
            // @ts-ignore
            const bitecsType = this.__bitecs[bitecsKeys[j]];
            switch (bitecsType) {
              case "ui8":
              case "ui16":
              case "ui32":
                valueSlot = new Uint32Array(buffer, offset, 1);
                break;
              case "i8":
              case "i16":
              case "i32":
                valueSlot = new Int32Array(buffer, offset, 1);
                break;
              case "f32":
                valueSlot = new Float32Array(buffer, offset, 1);
                break;
              default:
                throw new Error("Incompatible bitecs type" + bitecsType);
            }
            valueSlot[0] = this.store[bitecsKeys[j]][ids[i]];
            offset += 4;
          }
        }
      }
    }

    return buffer;
  }

  static decode(buffer: ArrayBuffer) {
    let offset = 2;
    const entityCountSlot = new Uint16Array(buffer, offset, 1);
    offset += 2;
    const entityCount = entityCountSlot[0];

    for (let i = 0; i < entityCount; ++i) {
      const idSlot = new Uint16Array(buffer, offset, 1);
      const id = idSlot[0];
      offset += 2;
      const changeSlot = new Uint16Array(buffer, offset, 1);
      const change = changeSlot[0];
      offset += 2;
      // @ts-ignore
      const bitecsKeys = Object.keys(this.__bitecs).filter((x) => !x.startsWith("_"));
      for (let j = 0; j < bitecsKeys.length; j++) {
        if (change & (1 << j)) {
          let valueSlot;
          // @ts-ignore
          const bitecsType = this.__bitecs[bitecsKeys[j]];
          switch (bitecsType) {
            case "ui8":
            case "ui16":
            case "ui32":
              valueSlot = new Uint32Array(buffer, offset, 1);
              break;
            case "i8":
            case "i16":
            case "i32":
              valueSlot = new Int32Array(buffer, offset, 1);
              break;
            case "f32":
              valueSlot = new Float32Array(buffer, offset, 1);
              break;
            default:
              throw new Error("Incompatible bitecs type" + bitecsType);
          }
          // @ts-ignore
          this.store[bitecsKeys[j]][id] = valueSlot[0];
          offset += 4;
        }
      }
    }
  }
}

export class TypeSchema extends Schema {
  type!: string;
}

export const componentStringSchema = assignGlobalSingleton(
  "componentStringSchema",
  () => new Map<string, typeof Schema>()
);
export const componentIdSchema = assignGlobalSingleton("componentIdSchema", () => new Map<number, typeof Schema>());
export const componentSchemaString = assignGlobalSingleton(
  "componentSchemaString",
  () => new Map<typeof Schema, string>()
);

export const syncableComponents = assignGlobalSingleton(
  "syncableComponents",
  () =>
    new Set<{
      schema: typeof Schema;
      ind: number;
    }>()
);
export const bitecsComponents = assignGlobalSingleton("bitecsComponents", () => new Set<typeof Schema>());

export function Component(name: string, category: ComponentCategory = ComponentCategory.NONE) {
  return function (cls: any) {
    if (!cls.__category) {
      if (typeof category === "string") {
        cls.__category = StringToEnum(category, ComponentCategory) ?? ComponentCategory.NONE;
      } else {
        cls.__category = category;
      }
    }

    if (componentStringSchema.has(name)) {
      const existingSchema = componentStringSchema.get(name);
      cls.__schema = existingSchema.__schema;
      cls.__id = existingSchema.__id;
      cls.__type = existingSchema.__type;
      cls.__validate = existingSchema.__validate;
      componentSchemaString.set(cls, name);
      componentStringSchema.set(name, cls);

      return;
    }

    if (!cls.__schema) {
      cls.__schema = false;
      componentSchemaString.set(cls, name);
      componentStringSchema.set(name, cls);
      cls.__id = componentSchemaString.size;
      cls.__type = name;
      cls.__validate = () => true;
      componentIdSchema.set(cls.__id, cls);
      return;
    }
    generateSchema({ constructor: cls }).setType("type", "string");
    componentSchemaString.set(cls, name);
    componentStringSchema.set(name, cls);
    cls.__id = componentSchemaString.size;
    cls.__type = name;
    componentIdSchema.set(cls.__id, cls);

    try {
      // @ts-ignore
      const validate = ajv.compile(cls.__schema);
      // @ts-ignore
      cls.__validate = validate;
    } catch (e) {
      console.error(e);
      console.error(cls.__schema);
      throw e;
    }
  };
}

export function Bitecs() {
  return function (cls: any) {
    bitecsComponents.add(cls);
    cls.__bitecs.__changes = "ui32";
    const type = cls.__type;
    cls.store = assignGlobalSingleton(type + "bitec_store", () => bitecs.defineComponent(cls.__bitecs, 0));
  };
}

export type PrimitiveType =
  | "string"
  | "number"
  | "boolean"
  | "int8"
  | "uint8"
  | "int16"
  | "uint16"
  | "int32"
  | "uint32"
  | "int64"
  | "uint64"
  | "float32"
  | "float64"
  | typeof Schema;

const altNumberTypes = ["int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"];
const simpleToBitecs = {
  int8: bitecs.Types.i8,
  uint8: bitecs.Types.ui8,
  int16: bitecs.Types.i16,
  uint16: bitecs.Types.ui16,
  int32: bitecs.Types.i32,
  uint32: bitecs.Types.ui32,
  float32: bitecs.Types.f32,
  float64: bitecs.Types.f64,
};
const convertToBitecs = (value: string) => {
  // @ts-ignore
  return simpleToBitecs[value];
};
const ajv = new Ajv({ useDefaults: true, strict: false, allErrors: true });

const generateSchema = (target: any) => {
  if (target.constructor.__schema && target.constructor.__schema.$comment !== target.constructor.name) {
    target.constructor.__schema = clone(target.constructor.__schema);
    target.constructor.__schema.$comment = target.constructor.name;
    target.constructor.compileDebounce = null;
  } else {
    target.constructor.__schema = target.constructor.__schema || {
      type: "object",
      additionalProperties: false,
      $comment: target.constructor.name,
    };
  }
  target.constructor.__schema.properties = target.constructor.__schema.properties || {};
  target.constructor.__schema.required = target.constructor.__schema.required || [];

  return {
    setEnum: (propertyKey: string, enumToCheck: any) => {
      if (!target.constructor.__schema.properties[propertyKey]) {
        target.constructor.__schema.properties[propertyKey] = {
          type: "number",
        };
      }
      target.constructor.__schema.properties[propertyKey].enum = [];
      target.constructor.__schema.properties[propertyKey].options = {
        enum_titles: [],
      };

      for (const [key, value] of Object.entries(enumToCheck)) {
        if (typeof value === "number") {
          target.constructor.__schema.properties[propertyKey].options.enum_titles.push(key);
          target.constructor.__schema.properties[propertyKey].enum.push(value);
        }
      }
    },
    setDefault: (key: string, value: any) => {
      target.constructor.__schema.properties[key] = {
        ...(target.constructor.__schema.properties[key] ?? {
          type: typeof value,
        }),
        default: value,
      };
    },
    setRequired: (key: string) => {
      if (!target.constructor.__schema.required.includes(key)) {
        target.constructor.__schema.required.push(key);
      }
    },
    setType: (key: string, type: string) => {
      const prevType = target.constructor.__schema.properties[key]?.type;
      let setType: any = altNumberTypes.includes(type) ? "number" : type;
      if (prevType && prevType !== type) {
        if (Array.isArray(prevType)) {
          setType = prevType.concat(type);
        } else {
          setType = [prevType, setType];
        }
      }

      target.constructor.__schema.properties[key] = {
        ...(target.constructor.__schema.properties[key] ?? {}),
        type: setType,
      };
    },
    setArrayType: function (key: string, type: any) {
      if (typeof type !== "string") {
        target.constructor.__constructables = target.constructor.__constructables || {};
        target.constructor.__constructables[key] = type;
      }

      if (typeof type === "string") {
        target.constructor.__schema.properties[key] = {
          ...(target.constructor.__schema.properties[key] ?? {}),
          type: "array",
          items: {
            type: altNumberTypes.includes(type) ? "number" : type,
          },
        };
      } else {
        target.constructor.__schema.properties[key] = {
          ...(target.constructor.__schema.properties[key] ?? {}),
          type: "array",
          items: {
            type: "object",
            properties: type.__schema.properties,
            required: type.__schema.required,
            additionalProperties: false,
          },
        };
      }
    },
    setObjectType: (key: string, type: any) => {
      target.constructor.__constructables = target.constructor.__constructables || {};
      target.constructor.__constructables[key] = type;

      target.constructor.__schema.properties[key] = {
        ...(target.constructor.__schema.properties[key] ?? {}),
        type: "object",
        properties: type.__schema.properties,
        required: type.__schema.required,
        additionalProperties: false,
      };
    },
    setMapType: (key: string, type: any) => {
      target.constructor.__schema.properties[key] = {
        ...(target.constructor.__schema.properties[key] ?? {}),
        type: "object",
        patternProperties: {
          ".*":
            typeof type === "string"
              ? { type: altNumberTypes.includes(type) ? "number" : type }
              : {
                  type: "object",
                  properties: type.__schema.properties,
                  required: type.__schema.required,
                  additionalProperties: false,
                },
        },
        properties: undefined,
        required: undefined,
        additionalProperties: false,
      };
      delete target.constructor.__schema.properties[key].properties;
      delete target.constructor.__schema.properties[key].required;
    },
  };
};

const isRecord = (value: any): value is Record<string | number, string | number> => {
  if (typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  const numberKeys = keys.filter((key) => !isNaN(Number(key)));
  const stringKeys = keys.filter((key) => isNaN(Number(key)));
  return numberKeys.length === stringKeys.length;
};

export function type(
  type:
    | "Entity"
    | "EntityArray"
    | PrimitiveType
    | "object"
    | typeof Schema
    | any[]
    | Record<string | number, string | number>
    | {
        set: PrimitiveType;
      }
) {
  return function (target: any, key: string) {
    if (typeof key === "string" && key.startsWith("_")) {
      key = key.substring(1);
    }
    const schema = generateSchema(target);

    if (isRecord(type)) {
      target.constructor.__bitecs = target.constructor.__bitecs || {};
      target.constructor.__bitecs[key] = convertToBitecs("uint8");

      schema.setType(key, "number");
      schema.setEnum(key, type);
    } else if (type === "Entity" || type === "EntityArray" || (Array.isArray(type) && type[0] === "Entity")) {
      if (type === "Entity") {
        schema.setType(key, "number");
      } else {
        schema.setArrayType(key, "number");
      }
      target.constructor.__entityTypes = target.constructor.__entityTypes || {};
      target.constructor.__entityTypes[key] = type;
    } else if (Array.isArray(type)) {
      schema.setArrayType(key, type[0]);
    } else if (typeof type === "object" && type?.set) {
      schema.setArrayType(key, type.set);
    } else if (typeof type === "function") {
      schema.setObjectType(key, type);
    } else {
      target.constructor.__bitecs = target.constructor.__bitecs || {};
      target.constructor.__bitecs[key] = convertToBitecs(type as string);
      // @ts-ignore
      schema.setType(key, altNumberTypes.includes(type) ? "number" : type);
    }
  };
}

export function defaultValue(value: any) {
  return function (target: any, key: string) {
    const schema = generateSchema(target);
    if (typeof key === "string" && key.startsWith("_")) {
      key = key.substring(1);
    }
    schema.setDefault(key, value);
    if (typeof key === "string") {
      schema.setRequired(key);
    }
  };
}

export function required() {
  return function (target: any, key: string) {
    generateSchema(target).setRequired(key);
  };
}

export function Enum(enumToCheck: any) {
  return function (target: any, key: string) {
    generateSchema(target).setEnum(key, enumToCheck);
  };
}

export function mapType(type: any) {
  return function (target: any, key: string) {
    generateSchema(target).setMapType(key, type);
  };
}

export function nullable() {
  return function (target: any, key: string) {
    generateSchema(target).setType(key, "null");
  };
}
