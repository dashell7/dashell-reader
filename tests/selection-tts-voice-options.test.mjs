import assert from "node:assert/strict";
import test from "node:test";
import { prepareSpeechLanguages, prepareSpeechVoices, speechTestSample, speechVoicesForLocale } from "../src/selection-tts-voice-options.js";

const translate = key => ({
  "tts-voice-female": "女声", "tts-voice-male": "男声", "tts-voice-neutral": "中性声音",
})[key];

test("Chinese voice choices show localized language, region, gender and native names", () => {
  const voices = [
    { id: "af-ZA-AdriNeural", name: "Adri", locale: "af-ZA", gender: "Female" },
    { id: "en-US-GuyNeural", name: "Guy", locale: "en-US", gender: "Male" },
    { id: "zh-CN-XiaoxiaoNeural", name: "Xiaoxiao", localName: "晓晓", locale: "zh-CN", gender: "Female" },
    { id: "en-US-JennyNeural", name: "Jenny", locale: "en-US", localeName: "English (United States)", gender: "Female" },
  ];
  const choices = prepareSpeechVoices(voices, "zh", translate, "en-US-JennyNeural");
  assert.deepEqual(choices.map(voice => voice.id), [
    "en-US-JennyNeural", "en-US-GuyNeural", "af-ZA-AdriNeural", "zh-CN-XiaoxiaoNeural",
  ]);
  assert.equal(choices[0].label, "Jenny · 英语（美国） · 女声");
  assert.equal(choices[1].label, "Guy · 英语（美国） · 男声");
  assert.equal(choices[2].label, "Adri · 南非荷兰语（南非） · 女声");
  assert.equal(choices[3].label, "晓晓 · 中文（中国） · 女声");
  assert.match(choices[0].searchText, /英语（美国）.*en-US-JennyNeural/);
  assert.match(choices[3].searchText, /晓晓.*Xiaoxiao.*中文（中国）/);
});

test("voice choices retain provider names and IDs when locale metadata is unavailable", () => {
  const choices = prepareSpeechVoices([{ id: "custom-1", name: "Reader" }], "zh", translate);
  assert.equal(choices[0].label, "Reader");
  assert.equal(choices[0].searchText, "Reader custom-1");
});

test("test language choices include every available locale, including multilingual voice locales", () => {
  const voices = [
    { id: "en-US-AvaMultilingualNeural", locale: "en-US", secondaryLocales: ["fr-FR", "zh-CN"] },
    { id: "ja-JP-NanamiNeural", locale: "ja-JP" },
  ];
  const choices = prepareSpeechLanguages(voices, "zh", "zh-CN");
  assert.equal(choices[0].id, "zh-CN");
  assert.deepEqual(new Set(choices.map(choice => choice.id)), new Set(["zh-CN", "en-US", "fr-FR", "ja-JP"]));
  assert.match(choices[0].searchText, /中文.*zh-CN/);
  assert.deepEqual(speechVoicesForLocale(voices, "zh-CN").map(voice => voice.id), ["en-US-AvaMultilingualNeural"]);
  assert.deepEqual(speechVoicesForLocale(voices, "ja-JP").map(voice => voice.id), ["ja-JP-NanamiNeural"]);
});

test("voices native to the chosen test language appear before multilingual alternatives", () => {
  const voices = [
    { id: "en-US-AvaMultilingualNeural", name: "Ava", locale: "en-US", secondaryLocales: ["zh-CN"] },
    { id: "zh-CN-XiaoxiaoNeural", name: "Xiaoxiao", locale: "zh-CN" },
  ];
  const choices = prepareSpeechVoices(speechVoicesForLocale(voices, "zh-CN"), "zh", translate, "", "zh-CN");
  assert.deepEqual(choices.map(voice => voice.id), ["zh-CN-XiaoxiaoNeural", "en-US-AvaMultilingualNeural"]);
});

test("test phrases follow the selected language and never substitute an English phrase for an unknown locale", () => {
  assert.match(speechTestSample("zh-CN"), /阳光/);
  assert.match(speechTestSample("fr-FR"), /lumière|soleil/i);
  assert.match(speechTestSample("ar-SA"), /[\u0600-\u06ff]/u);
  assert.equal(speechTestSample("af-ZA"), "Afrikaans");
});
