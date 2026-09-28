import assert from "node:assert/strict";
import test from "node:test";
import { watchReaderStatusBar } from "../src/status-bar.js";

function setup(initialType = "markdown") {
  let activeType = initialType;
  const classes = new Set(["qiaomu-reader-active-view"]);
  const listeners = new Map();
  const document = {
    body: {
      classList: {
        contains: name => classes.has(name),
        toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
        remove: name => classes.delete(name),
      },
    },
    querySelector(selector) {
      assert.equal(selector, ".workspace-leaf.mod-active > .workspace-leaf-content");
      return activeType ? { getAttribute: name => name === "data-type" ? activeType : null } : null;
    },
  };
  const workspace = {
    on(name, callback) {
      const ref = { name, callback };
      const set = listeners.get(name) || new Set();
      set.add(ref);
      listeners.set(name, set);
      return ref;
    },
    offref(ref) { listeners.get(ref.name)?.delete(ref); },
  };
  return {
    document,
    workspace,
    setActive(type, event = "active-leaf-change") {
      activeType = type;
      for (const ref of listeners.get(event) || []) ref.callback();
    },
    listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
  };
}

test("English reader hides the status bar, then a normal note restores it", async () => {
  const host = setup();
  const stop = watchReaderStatusBar(host.workspace, host.document);
  const ownClass = "qiaomu-reader-english-active-view";

  assert.equal(host.document.body.classList.contains(ownClass), false);
  host.setActive("qiaomu-reader-english");
  await Promise.resolve();
  assert.equal(host.document.body.classList.contains(ownClass), true);

  host.setActive("markdown", "layout-change");
  await Promise.resolve();
  assert.equal(host.document.body.classList.contains(ownClass), false);
  stop();
});

test("English side panels keep the reader state while the original plugin stays isolated", async () => {
  const host = setup("qiaomu-reader-english-library");
  const stop = watchReaderStatusBar(host.workspace, host.document);
  const ownClass = "qiaomu-reader-english-active-view";

  assert.equal(host.document.body.classList.contains(ownClass), true);
  assert.equal(host.document.body.classList.contains("qiaomu-reader-active-view"), true);
  host.setActive("qiaomu-english-learn-panel");
  await Promise.resolve();
  assert.equal(host.document.body.classList.contains(ownClass), true);
  host.setActive("qiaomu-reader");
  await Promise.resolve();
  assert.equal(host.document.body.classList.contains(ownClass), false);
  assert.equal(host.document.body.classList.contains("qiaomu-reader-active-view"), true);
  stop();
});

test("teardown releases workspace listeners and removes only the English class", async () => {
  const host = setup("qiaomu-reader-english-ai-chat");
  const stop = watchReaderStatusBar(host.workspace, host.document);
  const ownClass = "qiaomu-reader-english-active-view";

  assert.ok(host.listenerCount() > 0);
  assert.equal(host.document.body.classList.contains(ownClass), true);
  stop();
  assert.equal(host.listenerCount(), 0);
  assert.equal(host.document.body.classList.contains(ownClass), false);
  assert.equal(host.document.body.classList.contains("qiaomu-reader-active-view"), true);
  host.setActive("qiaomu-reader-english");
  await Promise.resolve();
  assert.equal(host.document.body.classList.contains(ownClass), false);
});
