const APPEARANCE_KEYS = Object.freeze([
  "theme",
  "einkMode",
  "fontFamily",
  "customFontFamily",
  "customFontId",
  "fontSize",
  "lineHeight",
]);

function isAppearanceRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function aiReadingAppearance(settings) {
  const custom = settings.aiAppearance;
  const effective = { ...settings };
  if (isAppearanceRecord(custom)) {
    for (const key of APPEARANCE_KEYS) {
      if (custom[key] !== undefined) effective[key] = custom[key];
    }
  }
  effective.fontSize = Math.min(32, Math.max(12, Number(effective.fontSize) || 18));
  effective.lineHeight = Math.min(2.2, Math.max(1.4, Number(effective.lineHeight) || 1.8));
  return effective;
}

export function setAiAppearanceFollowing(settings, follow) {
  if (follow) {
    settings.aiAppearance = null;
    return;
  }
  const effective = aiReadingAppearance(settings);
  settings.aiAppearance = Object.fromEntries(APPEARANCE_KEYS.map((key) => [key, effective[key]]));
}

export function editableAiAppearance(settings) {
  if (!isAppearanceRecord(settings.aiAppearance)) settings.aiAppearance = {};
  return new Proxy(settings.aiAppearance, {
    get(target, key) {
      return key === "importedFonts" ? settings.importedFonts : target[key];
    },
    set(target, key, value) {
      if (key === "importedFonts") settings.importedFonts = value;
      else target[key] = value;
      return true;
    },
  });
}
