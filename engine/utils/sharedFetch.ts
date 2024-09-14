/* eslint-disable @typescript-eslint/no-var-requires */
const nodeFetch = async (url: string) => {
  // @ts-ignore
  const fs = require("fs").promises;
  // @ts-ignore
  const path = require("path");
  const filePath = path.join("public", url);
  const data = (await fs.readFile(filePath, "utf8")) as string;
  return {
    json: () => JSON.parse(data),
    text: () => data,
  };
};

export default typeof window === "undefined" ? nodeFetch : fetch;
