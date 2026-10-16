import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { aiReadingAppearance, editableAiAppearance, setAiAppearanceFollowing } from "../src/ai-appearance.js";

test("existing settings follow book appearance until the user opts out", () => {
  const settings = { theme: "paper", fontFamily: "zhuque", fontSize: 18, lineHeight: 1.8 };
  assert.equal(aiReadingAppearance(settings).theme, "paper");
  settings.theme = "night";
  settings.fontSize = 22;
  assert.equal(aiReadingAppearance(settings).theme, "night");
  assert.equal(aiReadingAppearance(settings).fontSize, 22);
});

test("independent companion appearance persists without changing book settings", () => {
  const settings = { theme: "paper", fontFamily: "zhuque", fontSize: 18, lineHeight: 1.8, importedFonts: [] };
  setAiAppearanceFollowing(settings, false);
  const appearance = editableAiAppearance(settings);
  appearance.theme = "black";
  appearance.fontSize = 24;
  appearance.fontFamily = "custom";
  appearance.customFontFamily = "Songti SC";

  assert.equal(settings.theme, "paper");
  assert.equal(settings.fontSize, 18);
  const restored = JSON.parse(JSON.stringify(settings));
  assert.equal(aiReadingAppearance(restored).theme, "black");
  assert.equal(aiReadingAppearance(restored).fontSize, 24);
  assert.equal(aiReadingAppearance(restored).customFontFamily, "Songti SC");

  restored.theme = "warm";
  setAiAppearanceFollowing(restored, true);
  assert.equal(aiReadingAppearance(restored).theme, "warm");
});

test("custom font files remain shared while reader and companion font selections are independent", () => {
  const settings = { fontFamily: "zhuque", customFontId: "book-font", importedFonts: [{ id: "book-font" }] };
  setAiAppearanceFollowing(settings, false);
  const appearance = editableAiAppearance(settings);
  appearance.importedFonts = [...appearance.importedFonts, { id: "companion-font" }];
  appearance.customFontId = "companion-font";

  assert.equal(settings.importedFonts.length, 2);
  assert.equal(settings.customFontId, "book-font");
  assert.equal(aiReadingAppearance(settings).customFontId, "companion-font");
  assert.equal(aiReadingAppearance(settings).importedFonts, settings.importedFonts);
});

test("malformed saved typography is clamped for display without rewriting stored values", () => {
  const settings = { fontSize: 18, lineHeight: 1.8, aiAppearance: { fontSize: 999, lineHeight: -1 } };
  assert.equal(aiReadingAppearance(settings).fontSize, 32);
  assert.equal(aiReadingAppearance(settings).lineHeight, 1.4);
  assert.equal(settings.aiAppearance.fontSize, 999);
});

test("AI appearance controls are available with or without a configured provider", () => {
  const source = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const readerSettings = source.slice(source.indexOf("_drawAi(c)"), source.indexOf("onOpen() {", source.indexOf("_drawAi(c)")));
  const providerSettings = source.slice(source.indexOf("_groupAi(c"), source.indexOf("_settingsDisclosure(host", source.indexOf("_groupAi(c")));
  assert.match(readerSettings, /buildAiAppearanceSettings\(c, plugin\)/);
  assert.match(providerSettings, /if \(!cfg\.provider\)[\s\S]*buildAiAppearanceSettings\(c, plugin\)/);
  assert.match(providerSettings, /if \(!options\.enableOnSuccess\) buildAiAppearanceSettings\(c, plugin\)/);
});
