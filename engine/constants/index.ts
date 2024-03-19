import { assignGlobalSingleton } from "@/global";
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
