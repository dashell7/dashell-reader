import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { applyEnglishLearningTheme, clearEnglishLearningTheme } from "../src/english-learning-theme.js";
import { READER_THEMES } from "../src/reader-themes.js";

test("English lookup surfaces use the selected reader palette in each Obsidian window", () => {
  const primary = new JSDOM("<!doctype html><body></body>").window.document;
  const detached = new JSDOM("<!doctype html><body></body>").window.document;
  for (const doc of [primary, detached]) {
    applyEnglishLearningTheme(doc, { theme: "warm" });
    assert.equal(doc.body.dataset.qiaomuEnglishTheme, "warm");
    assert.equal(doc.body.style.getPropertyValue("--qiaomu-english-bg"), READER_THEMES.warm.bg);
    assert.equal(doc.body.style.getPropertyValue("--qiaomu-english-text"), READER_THEMES.warm.text);
  }

  applyEnglishLearningTheme(primary, { theme: "night" });
  assert.equal(primary.body.style.getPropertyValue("--qiaomu-english-bg"), READER_THEMES.night.bg);
  assert.equal(detached.body.style.getPropertyValue("--qiaomu-english-bg"), READER_THEMES.warm.bg);

  applyEnglishLearningTheme(primary, { theme: "auto" });
  assert.equal(primary.body.dataset.qiaomuEnglishTheme, undefined);
  assert.equal(primary.body.style.getPropertyValue("--qiaomu-english-bg"), "");

  applyEnglishLearningTheme(primary, { theme: "warm", einkMode: true });
  assert.equal(primary.body.dataset.qiaomuEnglishTheme, "eink");
  assert.equal(primary.body.style.getPropertyValue("--qiaomu-english-text"), READER_THEMES.eink.text);

  clearEnglishLearningTheme(primary);
  clearEnglishLearningTheme(detached);
  assert.equal(primary.body.style.getPropertyValue("--qiaomu-english-text"), "");
  assert.equal(detached.body.dataset.qiaomuEnglishTheme, undefined);
});
