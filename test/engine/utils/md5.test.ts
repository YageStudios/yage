import { test, expect } from "vitest";
import { md5 } from "yage/utils/md5";

// RFC 1321 test vectors.
const RFC_1321_VECTORS: [string, string][] = [
  ["", "d41d8cd98f00b204e9800998ecf8427e"],
  ["a", "0cc175b9c0f1b6a831c399e269772661"],
  ["abc", "900150983cd24fb0d6963f7d28e17f72"],
  ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
];

test.each(RFC_1321_VECTORS)("md5 matches RFC 1321 for %j", (input, expected) => {
  expect(md5(input)).toBe(expected);
});

// The digest must be MD5 over the UTF-8 bytes: game state routinely carries
// non-ASCII (player names, descriptions) and those hashes are compared
// against external tooling and recorded replays.
const NON_ASCII_VECTORS: [string, string][] = [
  ["héllo", "be50e8478cf24ff3595bc7307fb91b50"],
  ["日本語", "00110af8b4393ef3f72c50be5b332bec"],
  ["emoji😀", "fab64303b479f137f770351735fe7cbc"],
];

test.each(NON_ASCII_VECTORS)("md5 matches reference MD5 for non-ASCII %j", (input, expected) => {
  expect(md5(input)).toBe(expected);
});

test("md5 is deterministic for the same input", () => {
  expect(md5("lockstep-state-123")).toBe(md5("lockstep-state-123"));
});
