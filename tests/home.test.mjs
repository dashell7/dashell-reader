import assert from "node:assert/strict";
import test from "node:test";
import { createHomeProvider } from "../src/home.js";

function setup() {
  const book = { path: "Books/Alice.epub", basename: "Alice", extension: "epub" };
  const note = { path: "Reading/Story.md", basename: "Story", extension: "md" };
  const files = new Map([[book.path, book], [note.path, note]]);
  const calls = [];
  const library = { _pickBooks: () => calls.push("pick") };
  const plugin = {
    manifest: { id: "qiaomu-reader-english" },
    progress: {
      [book.path]: { pct: 0.2, lastRead: 1 },
      [note.path]: { pct: 0.6, lastRead: 2 },
      "Reading/Removed.md": { pct: 0.8, lastRead: 3 },
    },
    thumbCache: {},
    bookFiles: () => [book],
    getProgress(path) { return this.progress[path]; },
    openFile: (file) => calls.push(file.path),
    openLibrary: async () => calls.push("library"),
    app: {
      vault: { getAbstractFileByPath: (path) => files.get(path) },
      workspace: {
        getLeavesOfType: (type) => {
          calls.push(type);
          return type === "qiaomu-reader-english-library" ? [{ view: library }] : [];
        },
      },
    },
  };
  return { provider: createHomeProvider(plugin, (key) => key), calls };
}

test("Home continues recent books and read Markdown without exposing all vault notes", () => {
  const { provider, calls } = setup();
  const [section] = provider.sections();
  assert.deepEqual(section.items.map((item) => item.id), ["Reading/Story.md", "Books/Alice.epub"]);
  assert.equal(section.items[0].meta, "60%");
  assert.deepEqual(provider.search("story", 4).map((item) => item.id), ["Reading/Story.md"]);
  section.items[0].open();
  assert.deepEqual(calls, ["Reading/Story.md"]);
});

test("Home's add-book action opens the English fork's library", async () => {
  const { provider, calls } = setup();
  await provider.actions()[0].run();
  assert.deepEqual(calls, ["library", "qiaomu-reader-english-library", "pick"]);
});
