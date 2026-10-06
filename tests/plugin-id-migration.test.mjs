import assert from "node:assert/strict";
import test from "node:test";
import { migrateLegacyReaderData } from "../src/plugin-id-migration.js";

function memoryAdapter(initial = {}) {
  const files = new Map(Object.entries(initial));
  const folders = new Set(["test-config", "test-config/plugins", "test-config/plugins/qiaomu-reader-english"]);
  for (const path of files.keys()) {
    let parent = path.slice(0, path.lastIndexOf("/"));
    while (parent) {
      folders.add(parent);
      parent = parent.slice(0, parent.lastIndexOf("/"));
    }
  }
  const writes = [];
  const adapter = {
    async exists(path) { return files.has(path) || folders.has(path); },
    async read(path) {
      if (!files.has(path)) throw new Error(`Missing file: ${path}`);
      return files.get(path);
    },
    async write(path, value) { files.set(path, value); writes.push(path); },
    async mkdir(path) { folders.add(path); },
    async list(path) {
      const prefix = `${path}/`;
      const childFolders = [...folders].filter((folder) => folder.startsWith(prefix)
        && !folder.slice(prefix.length).includes("/"));
      const childFiles = [...files.keys()].filter((file) => file.startsWith(prefix)
        && !file.slice(prefix.length).includes("/"));
      return { folders: childFolders, files: childFiles };
    },
  };
  return { adapter, files, folders, writes };
}

test("copies plugin state once, remaps the recovery pointer, and preserves the old folder", async () => {
  const old = "test-config/plugins/qiaomu-reader-english";
  const next = "test-config/plugins/dashell-reader";
  const { adapter, files, writes } = memoryAdapter({
    [`${old}/data.json`]: JSON.stringify({ settings: { language: "zh" } }),
    [`${old}/reading-progress.json`]: '{"Books/Alice.epub":{"pct":0.4}}',
    [`${old}/reading-progress-recovery.json`]: JSON.stringify({
      sourcePath: `${old}/reading-progress.json`, progress: { "Books/Alice.epub": { pct: 0.4 } },
    }),
    [`${old}/reading-highlights.json`]: '{"Books/Alice.epub":[]}',
    [`${old}/thumb-cache.json`]: '{"Books/Alice.epub":"data:image/png;base64,AA=="}',
    [`${old}/ai-drafts.json`]: '{"drafts":[]}',
    [`${old}/_reader-rescue/2026-10-01/plugin-data.json`]: "backup",
  });

  const result = await migrateLegacyReaderData(adapter, old, next);
  assert.equal(result.migrated, true);
  assert.equal(files.get(`${next}/data.json`), files.get(`${old}/data.json`));
  assert.equal(files.get(`${next}/reading-progress.json`), files.get(`${old}/reading-progress.json`));
  assert.equal(JSON.parse(files.get(`${next}/reading-progress-recovery.json`)).sourcePath,
    `${next}/reading-progress.json`);
  assert.equal(files.get(`${next}/_reader-rescue/2026-10-01/plugin-data.json`), "backup");
  assert.equal(files.get(`${old}/data.json`), JSON.stringify({ settings: { language: "zh" } }));
  assert.equal(writes.at(-1), `${next}/data.json`, "the completion marker is copied last");

  const repeated = await migrateLegacyReaderData(adapter, old, next);
  assert.deepEqual(repeated, { migrated: false, copied: [] });
});

test("does not overwrite data already created in the new plugin directory", async () => {
  const old = "test-config/plugins/qiaomu-reader-english";
  const next = "test-config/plugins/dashell-reader";
  const { adapter, files, writes } = memoryAdapter({
    [`${old}/data.json`]: "old-settings",
    [`${old}/reading-progress.json`]: "old-progress",
    [`${next}/data.json`]: "new-settings",
  });

  const result = await migrateLegacyReaderData(adapter, old, next);
  assert.deepEqual(result, { migrated: false, copied: [] });
  assert.equal(files.get(`${next}/data.json`), "new-settings");
  assert.equal(files.has(`${next}/reading-progress.json`), false);
  assert.deepEqual(writes, []);
});
