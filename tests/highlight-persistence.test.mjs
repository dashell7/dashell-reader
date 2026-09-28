import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const readerSource = source.slice(
  source.indexOf("const QiaomuBookReader = class extends Plugin"),
  source.indexOf("const PdfPaginator = class"),
);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function highlightStore(options = {}) {
  const Reader = vm.runInNewContext(`${readerSource}\nQiaomuBookReader`, {
    Plugin: class {}, DEFAULT: {}, createSerialTaskQueue: () => ({}),
    qiaomuReaderPath: (path) => path, qiaomuReaderTranslate: (key) => key,
    Notice: class {}, console: { error() {} },
  });
  const plugin = new Reader();
  const file = "test-config/plugins/qiaomu-reader-english/reading-highlights.json";
  const files = new Map([[file, JSON.stringify(options.initial || {})]]);
  const firstWriteStarted = deferred();
  const firstWriteRelease = deferred();
  let writes = 0;
  plugin.manifest = { dir: "test-config/plugins/qiaomu-reader-english" };
  plugin.app = { vault: {
    adapter: {
      exists: async (path) => files.has(path) || path !== file,
      write: async (path, contents) => {
        writes += 1;
        if (writes === 1 && options.pauseFirstWrite) {
          firstWriteStarted.resolve();
          await firstWriteRelease.promise;
        }
        if (writes === 1 && options.failFirstWrite) throw new Error("disk full");
        files.set(path, contents);
      },
    },
    createFolder: async () => {},
  } };
  plugin._readHighlightStore = async () => JSON.parse(files.get(file) || "{}");
  plugin._writeRescue = async () => {};
  plugin._saveLocalData = async () => true;
  return {
    plugin, files, file, firstWriteStarted, firstWriteRelease,
    saved: () => JSON.parse(files.get(file)),
  };
}

test("a quick remove cannot be undone by an older in-flight highlight save", async () => {
  const h = highlightStore({ pauseFirstWrite: true });
  h.plugin.addHighlight("book.epub", { id: "one", text: "passage" });
  await h.firstWriteStarted.promise;
  h.plugin.removeHighlight("book.epub", "one");
  assert.equal(h.plugin.getHighlights("book.epub").length, 0);
  h.firstWriteRelease.resolve();
  await h.plugin._hlChain;
  assert.equal(h.plugin.getHighlights("book.epub").length, 0);
  assert.deepEqual(h.saved()["book.epub"], []);
});

test("clear all is ordered with adds before and after it", async () => {
  const h = highlightStore({ pauseFirstWrite: true, initial: { "book.epub": [{ id: "old" }] } });
  h.plugin.highlights = { "book.epub": [{ id: "old" }] };
  h.plugin.addHighlight("book.epub", { id: "before" });
  await h.firstWriteStarted.promise;
  const clear = h.plugin.clearHighlights();
  h.plugin.addHighlight("book.epub", { id: "after" });
  h.firstWriteRelease.resolve();
  assert.equal(await clear, true);
  await h.plugin._hlChain;
  assert.deepEqual(h.saved()["book.epub"].map((row) => row.id), ["after"]);
  assert.deepEqual(Array.from(h.plugin.getHighlights("book.epub"), (row) => row.id), ["after"]);
});

test("a failed write is replayed before the next mutation", async () => {
  const h = highlightStore({ failFirstWrite: true });
  h.plugin.addHighlight("book.epub", { id: "one", color: "yellow" });
  await h.plugin._hlChain;
  assert.equal(h.saved()["book.epub"], undefined);
  h.plugin.setHighlightColor("book.epub", "one", "green");
  await h.plugin._hlChain;
  assert.equal(h.saved()["book.epub"][0].color, "green");
  assert.equal(h.plugin.getHighlights("book.epub")[0].color, "green");
});
