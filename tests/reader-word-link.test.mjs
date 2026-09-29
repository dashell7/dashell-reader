import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { compileFunction } from "node:vm";
import test from "node:test";
import * as yaml from "js-yaml";
import ts from "typescript";
import { highlightBacklink } from "../src/highlight-navigation.js";

const cache = new Map();
function loadTs(path) {
  if (cache.has(path)) return cache.get(path);
  const source = readFileSync(path, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  cache.set(path, exports);
  const require = (name) => name === "obsidian"
    ? { parseYaml: yaml.load, stringifyYaml: yaml.dump }
    : loadTs(resolve(dirname(path), `${name}.ts`));
  compileFunction(code, ["exports", "require", "URL"])(exports, require, URL);
  return exports;
}

const utils = resolve("src/learning/vendor/utils");
const { normalizeReaderLink } = loadTs(resolve(utils, "readerLink.ts"));
const { mergeWordNote, readWordNote } = loadTs(resolve(utils, "wordNoteFormat.ts"));

test("reader link survives a vocabulary note save and reopening without changing the origin", () => {
  const link = highlightBacklink("English 库", "Books/Alice & Wonderland.epub", {
    cfi: "epubcfi(/6/30!/4/26,/1:3,/1:7)",
  });
  const record = { expression: "bill", meaning: "比尔", status: 1, t: "WORD", tags: [], notes: [], aliases: [],
    date: Date.now(), sentences: [{ text: "The Rabbit Sends in a Little Bill.", trans: "", origin: "Alice", readerLink: link }] };
  const written = mergeWordNote("My personal note stays here.\n", record, "en");
  assert.match(written, /langr_reader_link1:/);
  assert.ok(written.endsWith("My personal note stays here.\n"));
  const reopened = readWordNote(written, "en", "vocab/bill.md", Date.now());
  assert.equal(reopened.sentences[0].readerLink, link);
  assert.equal(reopened.sentences[0].origin, "Alice");
  const edited = mergeWordNote(written, { ...reopened, sentences: [{ ...reopened.sentences[0], trans: "小比尔" }] }, "en");
  assert.equal(readWordNote(edited, "en", "vocab/bill.md", Date.now()).sentences[0].readerLink, link);
  assert.ok(edited.endsWith("My personal note stays here.\n"));
});

test("reader links reject another protocol and malformed owned metadata blocks saving", () => {
  assert.throws(() => normalizeReaderLink("https://example.com/"), /Invalid reader link/);
  assert.throws(() => normalizeReaderLink("obsidian://qiaomu-reader-english?vault=V&book=book.epub"), /Invalid reader link/);
  const broken = "---\nexpression: bill\nlangr_reader_link2: 'javascript:alert(1)'\n---\nUser note\n";
  assert.throws(() => readWordNote(broken, "en", "vocab/bill.md", Date.now()), /Invalid reader link/);
  assert.equal(broken.includes("User note"), true);
});
