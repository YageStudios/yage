export const safeForLoop = (arr: any[], callback: (item: any, index: number) => any | void) => {
  let arrLen = arr.length;
  for (let i = 0; i < arr.length; i++) {
    callback(arr[i], i);
    if (arrLen !== arr.length) {
      i--;
      arrLen = arr.length;
    }
  }
};
