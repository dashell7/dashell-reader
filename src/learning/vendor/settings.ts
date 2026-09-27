// ── settings.ts ───────────────────────────────────────────────────────────
// Barrel re-export for backward compatibility.
// Internal modules should import directly from settings/types, settings/defaults,
// or settings/SettingTab to avoid pulling in unnecessary dependencies.

export type { HoverTranslationProvider, MyPluginSettings, ReadingWidthMode } from "./settings/types";
export { AI_PROVIDERS } from "./settings/types";
export { DEFAULT_SETTINGS } from "./settings/defaults";
export { SettingTab } from "./settings/SettingTab";
export {
    cloneDefaultSettings,
    normalizeDictionaryFontSize,
    normalizeDictionaryHeight,
    normalizeLineHeight,
    normalizeReadingFontSize,
    normalizeReadingSideSpacing,
    normalizeSettings,
} from "./settings/validation";
