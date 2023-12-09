export function clone(object: any): any {
  try {
    return JSON.parse(JSON.stringify(object));
  } catch (e) {
    console.log(object);
    throw e;
  }
}
