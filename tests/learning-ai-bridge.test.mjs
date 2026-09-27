import test from "node:test";
import assert from "node:assert/strict";
import { englishLearningAiRequest } from "../src/learning/qiaomu-ai.js";

test("dictionary AI keeps its learning prompt and sends only the queried word", () => {
  assert.deepEqual(englishLearningAiRequest("definition", "  curious  ", "Explain English words in Chinese"), {
    systemPrompt: "Explain English words in Chinese",
    userPrompt: "curious",
  });
});

test("sentence AI translation uses its prompt without sending book context", () => {
  assert.deepEqual(englishLearningAiRequest("translation", "A quiet garden.", "翻译成中文：{sentence}"), {
    systemPrompt: "Translate the supplied sentence accurately. Follow the requested target language and return only the translation.",
    userPrompt: "翻译成中文：A quiet garden.",
  });
  assert.equal(
    englishLearningAiRequest("translation", "A quiet garden.", "Translate to French").userPrompt,
    "Translate to French\n\nA quiet garden.",
  );
});

test("learning AI rejects empty, oversized and unknown tasks before a model call", () => {
  assert.throws(() => englishLearningAiRequest("definition", " ", ""), /empty or too long/);
  assert.throws(() => englishLearningAiRequest("translation", "x".repeat(4001), ""), /empty or too long/);
  assert.throws(() => englishLearningAiRequest("chat", "word", ""), /Unknown/);
});
