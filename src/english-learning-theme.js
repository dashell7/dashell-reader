import { READER_THEMES, migrateReaderTheme } from "./reader-themes.js";

const THEME_PROPERTIES = ["bg", "text", "ui", "border", "accent", "muted"];

export function clearEnglishLearningTheme(doc) {
  const body = doc?.body;
  if (!body) return;
  delete body.dataset.qiaomuEnglishTheme;
  for (const role of THEME_PROPERTIES) body.style.removeProperty(`--qiaomu-english-${role}`);
}

export function applyEnglishLearningTheme(doc, settings) {
  const body = doc?.body;
  if (!body) return;
  const id = settings?.einkMode ? "eink" : migrateReaderTheme(settings?.theme);
  if (id === "auto") {
    clearEnglishLearningTheme(doc);
    return;
  }
  if (body.dataset.qiaomuEnglishTheme === id) return;
  const palette = READER_THEMES[id];
  body.dataset.qiaomuEnglishTheme = id;
  for (const role of THEME_PROPERTIES) body.style.setProperty(`--qiaomu-english-${role}`, palette[role]);
}
