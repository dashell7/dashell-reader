import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const source = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const slice = (from, to, start = 0) => {
  const offset = source.indexOf(from, start);
  assert.notEqual(offset, -1, from);
  const end = source.indexOf(to, offset + from.length);
  assert.notEqual(end, -1, to);
  return source.slice(offset, end);
};

function fixture() {
  const { window } = new JSDOM("<button id='trigger'>Contents</button><main tabindex='0'></main><section class='qiaomu-reader-panel qiaomu-reader-panel-open'></section>");
  const proto = window.HTMLElement.prototype;
  proto.createEl = function(tag, options = {}) {
    const el = window.document.createElement(tag);
    if (typeof options === "string") el.className = options;
    else {
      el.className = options.cls || "";
      el.textContent = options.text || "";
      if (options.type) el.setAttribute("type", options.type);
      for (const [key, value] of Object.entries(options.attr || {})) el.setAttribute(key, value);
    }
    this.appendChild(el);
    return el;
  };
  proto.createDiv = function(options) { return this.createEl("div", options); };
  proto.createSpan = function(options) { return this.createEl("span", options); };
  proto.empty = function() { this.replaceChildren(); };
  proto.setText = function(value) { this.textContent = value; };
  proto.addClass = function(value) { this.classList.add(value); };
  const panel = window.document.querySelector("section");
  const areaEl = window.document.querySelector("main");
  const trigger = window.document.querySelector("button");
  const context = { window, qiaomuReaderTranslate: (key) => key };
  const key = (element, key, options = {}) => element.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
  return { window, panel, areaEl, trigger, context, key };
}

function assertNativeButtons(nodes) {
  assert.ok(nodes.length > 0);
  for (const button of nodes) {
    assert.equal(button.tagName, "BUTTON");
    assert.equal(button.type, "button");
    assert.equal(button.tabIndex, 0);
    assert.equal(button.querySelector("button"), null);
    assert.ok(button.textContent.trim());
    assert.equal(button.hasAttribute("aria-label"), false);
    assert.equal(button.hasAttribute("title"), false);
  }
}

function toc(f, entries) {
  const view = { tocBtn: f.trigger, areaEl: f.areaEl, tocItems: entries, pager: { spread: 0, spreadForBlock: (block) => block } };
  const closed = [], jumped = [];
  const code = slice("function prepareNavigationPanel(", "// Typing in the find field") + slice("function buildTocPanelFor(", "function chapterForBlock(");
  const build = vm.runInNewContext(`${code}; buildTocPanelFor`, { ...f.context, addLocationMark() {}, showLocationMarks() {} });
  build(view, f.panel, { close: () => closed.push(true), jump: (entry) => jumped.push(entry) });
  return { view, closed, jumped };
}

test("TOC entries expose native keyboard activation, one jump, and return reading focus", () => {
  const f = fixture();
  const entries = [{ label: "First chapter", block: 0 }, { label: "Second chapter", block: 1 }];
  const state = toc(f, entries);
  const buttons = f.panel.querySelectorAll(".qiaomu-reader-toc-item");
  // JSDOM does not synthesize native Enter/Space click defaults. Check native
  // semantics and the resulting activation here; actual keys run in host QA.
  assertNativeButtons(buttons);
  buttons[1].focus(); buttons[1].click();
  assert.deepEqual(state.jumped, [entries[1]]);
  assert.equal(state.closed.length, 1);
  assert.equal(f.window.document.activeElement, f.areaEl);
  f.window.close();
});

test("TOC filtering has an associated name, preserves navigation and ignores composing Escape", () => {
  const f = fixture();
  const entries = Array.from({ length: 13 }, (_, i) => ({ label: `Chapter ${i}`, block: i }));
  const state = toc(f, entries);
  const input = f.panel.querySelector("input");
  assert.equal(input.labels.length, 1);
  assert.equal(input.labels[0].textContent, "filter-by-title");
  input.value = "Chapter 12"; input.dispatchEvent(new f.window.Event("input"));
  assert.equal(f.panel.querySelectorAll(".qiaomu-reader-toc-item").length, 1);
  assert.deepEqual(state.jumped, []);
  f.key(input, "Escape", { isComposing: true });
  assert.equal(state.closed.length, 0);
  f.key(input, "Escape");
  assert.equal(state.closed.length, 1);
  assert.equal(f.window.document.activeElement, f.trigger);
  f.window.close();
});

function highlights(f, initial) {
  const menus = [], jumped = [], removed = [];
  let entries = [...initial], exported = 0, closed = 0;
  class Menu {
    constructor() { menus.push(this); }
    addItem(build) {
      const item = { setTitle() { return this; }, setIcon() { return this; }, onClick(callback) { this.action = callback; return this; } };
      build(item);
    }
    onHide(callback) { this.hide = callback; }
    showAtPosition(position, document) { this.position = position; this.document = document; }
    showAtMouseEvent(event) { this.mouse = event; }
  }
  const owner = {
    areaEl: f.areaEl, file: { path: "book.epub" }, app: {},
    plugin: { getHighlights: () => entries, removeHighlight: (_path, id) => { removed.push(id); entries = entries.filter((entry) => entry.id !== id); } },
    closePanel() { closed++; f.panel.classList.remove("qiaomu-reader-panel-open"); },
    async goToHighlight(id) { jumped.push(id); owner.closePanel(); },
    exportHighlights() { exported++; }, _unwrapHighlight() {},
  };
  const render = vm.runInNewContext(`${slice("function renderHighlightPanel(", "function renderAiHeadMeta(")}; renderHighlightPanel`, {
    ...f.context, Menu, hlColorCss: () => "#fff", iconLabel: (el, _icon, text) => el.setText(text), svgIcon() {},
    createNoteFromSelection() {}, sendQuoteToBookNote() {}, openTts() {}, hlCommentMd: () => "",
  });
  const opts = { rebuild: () => render(f.panel, owner, opts) };
  opts.rebuild();
  return { owner, menus, jumped, removed, get exported() { return exported; }, get closed() { return closed; } };
}
const sample = [{ id: "one", text: "First passage", color: "yellow", comment: "First thought" }, { id: "two", text: "Second passage", color: "yellow" }];

test("highlight jump, more, delete and export are separate named native controls", async () => {
  const f = fixture(), state = highlights(f, sample);
  assertNativeButtons(f.panel.querySelectorAll("button"));
  assert.equal(f.panel.querySelectorAll(".qiaomu-reader-hl-item").length, 2);
  f.panel.querySelector(".qiaomu-reader-hl-export").click();
  assert.equal(state.exported, 1);
  f.panel.querySelector(".qiaomu-reader-hl-more").click();
  assert.equal(state.menus.length, 1);
  assert.deepEqual(state.jumped, []);
  const body = f.panel.querySelector(".qiaomu-reader-hl-body");
  body.focus(); body.querySelector("span").click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(state.jumped, ["one"]);
  assert.equal(f.window.document.activeElement, f.areaEl);
  f.window.close();
});

test("keyboard-origin more menu anchors to its control and restores focus after cancellation", async () => {
  const f = fixture(), state = highlights(f, sample);
  const more = f.panel.querySelector(".qiaomu-reader-hl-more");
  more.getBoundingClientRect = () => ({ left: 120, bottom: 240 });
  more.focus(); more.click();
  assert.equal(state.menus[0].position.x, 120);
  assert.equal(state.menus[0].position.y, 240);
  assert.equal(state.menus[0].document, f.window.document);
  f.areaEl.focus(); state.menus[0].hide();
  await new Promise((resolve) => f.window.setTimeout(resolve, 10));
  assert.equal(f.window.document.activeElement, more);
  assert.deepEqual(state.jumped, []);
  f.window.close();
});

test("deleting a focused highlight returns to its neighbor, then the empty-state close control", () => {
  const f = fixture(), state = highlights(f, sample);
  let del = f.panel.querySelector(".qiaomu-reader-hl-del");
  del.focus(); del.click();
  assert.deepEqual(state.removed, ["one"]);
  assert.deepEqual(state.jumped, []);
  assert.equal(f.window.document.activeElement, f.panel.querySelector(".qiaomu-reader-hl-body"));
  assert.equal(f.window.document.activeElement.textContent, "Second passage");
  del = f.panel.querySelector(".qiaomu-reader-hl-del");
  del.focus(); del.click();
  assert.deepEqual(state.removed, ["one", "two"]);
  assert.equal(f.panel.querySelector(".qiaomu-reader-hl-item"), null);
  assert.equal(f.window.document.activeElement.textContent, "close");
  f.window.document.activeElement.click();
  assert.equal(state.closed, 1);
  assert.equal(f.window.document.activeElement, f.areaEl);
  f.window.close();
});

test("Escape closes empty and populated highlights, except during composition", () => {
  for (const entries of [[], sample]) {
    const f = fixture(), state = highlights(f, entries);
    const button = f.panel.querySelector("button");
    button.focus(); f.key(button, "Escape", { isComposing: true });
    assert.equal(state.closed, 0);
    f.key(button, "Escape");
    assert.equal(state.closed, 1);
    assert.equal(f.window.document.activeElement, f.areaEl);
    f.window.close();
  }
});

test("opening reading panels enters their controls and cancellation returns to the original trigger", () => {
  const f = fixture();
  const other = f.window.document.createElement("section");
  other.innerHTML = "<button>Close highlights</button>";
  f.window.document.body.append(other);
  f.panel.innerHTML = "<button>Bookmark</button><button>Close contents</button>";
  const view = { areaEl: f.areaEl, tocPan: f.panel, hlPan: other };
  const helpers = vm.runInNewContext(`${slice("function focusOpenedReaderPanel(", "async function jumpToAiQuote(")}; ({ focusOpenedReaderPanel, restoreReaderPanelFocus })`);
  f.trigger.focus();
  helpers.focusOpenedReaderPanel(view, "toc");
  assert.equal(f.window.document.activeElement, f.panel.querySelector("button"));
  assert.equal(view._panelReturnFocus, f.trigger);
  helpers.focusOpenedReaderPanel(view, "highlights");
  assert.equal(f.window.document.activeElement, other.querySelector("button"));
  assert.equal(view._panelReturnFocus, f.trigger);
  helpers.restoreReaderPanelFocus(view);
  assert.equal(f.window.document.activeElement, f.trigger);
  // Closing a panel must not steal focus after an action already moved it.
  f.areaEl.focus();
  helpers.restoreReaderPanelFocus(view);
  assert.equal(f.window.document.activeElement, f.areaEl);
  // A toolbar may be rebuilt while the panel is open; never focus a removed
  // element or leave focus in the now-hidden panel.
  f.trigger.focus(); helpers.focusOpenedReaderPanel(view, "toc");
  f.trigger.remove(); helpers.restoreReaderPanelFocus(view);
  assert.equal(f.window.document.activeElement, f.areaEl);
  f.window.close();
});

test("highlight Close and Escape restore the opening control when it still exists", () => {
  const f = fixture(), state = highlights(f, sample);
  state.owner._panelReturnFocus = f.trigger;
  const button = f.panel.querySelector("button");
  button.focus(); f.key(button, "Escape");
  assert.equal(state.closed, 1);
  assert.equal(f.window.document.activeElement, f.trigger);
  f.window.close();
});

test("both history implementations expose native buttons and restore reading focus", () => {
  const f = fixture(), restored = [];
  const snap = { percent: 30, ts: 1770000000000 };
  const owner = { areaEl: f.areaEl, _histRow: f.panel, file: { path: "book.pdf" }, plugin: { getBackups: () => [snap] }, _restoreHistorySnapshot: (entry) => restored.push(entry), _syncHistoryBadge() {}, _historyChipLabel: () => "30% · Today" };
  const context = { ...f.context, qiaomuReaderLocale: () => "en" };
  const add = vm.runInNewContext(`({${slice("  _addHistoryChip(row, snap) {", "  _restoreHistorySnapshot(snap) {")}})._addHistoryChip`, context);
  add.call(owner, f.panel, snap);
  let chip = f.panel.querySelector(".qiaomu-reader-hist-chip");
  assertNativeButtons([chip]); chip.focus(); chip.click();
  assert.equal(f.window.document.activeElement, f.areaEl);
  const modalStart = source.lastIndexOf("  _renderHistory() {");
  const render = vm.runInNewContext(`({${slice("  _renderHistory() {", "  _syncHistoryBadge(count) {", modalStart)}})._renderHistory`, context);
  render.call(owner);
  chip = f.panel.querySelector(".qiaomu-reader-hist-chip");
  assertNativeButtons([chip]); chip.focus(); chip.click();
  assert.deepEqual(restored, [snap, snap]);
  assert.equal(f.window.document.activeElement, f.areaEl);
  f.window.close();
});
