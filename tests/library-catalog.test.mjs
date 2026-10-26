import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { bookMetadata, catalogMetadata, bookMatches } from "../src/book-catalog.js";
import { sortLibrary, findDuplicateBook } from "../src/library-data.js";

const source = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
test("book metadata is bounded and keeps author, ISBN and source without credentials", () => {
  const metadata = bookMetadata({ title: "  中文书 🌱 ", author: [{ name: "An Author" }], identifier: "urn:isbn:9780306406157", language: ["zh", "en"], year: "2026", token: "secret", path: "device" });
  assert.deepEqual(metadata, { title: "中文书 🌱", author: "An Author", year: "2026", language: "zh, en", isbn: "9780306406157" });
  assert.equal(bookMatches({ basename: "unhelpful" }, metadata, "ＡＮ AUTHOR"), true);
  assert.equal(bookMatches({}, metadata, "9780306406157"), true);
  assert.equal(bookMetadata({ author: Array(100).fill("a".repeat(1000)) }).author.length, 1000);
});

test("bookshelf searches metadata and sorts by added time with a stable title fallback", () => {
  const start = source.indexOf("function filterLibBooks(");
  const filter = vm.runInNewContext(`${source.slice(start, source.indexOf("\n}", start) + 2)}; filterLibBooks`, { bookMatches });
  const files = [{ path: "one.epub", basename: "One" }, { path: "two.epub", basename: "Two" }];
  const imports = { "one.epub": { author: "Carroll", title: "Alice", addedAt: 20 }, "two.epub": { isbn: "9780306406157", addedAt: 30 } };
  assert.deepEqual(Array.from(filter(files, "all", "Carroll", "", () => null, () => [], path => imports[path])), [files[0]]);
  assert.equal(sortLibrary([...files], "added", "en", () => null, imports)[0], files[1]);
  assert.deepEqual(catalogMetadata({ calibreImports: { a: { path: "one.epub", title: "Calibre", author: "Carroll" } }, bookImports: { "one.epub": { title: "Alice" } } }, "one.epub"), { title: "Alice", author: "Carroll" });
});

test("same sized different books are kept and changed books invalidate cached hashes", async () => {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const file = { path: "book.epub", stat: { size: 3, mtime: 1 } }, records = {};
  let reads = 0;
  const read = async () => { reads++; return bytes; };
  assert.equal((await findDuplicateBook(bytes, [file], records, read, webcrypto)).duplicate, file);
  await findDuplicateBook(bytes, [file], records, read, webcrypto);
  assert.equal(reads, 1);
  file.stat.mtime = 2;
  assert.equal((await findDuplicateBook(new Uint8Array([3, 2, 1]).buffer, [file], records, read, webcrypto)).duplicate, null);
  assert.equal(reads, 2);
});

test("two import dialogs serialize identical content and retry after metadata save fails", async () => {
  const start = source.search(/  (?:async )?_importBooks\(incoming\) \{/);
  const end = source.indexOf("  _refresh() {", start);
  const Library = vm.runInNewContext(`class Library {${source.slice(start, end)}}; Library`, {
    BOOK_EXTENSIONS: new Set(["epub"]), IMPORT_MIME_EXT: new Map(), Notice: class {},
    qiaomuReaderTranslate: key => key, bookMetadata, findDuplicateBook: (...args) => findDuplicateBook(...args, webcrypto),
    readBookMetadata: async () => ({ title: "Alice", author: "Lewis Carroll" }), console: { warn() {} }, Date,
  });
  const files = [], records = {}, bytes = new Uint8Array([1, 2, 3]).buffer;
  let saveWorks = false, creates = 0;
  const plugin = { settings: { bookImports: records }, bookFiles: () => [],
    rememberTextBook: async () => {}, _saveLocalData: async () => saveWorks,
  };
  const vault = { getFiles: () => files, getAbstractFileByPath: () => ({}), readBinary: async () => bytes, async createBinary(path) {
    creates++; const file = { path, stat: { size: 3, mtime: 1 } }; files.push(file); return file;
  } };
  const make = () => Object.assign(new Library(), { plugin, app: { vault }, _targetDir: () => "Books", _freeBookPath: (_dir, name) => `Books/${name}`, _refresh() {} });
  const input = { name: "original.epub", arrayBuffer: async () => bytes };
  assert.equal(await make()._importBooks([input]), 0);
  saveWorks = true;
  assert.deepEqual(await Promise.all([make()._importBooks([input]), make()._importBooks([input])]), [1, 1]);
  assert.equal(creates, 1);
  assert.equal(records[files[0].path].title, "Alice");
  assert.equal(files[0].path, "Books/original.epub");
});
