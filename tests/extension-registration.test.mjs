import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const start = source.indexOf("  _registerReaderExtensions() {");
const method = source.slice(start, source.indexOf("  _addRibbonEntry() {", start));
const extensions = ["epub", "fb2", "fbz", "mobi", "azw", "azw3", "cbz", "pdf"];
const register = vm.runInNewContext(`({${method}})._registerReaderExtensions`, {
  BOOK_EXTENSIONS: new Set(extensions),
  VIEW_TYPE: "qiaomu-reader-english",
  console: { warn() {} },
});

test("standalone English reader claims available book formats without replacing native PDF or Markdown", () => {
  const associations = { pdf: "pdf", md: "markdown" };
  const plugin = {
    app: { plugins: { enabledPlugins: new Set(["qiaomu-reader-english"]) } },
    registerExtensions([extension], view) {
      if (associations[extension]) throw new Error("extension already registered");
      associations[extension] = view;
    },
  };

  register.call(plugin);
  for (const extension of extensions.filter((value) => value !== "pdf")) {
    assert.equal(associations[extension], "qiaomu-reader-english");
  }
  assert.equal(associations.pdf, "pdf");
  assert.equal(associations.md, "markdown");
});

test("English reader leaves default file associations to enabled upstream reader", () => {
  const claimed = [];
  register.call({
    app: { plugins: { enabledPlugins: new Set(["qiaomu-reader", "qiaomu-reader-english"]) } },
    registerExtensions([extension]) { claimed.push(extension); },
  });
  assert.deepEqual(claimed, []);
});
