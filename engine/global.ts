export const assignGlobalSingleton = (name: string, value: () => any) => {
  // @ts-ignore
  const __YAGE__ = window.__YAGE__ ?? {};
  if (!__YAGE__[name]) {
    __YAGE__[name] = value();
  }
  // @ts-ignore
  window.__YAGE__ = __YAGE__;
  return __YAGE__[name];
};

export const setGlobalSingleton = (name: string, value: any) => {
  // @ts-ignore
  const __YAGE__ = window.__YAGE__ ?? {};
  __YAGE__[name] = value;
  // @ts-ignore
  window.__YAGE__ = __YAGE__;
  return __YAGE__[name];
};

export const getGlobalSingleton = (name: string) => {
  // @ts-ignore
  return window.__YAGE__[name];
};
