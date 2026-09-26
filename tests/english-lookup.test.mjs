import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const source = fs.readFileSync(new URL("../src/english-lookup.js", import.meta.url), "utf8")
  .replace(/^import .*\r?\n/m, "")
  .replace(/^export /gm, "");

function setup(options = {}) {
  const dom = new JSDOM("<!doctype html><html><body><p>reader word</p></body></html>", { pretendToBeVisual: true });
  const context = {
    document: dom.window.document, window: dom.window, AbortController, setTimeout, clearTimeout,
    requestUrl: options.request || (async () => ({ json: { ec: { word: [{ trs: [{ tran: "释义" }] }] } } })),
    setIcon: (el, icon) => { el.textContent = icon; },
  };
  const api = vm.runInNewContext(`${source}\n({EnglishLookupController, lookupEnglishWord, normalizeEnglishLookup, parseYoudaoResult, sentenceFromTarget, wordAtPoint, wordFromTextAtOffset})`, context);
  const opened = [];
  const controller = new api.EnglishLookupController({
    hostDocument: dom.window.document,
    settings: () => ({ englishLookupEnabled: true, englishClickLookup: true, englishLookupProvider: "youdao", language: "zh" }),
    request: context.requestUrl,
    onAddReview: options.onAddReview,
    onOpenDictionary: (word, context) => opened.push({ word, context }),
  });
  return { dom, api, controller, opened };
}

test("Youdao accepts the object form returned by the live endpoint", () => {
  const { dom, api, controller } = setup();
  assert.equal(api.parseYoudaoResult({ ec: { word: { trs: [{ pos: "adj.", tran: "好奇的" }] } } })[0], "好奇的");
  assert.equal(api.parseYoudaoResult({ ec: { word: [{ trs: [{ tran: "好奇的" }] }] } })[0], "好奇的");
  controller.destroy(); dom.window.close();
});

test("Youdao detail lookup carries pronunciation and plain-text examples", async () => {
  const payload = { ec: { word: { usphone: "test-phonetic", trs: [{ tran: "好奇的" }] } }, blng_sents_part: { "sentence-pair": [{ sentence: "A curious reader.", "sentence-translation": "一位好奇的读者。" }] } };
  const { dom, api, controller } = setup();
  const result = await api.lookupEnglishWord("curious", { englishLookupProvider: "youdao" }, { request: async () => ({ json: payload }) });
  assert.equal(result.phonetic, "test-phonetic");
  assert.equal(result.examples[0].text, "A curious reader.");
  assert.equal(result.examples[0].translation, "一位好奇的读者。");
  controller.destroy(); dom.window.close();
});

test("nearby whitespace does not count as hovering over the preceding word", () => {
  const { dom, api, controller } = setup();
  const doc = dom.window.document;
  const node = doc.querySelector("p").firstChild;
  doc.caretRangeFromPoint = () => ({ startContainer: node, startOffset: 6 });
  doc.createRange = () => ({
    setStart() {}, setEnd() {},
    getClientRects: () => [{ left: 10, right: 50, top: 10, bottom: 30 }],
  });
  assert.equal(api.wordAtPoint(doc, 55, 20), "");
  assert.equal(api.wordAtPoint(doc, 25, 20), "reader");
  controller.destroy(); dom.window.close();
});

test("a PDF text span supplies the source sentence", () => {
  const { dom, api, controller } = setup();
  const layer = dom.window.document.createElement("div");
  layer.className = "qiaomu-reader-pdf-text-layer";
  const line = layer.appendChild(dom.window.document.createElement("span"));
  line.textContent = "The curious reader found a quiet garden.";
  dom.window.document.body.appendChild(layer);
  assert.equal(api.sentenceFromTarget(line), line.textContent);
  controller.destroy(); dom.window.close();
});

test("hover lookup uses the compact three-meaning popup and ignores an older response", async () => {
  const pending = new Map();
  const { dom, controller } = setup({ request: ({ url }) => new Promise(resolve => pending.set(new URL(url).searchParams.get("q"), resolve)) });
  const first = controller.show("first", { x: 100, y: 100 });
  const second = controller.show("second", { x: 100, y: 100 });
  pending.get("second")({ json: { ec: { word: [{ trs: ["one", "two", "three", "four"].map(tran => ({ tran })) }] } } });
  await second;
  pending.get("first")({ json: { ec: { word: [{ trs: [{ tran: "stale" }] }] } } });
  await first;
  const popup = dom.window.document.querySelector(".qiaomu-reader-dict-popup");
  assert.equal(popup.querySelectorAll(".qiaomu-reader-dict-meaning").length, 3);
  assert.match(popup.textContent, /one/);
  assert.doesNotMatch(popup.textContent, /stale|four/);
  assert.equal(popup.querySelectorAll(".qiaomu-reader-dict-actions button").length, 3);
  assert.equal(popup.querySelector(".qiaomu-reader-dict-header"), null);
  controller.destroy(); dom.window.close();
});

test("click lookup consumes navigation and opens the full dictionary with sentence context", async () => {
  const { dom, controller, opened } = setup();
  const doc = dom.window.document;
  const paragraph = doc.querySelector("p");
  doc.caretRangeFromPoint = () => ({ startContainer: paragraph.firstChild, startOffset: 2 });
  let pageClicks = 0;
  paragraph.addEventListener("click", () => pageClicks++);
  controller.attach(doc, { scope: paragraph });
  const event = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, clientX: 50, clientY: 50 });
  paragraph.dispatchEvent(event);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(event.defaultPrevented, true);
  assert.equal(pageClicks, 0);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].word, "reader");
  assert.equal(opened[0].context.sentence, "reader word");
  controller.destroy(); dom.window.close();
});

test("a failed review action in the hover popup can be retried", async () => {
  const { dom, controller } = setup({ onAddReview: async () => { throw new Error("write failed"); } });
  controller.lookupText("reader", { left: 50, top: 50 });
  await new Promise(resolve => setTimeout(resolve, 0));
  const doc = dom.window.document;
  const review = doc.querySelector(".qiaomu-reader-dict-review");
  review.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(review.disabled, false);
  assert.equal(review.textContent.includes("加入失败"), true);
  controller.destroy(); dom.window.close();
});
