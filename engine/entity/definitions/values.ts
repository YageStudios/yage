import type { ValueContext } from "./types";

/** Hex "#rrggbb" (or "rrggbb") to 0xrrggbb; 0 when malformed. */
export const hexToRgbNumber = (hex: string): number => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? parseInt(result[1] + result[2] + result[3], 16) : 0;
};

/** Case-insensitive enum key lookup; returns the input when no key matches (as StringToEnum does). */
export const enumValue = (enumObject: Record<string, unknown> | undefined, key: string): unknown => {
  if (!enumObject) return key;
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(enumObject)) if (k.toLowerCase() === lower) return v;
  return key;
};

const requireRand = (ctx: ValueContext, value: string) => {
  if (!ctx.rand) throw new Error(`yage definitions: "${value}" needs a random source (ValueContext.rand)`);
  return ctx.rand;
};

const resolveEnum = (ctx: ValueContext, path: string): unknown => {
  const [enumName, key] = path.split(".");
  const enumObject = ctx.enums?.(enumName);
  if (!enumObject) throw new Error(`yage definitions: unknown enum "${enumName}" in "enum:${path}"`);
  return enumValue(enumObject, key ?? "");
};

const DYNAMIC_PREFIXES = ["rand:", "randint:", "randdzint:", "playercount:"];

/** Whether a string value differs per spawn (depends on the random source or player count). */
export const isDynamicValue = (value: string): boolean => DYNAMIC_PREFIXES.some((p) => value.startsWith(p));

/** Maps one string value. Non-prefixed strings come back unchanged. */
export const mapDefinitionString = (data: string, ctx: ValueContext): unknown => {
  if (data.startsWith("enum:")) return resolveEnum(ctx, data.substring(5));
  if (data.includes("::enum::")) {
    // "prefix::enum::Enum.Key" or "prefix::enum::Enum.Key::suffix"
    const [prefix, rest] = data.split("::enum::");
    const [path, ...suffix] = rest.split("::");
    return prefix + String(resolveEnum(ctx, path)) + suffix.join("::");
  }
  if (data.startsWith("rgb:")) return hexToRgbNumber(data.substring(4));
  if (data.startsWith("rand:")) {
    const randValue = requireRand(ctx, data).number();
    const [min, max] = data.substring(5).split(":");
    if (min) {
      if (max) return randValue * (parseInt(max) - parseInt(min)) + parseInt(min);
      return randValue * parseInt(min);
    }
    return randValue;
  }
  if (data.startsWith("randint:")) {
    const [min, max] = data.substring(8).split(":");
    return requireRand(ctx, data).int(parseInt(min), max ? parseInt(max) : undefined);
  }
  if (data.startsWith("randdzint:")) {
    const [min, max] = data.substring(10).split(":");
    const rand = requireRand(ctx, data);
    return rand.int(parseInt(min), max ? parseInt(max) : undefined) * (rand.number() > 0.5 ? 1 : -1);
  }
  if (data.startsWith("playercount:")) {
    const [multiplier] = data.substring(12).split(":");
    return Math.max(ctx.playerCount ?? 0, 0) * (multiplier ? parseInt(multiplier) : 1);
  }
  return data;
};

/**
 * Maps the special string values of a definition value in place (objects and arrays are walked;
 * object keys are mapped too). Returns the mapped value; pass a copy if the input must survive.
 *
 * - `rand:` / `rand:max` / `rand:min:max`: a float
 * - `randint:min[:max]`, `randdzint:min[:max]` (random sign): an int
 * - `enum:Enum.Key`, `prefix::enum::Enum.Key[::suffix]`: an enum value
 * - `rgb:#rrggbb`: 0xrrggbb
 * - `playercount:[multiplier]`
 */
export const mapDefinitionValues = (data: any, ctx: ValueContext = {}): any => {
  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) data[i] = mapDefinitionValues(data[i], ctx);
    return data;
  }
  if (data !== null && typeof data === "object") {
    for (const key of Object.keys(data)) {
      const mappedKey = String(mapDefinitionString(key, ctx));
      const value = mapDefinitionValues(data[key], ctx);
      if (mappedKey !== key) delete data[key];
      data[mappedKey] = value;
    }
    return data;
  }
  if (typeof data === "string") return mapDefinitionString(data, ctx);
  return data;
};

/** Whether anything inside `data` is a per-spawn value (see isDynamicValue). */
export const hasDynamicValues = (data: any): boolean => {
  if (typeof data === "string") return isDynamicValue(data);
  if (Array.isArray(data)) return data.some(hasDynamicValues);
  if (data !== null && typeof data === "object") {
    return Object.keys(data).some((k) => isDynamicValue(k) || hasDynamicValues(data[k]));
  }
  return false;
};
