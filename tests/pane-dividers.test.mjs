import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { watchPaneDividers } from "../src/pane-dividers.js";

function fixture() {
  const dom = new JSDOM(`<body><div class="workspace"><div class="workspace-split"><hr class="workspace-leaf-resize-handle" style="--divider-color: red !important"><div class="workspace-leaf"><div class="workspace-leaf-content" data-type="qiaomu-reader-english"><div class="view-content" style="background:rgb(23,28,36);color:rgb(213,220,230)"></div></div></div></div><div class="workspace-split"><hr id="unrelated" class="workspace-leaf-resize-handle"></div></div></body>`, { pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  const doc = dom.window.document;
  const handle = doc.querySelector("hr");
  const leaf = doc.querySelector(".workspace-leaf");
  const rect = (x, y, width, height) => ({ x, y, width, height, left:x, right:x+width, top:y, bottom:y+height });
  handle.getBoundingClientRect = () => rect(600, 0, 3, 800);
  leaf.getBoundingClientRect = () => rect(0, 40, 600, 760);
  doc.querySelector(".view-content").getBoundingClientRect = () => rect(0, 40, 600, 760);
  doc.querySelector("#unrelated").getBoundingClientRect = () => rect(1400, 0, 3, 800);
  const attach = (watch = watchPaneDividers) => {
    const cleanup = [];
    const events = new Map();
    watch({ app: { workspace: { iterateAllLeaves: cb => cb({ view: { containerEl: leaf } }), on: (name, cb) => { events.set(name, cb); return {}; }, onLayoutReady: cb => cb() } }, registerEvent() {}, register: cb => cleanup.push(cb) });
    return { stop: () => cleanup.forEach(cb => cb()), events };
  };
  const tick = () => new Promise(resolve => dom.window.requestAnimationFrame(() => dom.window.requestAnimationFrame(resolve)));
  return { dom, doc, handle, leaf, attach, tick, rect };
}

test("dark reading in a light host gets quiet lines; remote note boundaries stay untouched", async () => {
  const f=fixture(); const p=f.attach(); await f.tick();
  assert.match(f.handle.style.getPropertyValue("--qiaomu-divider-color"), /rgb\(213, 220, 230\) 12%, rgb\(23, 28, 36\)/);
  assert.match(f.handle.style.getPropertyValue("--qiaomu-divider-hover"), /24%/);
  assert.equal(f.doc.querySelector("#unrelated").getAttribute("style"), null);
  assert.equal(f.handle.style.width, "");
  assert.equal(f.handle.style.getPropertyValue("--qiaomu-divider-start"), "40px");
  assert.equal(f.handle.style.getPropertyValue("--divider-color"), "red");
  p.stop(); assert.equal(f.handle.style.getPropertyValue("--qiaomu-divider-color"), "");
  assert.equal(f.handle.style.getPropertyPriority("--divider-color"), "important");
  assert.equal(f.handle.style.getPropertyValue("--divider-color"), "red");
  assert.equal(f.handle.classList.contains("qiaomu-pane-divider"),false); f.dom.window.close();
});

test("switching light/dark palettes refreshes; hiding the pane restores the host", async () => {
  const f=fixture(); const p=f.attach(); await f.tick();
  const root=f.doc.querySelector(".view-content"); root.style.background="white"; root.style.color="rgb(34,34,34)"; await f.tick();
  assert.match(f.handle.style.getPropertyValue("--qiaomu-divider-color"), /rgb\(255, 255, 255\)/);
  f.leaf.getBoundingClientRect=()=>f.rect(0,0,0,0); p.events.get("layout-change")(); await f.tick();
  assert.equal(f.handle.style.getPropertyValue("--qiaomu-divider-color"),""); p.stop(); f.dom.window.close();
});

test("independently bundled plugins share ownership and the last unload restores originals", async () => {
  const f=fixture(); const first=f.attach();
  const secondModule=await import("../src/pane-dividers.js?sibling"); const second=f.attach(secondModule.watchPaneDividers); await f.tick();
  first.stop(); assert.equal(f.handle.classList.contains("qiaomu-pane-divider"),true);
  second.stop(); assert.equal(f.handle.style.getPropertyValue("--qiaomu-divider-color"),""); f.dom.window.close();
});

test("mixed light/dark panes prefer a dark seam and do not override a later external edit", async () => {
  const f=fixture(); const clone=f.leaf.cloneNode(true); f.leaf.after(clone);
  clone.getBoundingClientRect=()=>f.rect(603,40,400,760);
  clone.querySelector(".view-content").style.background="white";
  const p=f.attach(); await f.tick(); assert.match(f.handle.style.getPropertyValue("--qiaomu-divider-color"),/rgb\(23, 28, 36\)/);
  f.handle.style.setProperty("--qiaomu-divider-color","blue"); p.stop(); assert.equal(f.handle.style.getPropertyValue("--qiaomu-divider-color"),"blue"); f.dom.window.close();
});
