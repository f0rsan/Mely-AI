import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "vitest";

test("index.html links a favicon asset that exists", () => {
  const root = resolve(__dirname, "..");
  const html = readFileSync(resolve(root, "index.html"), "utf8");

  expect(html).toContain('href="/favicon.ico"');
  expect(existsSync(resolve(root, "public", "favicon.ico"))).toBe(true);
});
