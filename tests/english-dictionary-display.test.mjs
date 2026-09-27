import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const contentSource = fs.readFileSync(new URL("../src/english-dictionary-modal.js", import.meta.url), "utf8")
  .replace(/^import .*\r?\n/gm, "")
  .replace(/^export /gm, "");
const viewSource = fs.readFileSync(new URL("../src/english-dictionary-view.js", import.meta.url), "utf8")
  .replace(/^import .*\r?\n/gm, "")
  .replace(/^export /gm, "");

function setup(lookup) {
  const dom = new JSDOM("<!doctype html><html><body><div id='dictionary'></div><div id='review'></div></body></html>", { pretendToBeVisual: true });
  const { document, HTMLElement } = dom.window;
  HTMLElement.prototype.empty = function () { this.replaceChildren(); };
  HTMLElement.prototype.addClass = function (name) { this.classList.add(name); };
  HTMLElement.prototype.createEl = function (tag, options = {}) {
    const element = document.createElement(tag);
    if (options.cls) element.className = options.cls;
    if (options.text) element.textContent = options.text;
    this.appendChild(element);
    return element;
  };
  HTMLElement.prototype.createDiv = function (options = {}) {
    return this.createEl("div", typeof options === "string" ? { cls: options } : options);
  };
  HTMLElement.prototype.createSpan = function (options = {}) { return this.createEl("span", options); };
  class ItemView {
    constructor(leaf) { this.leaf = leaf; this.contentEl = leaf.contentEl; }
  }
  const api = vm.runInNewContext(`${contentSource}\n${viewSource}\n({ EnglishDictionaryContent, EnglishReviewContent, EnglishDictionaryView, EnglishReviewView })`, {
    Modal: class {}, ItemView, AbortController,
    lookupEnglishWord: lookup,
    normalizeEnglishLookup: (value) => String(value || "").trim(),
    setIcon: (element, icon) => { element.textContent = icon; },
  });
  return { dom, api };
}

test("left dictionary and right review form stay separate across rapid lookups", async () => {
  const pending = new Map();
  const { dom, api } = setup((word) => new Promise((resolve) => pending.set(word, resolve)));
  const plugin = {
    settings: { language: "zh" },
    addEnglishReviewCard: async () => true,
    openEnglishDictionaryWeb: () => {},
    updateEnglishReviewPanel: (update) => review.update(update),
  };
  const review = new api.EnglishReviewView({ contentEl: dom.window.document.querySelector("#review") }, plugin, () => "学习新单词");
  const dictionary = new api.EnglishDictionaryView({ contentEl: dom.window.document.querySelector("#dictionary") }, plugin, () => "查词面板");
  review.onOpen();
  dictionary.onOpen();
  dictionary.lookup("first", { sentence: "The first sentence." });
  dictionary.lookup("second", { sentence: "The second sentence." });
  pending.get("second")({ word: "second", meanings: ["新词释义"], examples: [] });
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  pending.get("first")({ word: "first", meanings: ["旧词释义"], examples: [] });
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  const left = dom.window.document.querySelector("#dictionary");
  const right = dom.window.document.querySelector("#review");
  assert.equal(left.querySelector("input").value, "second");
  assert.match(left.textContent, /新词释义/);
  assert.equal(left.querySelectorAll("textarea").length, 0);
  assert.equal(right.querySelector("input").value, "second");
  assert.equal(right.querySelector("textarea").value, "新词释义");
  assert.equal(right.querySelectorAll(".qiaomu-reader-dictionary-result").length, 0);
  assert.doesNotMatch(right.textContent, /旧词释义/);
  assert.equal(right.querySelectorAll(".qiaomu-reader-review").length, 1);
  dictionary.onClose();
  review.onClose();
  dom.window.close();
});

test("review form submits the edited word, meaning and source sentence", async () => {
  const saved = [];
  const { dom, api } = setup(async () => ({ word: "curious", meanings: ["好奇的"], examples: [] }));
  const content = new api.EnglishReviewContent(dom.window.document.querySelector("#review"), {
    settings: () => ({ language: "zh" }),
    onAddReview: async (card) => { saved.push(card); return true; },
  });
  content.mount();
  content.setQuery("curious", "A curious reader.");
  content.setResult({ word: "curious", meanings: ["好奇的"] });
  content.meaningInput.value = "求知欲强的";
  await content.save();
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), [{
    word: "curious", meanings: ["求知欲强的"], sentence: "A curious reader.",
  }]);
  content.destroy();
  dom.window.close();
});
