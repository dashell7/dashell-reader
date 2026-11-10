import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { JSDOM } from "jsdom";
import { searchableQuery, searchBookBlocks, nextSearchIndex } from "../src/reader-search.js";

const source = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function dom() {
  const { window } = new JSDOM("<button id='trigger'></button><section></section>");
  Object.assign(window.HTMLElement.prototype, {
    createEl(tag, options = {}) {
      const el = window.document.createElement(tag);
      if (typeof options === "string") el.className = options;
      else {
        el.className = options.cls || ""; el.textContent = options.text || "";
        if (options.type) el.setAttribute("type", options.type);
        for (const [k, v] of Object.entries(options.attr || {})) el.setAttribute(k, v);
      }
      this.append(el); return el;
    },
    createDiv(options) { return this.createEl("div", options); },
    createSpan(options) { return this.createEl("span", options); },
    empty() { this.replaceChildren(); }, setText(text) { this.textContent = text; },
    addClass(name) { this.classList.add(name); }, removeClass(name) { this.classList.remove(name); },
    hasClass(name) { return this.classList.contains(name); }, toggleClass(name, value) { this.classList.toggle(name, value); }
  });
  return window;
}
function find(search) {
  const window = dom(), panel = window.document.querySelector("section");
  const code = source.slice(source.indexOf("function prepareNavigationPanel("), source.indexOf("function buildTocPanelFor("));
  const build = vm.runInNewContext(`${code}; buildFindPanelFor`, {
    window, AbortController, console: { warn() {} }, qiaomuReaderTranslate: key => key,
    searchableQuery, searchBookBlocks, nextSearchIndex,
    clearFoundIn() {}, markFoundIn() {}, rememberReaderJump() {}, Notice: class {},
  });
  const view = { engine: { search, clearSearchHits: async () => {}, goTo: async () => {} }, findBtn: window.document.querySelector("button") };
  build(view, panel, { close() {} });
  const input = view._findInput;
  const enter = () => input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  const type = query => { input.value = query; input.dispatchEvent(new window.Event("input")); };
  return { window, panel, view, input, enter, type, info: () => panel.querySelector(".qiaomu-reader-find-info").textContent,
    retry: () => [...panel.querySelectorAll("button")].find(e => e.textContent === "try-again") };
}

test("book search keeps loading distinct from empty, then retries the same failed query", async t => {
  const waiting = deferred(); let calls = 0;
  const f = find(async function* () { if (++calls === 1) { await waiting.promise; throw Error("temporary"); } yield { cfi: "match", excerpt: "A real match" }; });
  t.after(() => f.window.close());
  f.type("audit"); f.enter();
  assert.equal(f.info(), "book-find-searching");
  assert.equal(f.retry().hidden, true);
  waiting.resolve(); await tick();
  assert.equal(f.info(), "book-find-failed");
  assert.equal(f.retry().hidden, false);
  f.enter(); await tick();
  assert.equal(calls, 2);
  assert.equal(f.info(), "— / 1");
  assert.equal(f.retry().hidden, true);
  assert.equal(f.panel.querySelectorAll(".qiaomu-reader-find-item").length, 1);
});

test("explicit retry makes a new request and successful empty has no retry affordance", async t => {
  let calls = 0;
  const f = find(async function* () { if (++calls === 1) throw Error("temporary"); });
  t.after(() => f.window.close());
  f.type("empty"); f.enter(); await tick();
  f.retry().click(); await tick();
  assert.equal(calls, 2);
  assert.equal(f.info(), "nothing-found");
  assert.equal(f.retry().hidden, true);
});

test("old book search responses cannot repopulate results during new input or after dispose", async t => {
  const pending = deferred(); let aborted;
  const f = find(async function* (_query, options) { aborted = options.signal; await pending.promise; yield { cfi: "old", excerpt: "stale" }; });
  t.after(() => f.window.close());
  f.type("old"); f.enter();
  f.type(""); assert.equal(aborted.aborted, true);
  pending.resolve(); await tick();
  assert.equal(f.panel.querySelectorAll(".qiaomu-reader-find-item").length, 0);
  assert.notEqual(f.info(), "book-find-failed");
  f.view._disposeFindPanel();
  assert.equal(aborted.aborted, true);
});

test("Calibre failure permits same-query retry, then caches the successful response", async t => {
  const window = dom(); t.after(() => window.close());
  const code = fs.readFileSync(new URL("../src/calibre-modal.js", import.meta.url), "utf8");
  let calls = 0;
  const Calibre = vm.runInNewContext(code.slice(code.indexOf("export class CalibreSearchModal"), code.indexOf("\nexport {", code.indexOf("export class CalibreSearchModal"))).replace("export class", "class") + "; CalibreSearchModal", {
    Modal: class {}, window, console: { warn() {} }, isCalibreSyntaxQuery: () => false,
    tx: (_plugin, key) => key,
    searchCalibreLibrary: async () => { if (++calls === 1) throw Error("temporary"); return { books: [{ id: 1, uuid: "book" }], mode: "search" }; }
  });
  const modal = new Calibre({}, { settings: {} });
  modal._libraryPath = () => "test-library"; modal._calibredbPath = () => "test-calibredb";
  modal._listEl = window.document.querySelector("section");
  modal._paintFoot = () => {}; modal._query = "same";
  // Use the real error view. Successful row rendering is unrelated to retry.
  const paint = modal._paintList;
  modal._paintList = function () { if (this._error) paint.call(this); };
  await modal._search("same");
  const retry = modal._listEl.querySelector("[data-calibre-retry]");
  assert.ok(retry); assert.equal(retry.disabled, false);
  retry.click(); await tick();
  assert.equal(calls, 2); assert.equal(modal._error, ""); assert.equal(modal._books[0].uuid, "book");
  await modal._search("same"); assert.equal(calls, 2);
});

test("library empty-search recovery clears query and category, redraws books and restores focus", async t => {
  const window = dom(); t.after(() => window.close());
  const host = window.document.querySelector("section");
  const code = source.slice(source.indexOf("const LibraryModal = class"), source.indexOf("// ── Mobile full-screen reader modal", source.indexOf("const LibraryModal = class")));
  const Library = vm.runInNewContext(`${code}; LibraryModal`, {
    Modal: class {}, window, qiaomuReaderPath: value => value,
    qiaomuReaderTranslate: (key, query) => query ? `${key}:${query}` : key,
    bookTagsOf: () => [], catalogMetadata: () => ({}), bookStatusOf: () => "unread",
    buildLibChips: () => [{ id: "all", label: "All", count: 1 }, { id: "tag:study", label: "Study", count: 1 }],
    filterLibBooks: (files, category, query) => query || category !== "all" ? [] : files,
    qiaomuReaderAutoFocus() {}, qiaomuReaderBlurOnTapOutside() {},
  });
  let persisted = 0;
  const plugin = { settings: { booksFolder: "Books", libCategory: "tag:study" },
    ensureStarterBooks: async () => {}, refreshProgress: async () => {},
    getProgress: () => ({}), getHighlights: () => [], _saveLocalData: async () => { persisted++; } };
  const library = new Library({}, plugin);
  library.containerEl = library.modalEl = library.contentEl = host;
  library._applyLibTheme = library._setupDropZone = library._sortLibBooks = () => {};
  library._buildLibBrand = () => host.createDiv();
  let input;
  library._buildLibTools = () => ({ input: input = host.createEl("input"), sort: host.createEl("select") });
  library._libVaultBooks = () => [{ path: "Books/a.epub" }];
  library.renderCard = grid => grid.createDiv({ cls: "test-book" });
  await library.onOpen();
  input.value = "not found"; input.dispatchEvent(new window.Event("input"));
  assert.match(host.querySelector(".qiaomu-reader-lib-noresult").textContent, /library-no-results-for:not found/);
  host.querySelector(".qiaomu-reader-lib-noresult button").click();
  assert.equal(input.value, "");
  assert.equal(plugin.settings.libCategory, "all");
  assert.equal(persisted, 1);
  assert.equal(host.querySelectorAll(".test-book").length, 1);
  assert.equal(window.document.activeElement, input);
});
