import assert from "node:assert/strict";
import test from "node:test";
import { detectSpeechLanguage, selectAzureSpeechVoice, splitSpeechLanguageRuns } from "../src/selection-tts-language.js";

test("mixed Latin and East Asian text retains each spoken run in order", () => {
  assert.deepEqual(splitSpeechLanguageRuns("Read it 读出来吧。"), [
    { text: "Read it", script: "latin", language: null },
    { text: "读出来吧。", script: "east-asian", language: "zh" },
  ]);
  assert.deepEqual(splitSpeechLanguageRuns("请读 Read it."), [
    { text: "请读", script: "east-asian", language: "zh" },
    { text: "Read it.", script: "latin", language: null },
  ]);
  assert.deepEqual(splitSpeechLanguageRuns("日本語を読みます。"), [
    { text: "日本語を読みます。", script: "east-asian", language: "ja" },
  ]);
  assert.deepEqual(splitSpeechLanguageRuns("中文こんにちは中文"), [
    { text: "中文", script: "east-asian", language: "zh" },
    { text: "こんにちは", script: "east-asian", language: "ja" },
    { text: "中文", script: "east-asian", language: "zh" },
  ]);
  assert.deepEqual(splitSpeechLanguageRuns("中文한국어中文"), [
    { text: "中文", script: "east-asian", language: "zh" },
    { text: "한국어", script: "east-asian", language: "ko" },
    { text: "中文", script: "east-asian", language: "zh" },
  ]);
  assert.deepEqual(splitSpeechLanguageRuns("私は猫です。"), [
    { text: "私は猫です。", script: "east-asian", language: "ja" },
  ]);
  assert.deepEqual(splitSpeechLanguageRuns("مرحبا Hello"), [
    { text: "مرحبا", script: "other", language: null },
    { text: "Hello", script: "latin", language: null },
  ]);
  assert.deepEqual(splitSpeechLanguageRuns("“中文” 한국어"), [
    { text: "“中文”", script: "east-asian", language: "zh" },
    { text: "한국어", script: "east-asian", language: "ko" },
  ]);
});

test("mixed East Asian runs still split on older webviews without Intl.Segmenter", () => {
  const segmenter = Intl.Segmenter;
  Intl.Segmenter = undefined;
  try {
    assert.deepEqual(splitSpeechLanguageRuns("中文こんにちは中文"), [
      { text: "中文", script: "east-asian", language: "zh" },
      { text: "こんにちは", script: "east-asian", language: "ja" },
      { text: "中文", script: "east-asian", language: "zh" },
    ]);
    assert.deepEqual(splitSpeechLanguageRuns("日本語を読みます。"), [
      { text: "日本語を読みます。", script: "east-asian", language: "ja" },
    ]);
  } finally { Intl.Segmenter = segmenter; }
});

test("selected reading text detects clear languages locally", () => {
  assert.equal(detectSpeechLanguage("阳光穿过空中的雨滴，形成一道彩虹。"), "zh");
  assert.equal(detectSpeechLanguage("こんにちは、今日は良い天気です。"), "ja");
  assert.equal(detectSpeechLanguage("The sunlight passes through raindrops and creates a rainbow in the sky."), "en");
  assert.equal(detectSpeechLanguage("La lumière du soleil traverse les gouttes de pluie et forme un arc-en-ciel."), "fr");
});

test("ambiguous short text stays on the chosen voice unless nearby text identifies its language", () => {
  assert.equal(detectSpeechLanguage("bank"), null);
  assert.equal(detectSpeechLanguage("Hello world"), null);
  assert.equal(detectSpeechLanguage("bank", "The bank stands beside the river and the green field."), "en");
  assert.equal(detectSpeechLanguage("12345"), null);
});

test("Azure voice routing retains a matching preference and otherwise picks a standard voice", () => {
  const voices = [
    { id: "en-GB-AlfieNeural", locale: "en-GB", secondaryLocales: [] },
    { id: "en-US-AvaMultilingualNeural", locale: "en-US", secondaryLocales: ["zh-CN"] },
    { id: "zh-CN-Bo:MAI-Voice-2", locale: "zh-CN", secondaryLocales: [] },
    { id: "zh-CN-XiaoxiaoNeural", locale: "zh-CN", secondaryLocales: [], status: "GA" },
  ];
  assert.deepEqual(selectAzureSpeechVoice("en", voices, "en-GB-AlfieNeural"),
    { voice: "en-GB-AlfieNeural", locale: "en-GB" });
  assert.deepEqual(selectAzureSpeechVoice("zh", voices, "en-US-AvaMultilingualNeural"),
    { voice: "en-US-AvaMultilingualNeural", locale: "zh-CN" });
  assert.deepEqual(selectAzureSpeechVoice("zh", voices, "en-GB-AlfieNeural"),
    { voice: "zh-CN-XiaoxiaoNeural", locale: "zh-CN" });
  assert.equal(selectAzureSpeechVoice("fr", voices, "en-GB-AlfieNeural"), null);
});
