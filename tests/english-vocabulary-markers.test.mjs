import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  createVocabularyStatusIndex,
  EnglishVocabularyMarkerService,
  normalizeVocabularyWord,
} from "../src/learning/english-vocabulary-markers.js";

function markedWindow(html) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { pretendToBeVisual: true });
  class TestHighlight extends Set {}
  Object.defineProperty(dom.window, "CSS", { value: { highlights: new Map() } });
  Object.defineProperty(dom.window, "Highlight", { value: TestHighlight });
  return dom;
}

function markedText(window, name) {
  return [...window.CSS.highlights.get(name) || []].map((range) => range.toString());
}

test("vocabulary index includes only active word states and their explicit aliases", () => {
  const index = createVocabularyStatusIndex([
    { t: "WORD", expression: "Protocol", aliases: ["protocols", "protocol’s"], status: 1 },
    { t: "WORD", expression: "familiar", aliases: [], status: 2 },
    { t: "WORD", expression: "known", aliases: [], status: 3 },
    { t: "WORD", expression: "learned", aliases: [], status: 4 },
    { t: "WORD", expression: "ignored", aliases: [], status: 0 },
    { t: "PHRASE", expression: "in fact", aliases: [], status: 1 },
    { t: "WORD", expression: "bad key", aliases: ["safe"], status: 1 },
  ]);

  assert.equal(normalizeVocabularyWord("  Protocol’s "), "protocol's");
  assert.equal(index.get("protocol"), 1);
  assert.equal(index.get("protocols"), 1);
  assert.equal(index.get("protocol's"), 1);
  assert.equal(index.get("familiar"), 2);
  assert.equal(index.has("known"), false);
  assert.equal(index.has("learned"), false);
  assert.equal(index.has("ignored"), false);
  assert.equal(index.has("in fact"), false);
  assert.equal(index.has("safe"), false);
});

test("reader marking uses native text ranges without rewriting content or touching controls", async () => {
  const dom = markedWindow(`<main id="flow">
    <p>Protocol, protocol and protocols.</p>
    <p>Familiar and Known.</p>
    <code>protocol</code>
    <div class="qiaomu-reader-dict-popup">protocol</div>
  </main>`);
  const { document, CSS } = dom.window;
  const flow = document.querySelector("#flow");
  const original = flow.innerHTML;
  const service = new EnglishVocabularyMarkerService({
    waitForReady: async () => {},
    getAllExpressionSimple: async () => [
      { t: "WORD", expression: "protocol", aliases: ["protocols"], status: 1 },
      { t: "WORD", expression: "familiar", aliases: [], status: 2 },
      { t: "WORD", expression: "known", aliases: [], status: 3 },
    ],
  }, dom.window);
  const detach = service.attach(flow);
  await service.refreshNow();

  assert.deepEqual(markedText(dom.window, "qiaomu-reader-vocabulary-learning"), ["Protocol", "protocol", "protocols"]);
  assert.deepEqual(markedText(dom.window, "qiaomu-reader-vocabulary-familiar"), ["Familiar"]);
  assert.equal(flow.innerHTML, original);
  assert.equal(CSS.highlights.size, 2);

  detach();
  assert.equal(CSS.highlights.size, 0);
  assert.equal(document.getElementById("qiaomu-reader-english-vocabulary-styles"), null);
  service.dispose();
  dom.window.close();
});

test("vocabulary changes refresh existing marks and added text is rescanned", async () => {
  const dom = markedWindow(`<main id="flow"><p>Read protocol.</p></main>`);
  const { document } = dom.window;
  let records = [{ t: "WORD", expression: "protocol", aliases: [], status: 1 }];
  const service = new EnglishVocabularyMarkerService({
    waitForReady: async () => {},
    getAllExpressionSimple: async () => records,
  }, dom.window);
  const detach = service.attach(document.querySelector("#flow"));
  await service.refreshNow();
  assert.deepEqual(markedText(dom.window, "qiaomu-reader-vocabulary-learning"), ["protocol"]);

  records = [
    { t: "WORD", expression: "protocol", aliases: [], status: 2 },
    { t: "WORD", expression: "familiar", aliases: [], status: 2 },
  ];
  dom.window.dispatchEvent(new dom.window.CustomEvent("qiaomu-english-event-refresh"));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 180));
  assert.equal(dom.window.CSS.highlights.has("qiaomu-reader-vocabulary-learning"), false);
  assert.deepEqual(markedText(dom.window, "qiaomu-reader-vocabulary-familiar"), ["protocol"]);

  document.querySelector("#flow p").append(" familiar");
  await new Promise((resolve) => dom.window.setTimeout(resolve, 180));
  assert.deepEqual(markedText(dom.window, "qiaomu-reader-vocabulary-familiar"), ["protocol", "familiar"]);

  detach();
  service.dispose();
  dom.window.close();
});

test("removed reader text is dropped from the active highlight ranges", async () => {
  const dom = markedWindow('<main id="flow"><p>Protocol remains.</p><p id="remove">Protocol leaves.</p></main>');
  const { document } = dom.window;
  const service = new EnglishVocabularyMarkerService({
    waitForReady: async () => {},
    getAllExpressionSimple: async () => [{ t: "WORD", expression: "protocol", aliases: [], status: 1 }],
  }, dom.window);
  const detach = service.attach(document.querySelector("#flow"));
  await service.refreshNow();
  assert.equal(markedText(dom.window, "qiaomu-reader-vocabulary-learning").length, 2);

  document.querySelector("#remove").remove();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 180));
  assert.deepEqual(markedText(dom.window, "qiaomu-reader-vocabulary-learning"), ["Protocol"]);

  detach();
  service.dispose();
  dom.window.close();
});

test("replacing marked Latin text with non-Latin text clears the previous range", async () => {
  const dom = markedWindow('<main id="flow"><p id="text">Protocol.</p></main>');
  const { document } = dom.window;
  const service = new EnglishVocabularyMarkerService({
    waitForReady: async () => {},
    getAllExpressionSimple: async () => [{ t: "WORD", expression: "protocol", aliases: [], status: 1 }],
  }, dom.window);
  const detach = service.attach(document.querySelector("#flow"));
  await service.refreshNow();
  assert.equal(markedText(dom.window, "qiaomu-reader-vocabulary-learning").length, 1);

  document.querySelector("#text").textContent = "阅读结束。";
  await new Promise((resolve) => dom.window.setTimeout(resolve, 180));
  assert.equal(dom.window.CSS.highlights.has("qiaomu-reader-vocabulary-learning"), false);

  detach();
  service.dispose();
  dom.window.close();
});

test("closing one reading document releases only its own marks", async () => {
  const first = markedWindow("<main><p>Protocol one.</p></main>");
  const second = markedWindow("<main><p>Protocol two.</p></main>");
  const service = new EnglishVocabularyMarkerService({
    waitForReady: async () => {},
    getAllExpressionSimple: async () => [{ t: "WORD", expression: "protocol", aliases: [], status: 2 }],
  }, first.window);
  const detachFirst = service.attach(first.window.document.querySelector("main"));
  const detachSecond = service.attach(second.window.document.querySelector("main"));
  await service.refreshNow();
  assert.deepEqual(markedText(first.window, "qiaomu-reader-vocabulary-familiar"), ["Protocol"]);
  assert.deepEqual(markedText(second.window, "qiaomu-reader-vocabulary-familiar"), ["Protocol"]);

  detachFirst();
  assert.equal(first.window.CSS.highlights.has("qiaomu-reader-vocabulary-familiar"), false);
  assert.deepEqual(markedText(second.window, "qiaomu-reader-vocabulary-familiar"), ["Protocol"]);

  detachSecond();
  service.dispose();
  first.window.close();
  second.window.close();
});

test("vocabulary changes while no document is open invalidate the cached index", async () => {
  const dom = markedWindow('<main id="first"><p>Protocol stays.</p></main><main id="second"><p>Protocol again.</p></main>');
  const { document } = dom.window;
  let records = [{ t: "WORD", expression: "protocol", aliases: [], status: 1 }];
  const service = new EnglishVocabularyMarkerService({
    waitForReady: async () => {},
    getAllExpressionSimple: async () => records,
  }, dom.window);
  const first = service.attach(document.querySelector("#first"));
  await service.ensureIndex();
  assert.deepEqual(markedText(dom.window, "qiaomu-reader-vocabulary-learning"), ["Protocol"]);

  first();
  records = [];
  service.invalidateIndex();
  const second = service.attach(document.querySelector("#second"));
  await service.ensureIndex();

  assert.equal(service.index.size, 0);
  assert.equal(dom.window.CSS.highlights.has("qiaomu-reader-vocabulary-learning"), false);
  second();
  service.dispose();
  dom.window.close();
});
