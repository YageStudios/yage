const steMemo: { [enumToCheck: string]: { [key: string]: any } } = {};

export const StringToEnum = <T>(rep: number | string | undefined, enumToCheck: any): T | undefined => {
  if (rep === undefined) {
    return undefined;
  }
  if (typeof rep === "string") {
    if (steMemo[enumToCheck.name]?.[rep] !== undefined) {
      return steMemo[enumToCheck.name][rep];
    }
    for (const [key, value] of Object.entries(enumToCheck)) {
      if (key.toLowerCase() === rep.toLowerCase()) {
        steMemo[enumToCheck.name] = steMemo[enumToCheck.name] || {};
        steMemo[enumToCheck.name][rep] = value;
        rep = value as number;
        break;
      }
    }
  }
  return rep as unknown as T;
};

export const EnumToString = (rep: number, enumToCheck: any): string | undefined => {
  for (const [key, value] of Object.entries(enumToCheck)) {
    if (value === rep) {
      return key;
    }
  }
  return undefined;
};

export type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = Pick<T, Exclude<keyof T, Keys>> &
  {
    [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>;
  }[Keys];
