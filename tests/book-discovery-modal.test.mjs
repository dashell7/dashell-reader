import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as discovery from "../src/book-discovery.js";

const source = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const start = source.indexOf("const BookDiscoveryModal = class");
const code = source.slice(start, source.indexOf("// ── Mobile full-screen reader modal", start));
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function setup(requestUrl) {
  const { window } = new JSDOM("<body/>");
  const { document } = window;
  Object.assign(window.HTMLElement.prototype, {
    empty() { this.replaceChildren(); },
    addClass(...names) { this.classList.add(...names); },
    setText(text) { this.textContent = text; },
    createEl(tag, options = {}) {
      const el = document.createElement(tag);
      if (options.text) el.textContent = options.text;
      if (options.cls) el.className = options.cls;
      if (options.href) el.setAttribute("href", options.href);
      for (const [key, value] of Object.entries(options.attr || {})) el.setAttribute(key, value);
      this.append(el);
      return el;
    },
    createDiv(options) { return this.createEl("div", options); },
    createSpan(options) { return this.createEl("span", options); }
  });
  class Modal {
    constructor(app) { this.app = app; this.modalEl = document.body.createDiv(); this.contentEl = this.modalEl.createDiv(); }
    open() { this.onOpen(); }
    close() { this.onClose(); }
  }
  const Discovery = vm.runInNewContext(`${code};BookDiscoveryModal`, {
    ...discovery, Modal, requestUrl, DOMParser: window.DOMParser, window,
    qiaomuReaderTranslate: key => key, setIcon() {}, console: { warn() {} },
    ANNA_SOURCE_NAME: "Anna", URL, Set, Map
  });
  const files = [];
  const imports = [];
  const plugin = {};
  const library = { async _importBooks(items) { imports.push(items); files.push({ name: items[0].name }); return 1; } };
  const modal = new Discovery({ vault: { getFiles: () => files } }, plugin, library);
  modal.open();
  const button = document.createElement("button");
  modal.contentEl.append(button);
  const status = modal.contentEl.createDiv();
  return { modal, plugin, library, button, status, imports, files, document, window, cleanup: () => window.close() };
}
const book = { id: "11", title: "Alice" };
const detail = { status: 200, text: `<feed xmlns="http://www.w3.org/2005/Atom"><entry><link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="https://www.gutenberg.org/ebooks/11.epub3.images"/></entry></feed>` };
const bytes = new Uint8Array(128); bytes.set([80, 75, 3, 4]);
const epub = { status: 200, arrayBuffer: bytes.buffer };

test("download shows progress, ignores repeated activation and stays completed", async t => {
  const catalog = deferred(), binary = deferred();
  let calls = 0;
  const state = setup(() => ++calls === 1 ? catalog.promise : binary.promise);
  t.after(state.cleanup);
  const { modal, button, status } = state;
  const pending = modal._download(book, button, status);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "book-download-preparing");
  await modal._download(book, button, status);
  assert.equal(calls, 1);
  catalog.resolve(detail); await new Promise(setImmediate);
  assert.equal(button.textContent, "downloading-book");
  binary.resolve(epub); await pending;
  assert.equal(state.imports.length, 1);
  assert.equal(button.textContent, "book-download-imported");
  assert.equal(button.disabled, true);
});

test("failed download can retry and imports only verified bytes", async t => {
  let calls = 0;
  const state = setup(async () => ++calls % 2 ? detail : calls === 2 ? { status: 200, arrayBuffer: new ArrayBuffer(128) } : epub);
  t.after(state.cleanup);
  await state.modal._download(book, state.button, state.status);
  assert.equal(state.imports.length, 0);
  assert.equal(state.button.disabled, false);
  assert.equal(state.status.textContent, "book-download-failed");
  await state.modal._download(book, state.button, state.status);
  assert.equal(state.imports.length, 1);
  assert.equal(state.button.disabled, true);
});

test("closing and reopening isolates an old binary response", async t => {
  const binary = deferred();
  let calls = 0;
  const state = setup(async () => ++calls === 1 ? detail : binary.promise);
  t.after(state.cleanup);
  const pending = state.modal._download(book, state.button, state.status);
  await new Promise(setImmediate);
  state.modal.close(); state.modal.open();
  binary.resolve(epub); await pending;
  assert.equal(state.imports.length, 0);
  assert.equal(state.modal.contentEl.textContent.includes("book-import-finished"), false);
});

test("a new search invalidates an earlier download before import", async t => {
  const binary = deferred();
  let calls = 0;
  const state = setup(async () => ++calls === 1 ? detail : calls === 2 ? binary.promise : { status: 200, text: '<feed xmlns="http://www.w3.org/2005/Atom"/>' });
  t.after(state.cleanup);
  const pending = state.modal._download(book, state.button, state.status);
  await new Promise(setImmediate);
  await state.modal._search("another", state.status, state.modal.contentEl.createDiv());
  binary.resolve(epub); await pending;
  assert.equal(state.imports.length, 0);
  assert.equal(state.status.textContent, "no-books-found");
});

test("unloading closes tracked discovery windows and prevents a delayed import", async t => {
  const binary = deferred();
  let calls = 0;
  const state = setup(async () => ++calls === 1 ? detail : binary.promise);
  t.after(state.cleanup);
  assert.equal(state.plugin._bookDiscoveryModals?.has(state.modal), true);
  const pending = state.modal._download(book, state.button, state.status);
  await new Promise(setImmediate);
  const unloadStart = source.indexOf("  onunload() {", source.indexOf("const QiaomuBookReader"));
  const unload = source.slice(unloadStart, source.indexOf("  async openLearningMaterial", unloadStart));
  const stop = unload.indexOf("cancelAccountLogins");
  vm.runInNewContext(`(function(){${unload.slice(unload.indexOf("{") + 1, stop)}}).call(plugin)`, { plugin: state.plugin });
  assert.equal(state.modal._open, false);
  assert.equal(state.plugin._bookDiscoveryModals.size, 0);
  assert.equal(state.plugin._bookDiscoveryDownloads.size, 0);
  binary.resolve(epub); await pending;
  assert.equal(state.imports.length, 0);
});

test("the same book has one active download even across result buttons", async t => {
  const binary = deferred();
  let calls = 0;
  const state = setup(async () => ++calls === 1 ? detail : binary.promise);
  t.after(state.cleanup);
  const pending = state.modal._download(book, state.button, state.status);
  await new Promise(setImmediate);
  const second = state.document.createElement("button");
  await state.modal._download(book, second, state.status);
  assert.equal(calls, 2);
  binary.resolve(epub); await pending;
  assert.equal(state.imports.length, 1);
  assert.equal(state.plugin._bookDiscoveryDownloads.size, 0);
});

test("a manual import during download is detected before another vault write", async t => {
  const binary = deferred();
  let calls = 0;
  const state = setup(async () => ++calls === 1 ? detail : binary.promise);
  t.after(state.cleanup);
  const pending = state.modal._download(book, state.button, state.status);
  await new Promise(setImmediate);
  state.files.push({ name: "Manual (Gutenberg 11).epub" });
  binary.resolve(epub); await pending;
  assert.equal(state.imports.length, 0);
  assert.equal(state.status.textContent, "book-already-in-library");
  assert.equal(state.button.disabled, true);
});

test("an import failure leaves a retryable button and releases the book", async t => {
  let calls = 0;
  const state = setup(async () => ++calls % 2 ? detail : epub);
  t.after(state.cleanup);
  state.library._importBooks = async () => {
    assert.equal(state.button.textContent, "book-download-importing");
    throw new Error("write failed");
  };
  await state.modal._download(book, state.button, state.status);
  assert.equal(state.button.disabled, false);
  assert.equal(state.button.getAttribute("aria-busy"), "false");
  assert.equal(state.plugin._bookDiscoveryDownloads.size, 0);
  assert.equal(state.status.textContent, "book-download-failed");
});

test("closing after import starts does not publish completion into a reopened window", async t => {
  let calls = 0;
  const state = setup(async () => ++calls % 2 ? detail : epub);
  t.after(state.cleanup);
  const imported = deferred();
  state.library._importBooks = () => imported.promise;
  const pending = state.modal._download(book, state.button, state.status);
  await new Promise(setImmediate);
  assert.equal(state.button.textContent, "book-download-importing");
  state.modal.close(); state.modal.open();
  imported.resolve(1); await pending;
  assert.equal(state.modal.contentEl.textContent.includes("book-import-finished"), false);
  assert.equal(state.plugin._bookDiscoveryDownloads.size, 0);
});

test("reopening cannot start a second write while the first import is committing", async t => {
  let calls = 0, imports = 0;
  const state = setup(async () => ++calls % 2 ? detail : epub);
  t.after(state.cleanup);
  const gate = deferred();
  state.library._importBooks = async () => { imports++; return gate.promise; };
  const first = state.modal._download(book, state.button, state.status);
  await new Promise(setImmediate);
  state.modal.close(); state.modal.open();
  const second = state.modal._download(book, state.document.createElement("button"), state.modal.contentEl.createDiv());
  await new Promise(setImmediate);
  gate.resolve(1); await Promise.all([first, second]);
  assert.equal(imports, 1);
  assert.equal(calls, 2);
  assert.equal(state.plugin._bookDiscoveryDownloads.size, 0);
});
