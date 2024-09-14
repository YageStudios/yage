/* eslint-disable @typescript-eslint/ban-types */
import { assignGlobalSingleton } from "yage/global";
import * as baseEnums from "./enums";

const enums: { [enumName: string]: Object } = assignGlobalSingleton("enums", () => ({
  ...baseEnums,
}));

export const addEnums = (enumsToRegister: { [name: string]: Object }) => {
  for (const name in enumsToRegister) {
    enums[name] = enumsToRegister[name];
  }
};

export const getEnum = (name: string) => {
  return enums[name];
};

export const WORLD_WIDTH = 1000000;
export const HALF_WORLD_WIDTH = WORLD_WIDTH / 2;
