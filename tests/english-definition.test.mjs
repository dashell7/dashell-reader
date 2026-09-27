import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { transform } from "esbuild";

const source = fs.readFileSync(new URL("../src/learning/vendor/views/english-definition.ts", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "ts", format: "esm" });
const { fetchEnglishDefinitions } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

test("English hover lookup returns definitions rather than the translated word", async () => {
  const requested = [];
  const result = await fetchEnglishDefinitions("produce", async ({ url }) => {
    requested.push(url);
    return { json: [{ word: "produce", defs: [
      "v\tTo bring forth or make something.",
      "n\tFarm products offered for sale.",
    ] }] };
  });
  assert.deepEqual(result, ["v. To bring forth or make something.", "n. Farm products offered for sale."]);
  assert.equal(requested.length, 1);
  assert.match(requested[0], /api\.datamuse\.com/);
});

test("English hover lookup rejects approximate matches and uses a dictionary fallback", async () => {
  const requested = [];
  const result = await fetchEnglishDefinitions("produce", async ({ url }) => {
    requested.push(url);
    if (url.includes("datamuse")) return { json: [{ word: "product", defs: ["n\tSomething made."] }] };
    return { json: [{ meanings: [{ definitions: [{ definition: "To create or manufacture." }] }] }] };
  });
  assert.deepEqual(result, ["To create or manufacture."]);
  assert.equal(requested.length, 2);
});

test("English hover lookup never presents the source word as its definition", async () => {
  const result = await fetchEnglishDefinitions("produce", async ({ url }) => {
    if (url.includes("datamuse")) throw new Error("unavailable");
    return { json: [{ meanings: [{ definitions: [{ definition: "produce" }] }] }] };
  });
  assert.deepEqual(result, []);
});
