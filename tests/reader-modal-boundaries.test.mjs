import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const source = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const start = source.indexOf("  _installCloseGuard(modalEl) {", source.indexOf("const ReaderModal"));
const end = source.indexOf("  _startReadingSession() {", start);

function fixture(t) {
  const dom = new JSDOM(`<body>
    <div class="modal-container" id="other"><div class="modal">
      <button class="modal-close-button" id="other-close">Close settings</button>
      <button class="modal-header-button" id="other-header">Settings action</button>
    </div></div>
    <button class="modal-header-button" id="host-action">Host action</button>
    <div class="modal-container" id="reader"><div class="modal" id="reader-modal">
      <button class="modal-close-button" id="reader-close">Close reader</button>
      <button class="modal-header-button" id="reader-header">Reader header</button>
      <button id="reader-back">Back to library</button>
    </div></div>
  </body>`);
  const doc = dom.window.document;
  const install = vm.runInNewContext(`({${source.slice(start, end)}})._installCloseGuard`, {
    docOf: element => element.ownerDocument,
    MutationObserver: dom.window.MutationObserver,
  });
  const reader = { containerEl: doc.getElementById("reader") };
  const tick = () => new Promise(resolve => dom.window.setTimeout(resolve, 0));
  t.after(() => { reader._closeWatch?.disconnect(); dom.window.close(); });
  return { doc, reader, tick, install: () => install.call(reader, doc.getElementById("reader-modal")) };
}

test("opening the reader preserves other dialogs and host controls while removing its own redundant close chrome", t => {
  const f = fixture(t);
  f.install();
  assert.ok(f.doc.getElementById("other-close"), "an already open settings dialog must remain closable");
  assert.ok(f.doc.getElementById("other-header"));
  assert.ok(f.doc.getElementById("host-action"));
  assert.equal(f.doc.getElementById("reader-close"), null);
  assert.equal(f.doc.getElementById("reader-header"), null);
  assert.ok(f.doc.getElementById("reader-back"), "the reader's explicit return action remains available");
});

test("the guard removes later reader chrome but preserves a nested dialog's close action", async t => {
  const f = fixture(t);
  f.install();
  const modal = f.doc.getElementById("reader-modal");
  modal.insertAdjacentHTML("beforeend", `<button class="modal-close-button" id="reader-late">Close</button>
    <div class="modal-container" id="nested"><div class="modal">
      <button class="modal-close-button" id="nested-close">Close nested dialog</button>
    </div></div>`);
  f.doc.getElementById("other").insertAdjacentHTML("beforeend", '<button class="modal-header-button" id="other-late">Other action</button>');
  await f.tick();
  assert.equal(f.doc.getElementById("reader-late"), null);
  assert.ok(f.doc.getElementById("nested-close"));
  assert.ok(f.doc.getElementById("other-late"));
});

test("disconnecting the guard leaves later host cleanup in control", async t => {
  const f = fixture(t);
  f.install();
  f.reader._closeWatch.disconnect();
  f.doc.getElementById("reader-modal").insertAdjacentHTML("beforeend", '<button class="modal-close-button" id="after-close">Close</button>');
  await f.tick();
  assert.ok(f.doc.getElementById("after-close"));
});
