import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { JSDOM } from "jsdom";
import { highlightBacklink } from "../src/highlight-navigation.js";
import { isLookupTerm, cleanLookupTerm, sentenceAround, rangeContext, createLookupCache, lookupCacheKey } from "../src/lookup.js";

const source = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const functionSource = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function dom() {
  const result = new JSDOM("<main></main>");
  const { document, HTMLElement } = result.window;
  HTMLElement.prototype.empty = function () { this.replaceChildren(); };
  HTMLElement.prototype.addClass = function (name) { this.classList.add(name); };
  HTMLElement.prototype.removeClass = function (name) { this.classList.remove(name); };
  HTMLElement.prototype.createEl = function (tag, options = {}) {
    const el = document.createElement(tag);
    if (options.cls) el.className = options.cls;
    if (options.text) el.textContent = options.text;
    for (const [key, value] of Object.entries(options.attr || {})) el.setAttribute(key, value);
    this.append(el);
    return el;
  };
  for (const tag of ["div", "span"]) {
    HTMLElement.prototype[`create${tag[0].toUpperCase() + tag.slice(1)}`] = function (options) {
      return this.createEl(tag, typeof options === "string" ? { cls: options } : options);
    };
  }
  return result;
}

test("short selection opens Dashell dictionary with source context and reader link", async () => {
  const calls = [];
  const plugin = { settings: { translateEnabled: true }, openEnglishDictionary: async (...args) => calls.push(args) };
  let hidden = 0;
  const view = {
    plugin,
    app: { vault: { getName: () => "Merge QA" } },
    file: { path: "Books/book.epub", basename: "book" },
    hlPopup: {},
    _currentHl: () => ({ text: "serendipity", pre: "Before. It was ", post: " today. After.", cfi: "epubcfi(/6/4!/4/2:0)" }),
    _hideHlPopup: () => { hidden++; },
  };
  const open = vm.runInNewContext(`${functionSource("function openLookupCard(", "function placeLookupCard(")}; openLookupCard`, {
    isLookupTerm, cleanLookupTerm, sentenceAround, rangeContext, highlightBacklink,
    selOf: () => null, closeSelectionColorDropdown() {}, closeInlineHighlightComment() {}, closeLookupCard() {},
  });
  open(view);
  await Promise.resolve();
  assert.equal(hidden, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "serendipity");
  assert.equal(calls[0][1].sentence, "It was serendipity today.");
  assert.equal(calls[0][1].bookTitle, "book");
  assert.match(calls[0][1].readerLink, /obsidian:\/\/dashell-reader\?/);
  assert.match(calls[0][1].readerLink, /cfi=epubcfi%28/);
});

test("passage translation renders its answer and actions without a second word card", async () => {
  const h = dom();
  const card = h.window.document.querySelector("main");
  const state = { plugin: {}, view: {}, text: "This is a complete sentence.", context: "This is a complete sentence.", target: "zh-CN", engine: "google" };
  let actions = 0;
  const run = vm.runInNewContext(`${functionSource("async function runLookup(", "function renderLookupActions(")}; runLookup`, {
    AbortController, createLookupCache, lookupCacheKey,
    window: { requestAnimationFrame: fn => fn(), clearTimeout() {} },
    qiaomuReaderTranslate: x => x, lookupLanguageLabel: x => x,
    setIcon() {}, aiConfig: () => ({}), placeLookupCard() {},
    googleTranslateDetailed: async () => ({ text: "这是一个完整的句子。", target: "zh-CN" }),
    renderLookupActions: () => { actions++; },
  });
  await run(card, state);
  assert.equal(card.querySelector(".qiaomu-reader-lookup-text").textContent, "这是一个完整的句子。");
  assert.equal(card.querySelector(".qiaomu-reader-lookup-status"), null);
  assert.equal(card.querySelector(".qiaomu-reader-lookup-term"), null);
  assert.equal(actions, 1);
  h.window.close();
});

test("settings arrow and endpoint keys focus the selected replacement after redraw", () => {
  const h = dom();
  const root = h.window.document.querySelector("main");
  root.className = "qiaomu-reader-settings-root";
  const bind = vm.runInNewContext(`${functionSource("function bindSettingsTabKeys(", "const ReadSettingsModal =")}; bindSettingsTabKeys`);
  const draw = (selected) => {
    root.replaceChildren();
    const tablist = root.createDiv();
    tablist.setAttribute("role", "tablist");
    for (let index = 0; index < 3; index++) {
      const tab = tablist.createEl("button", { attr: { role: "tab", "aria-selected": String(index === selected) } });
      tab.tabIndex = index === selected ? 0 : -1;
      tab.addEventListener("click", () => draw(index));
    }
    bind(tablist);
  };
  draw(0);
  for (const [key, expected] of [["ArrowRight", 1], ["ArrowDown", 2], ["ArrowRight", 0], ["End", 2], ["ArrowUp", 1], ["Home", 0], ["ArrowLeft", 2]]) {
    const before = root.querySelector('[aria-selected="true"]');
    const event = new h.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    before.dispatchEvent(event);
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    assert.equal(tabs.indexOf(h.window.document.activeElement), expected);
    assert.equal(h.window.document.activeElement.getAttribute("aria-selected"), "true");
    assert.equal(event.defaultPrevented, true);
    assert.equal(before.isConnected, false);
  }
  h.window.close();
});
