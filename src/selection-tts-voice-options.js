import { QIAOMU_READER_EN } from "./i18n-en.js";
import { QIAOMU_READER_ZH_CN } from "./i18n-zh.js";
import { UI_TRANSLATIONS } from "./i18n-languages.js";

const GENDER_KEYS = { Female: "tts-voice-female", Male: "tts-voice-male", Neutral: "tts-voice-neutral" };
const TEST_SAMPLES = {
  zh: QIAOMU_READER_ZH_CN["tts-test-default"], en: QIAOMU_READER_EN["tts-test-default"],
  ...Object.fromEntries(Object.entries(UI_TRANSLATIONS).map(([code, dictionary]) => [code, dictionary["tts-test-default"]])),
  it: "La luce del sole attraversa le gocce di pioggia e forma un arcobaleno.",
  nl: "Zonlicht schijnt door de regendruppels en vormt een regenboog.",
  ar: "يمر ضوء الشمس عبر قطرات المطر، فيتشكل قوس قزح.",
  hi: "सूरज की रोशनी बारिश की बूंदों से गुजरती है और इंद्रधनुष बनाती है।",
  tr: "Güneş ışığı yağmur damlalarından geçer ve bir gökkuşağı oluşturur.",
  vi: "Ánh nắng xuyên qua những giọt mưa và tạo thành cầu vồng.",
  id: "Cahaya matahari menembus tetesan hujan dan membentuk pelangi.",
  th: "แสงแดดส่องผ่านหยดฝนและเกิดเป็นสายรุ้ง",
  sv: "Solljuset passerar genom regndropparna och bildar en regnbåge.",
  pl: "Światło słoneczne przechodzi przez krople deszczu i tworzy tęczę.",
  uk: "Сонячне світло проходить крізь краплі дощу й утворює веселку.",
  da: "Sollyset passerer gennem regndråberne og danner en regnbue.",
  fi: "Auringonvalo kulkee sadepisaroiden läpi ja muodostaa sateenkaaren.",
  he: "אור השמש עובר דרך טיפות הגשם ויוצר קשת בענן.",
  el: "Το φως του ήλιου περνά μέσα από τις σταγόνες της βροχής και σχηματίζει ουράνιο τόξο.",
  cs: "Sluneční světlo prochází dešťovými kapkami a vytváří duhu.",
  hu: "A napfény áthalad az esőcseppeken, és szivárványt hoz létre.",
  ro: "Lumina soarelui trece prin picăturile de ploaie și formează un curcubeu.",
  ms: "Cahaya matahari melalui titisan hujan dan membentuk pelangi.",
  fa: "نور خورشید از میان قطره‌های باران می‌گذرد و رنگین‌کمان می‌سازد.",
};

export function speechTestSample(locale) {
  const language = String(locale || "").split("-")[0].toLowerCase();
  if (TEST_SAMPLES[language]) return TEST_SAMPLES[language];
  try { return new Intl.DisplayNames([locale], { type: "language" }).of(language) || locale; }
  catch { return locale || ""; }
}

export function prepareSpeechLanguages(voices, uiLanguage, selectedLocale = "") {
  const locales = new Set(voices.flatMap(voice => [voice.locale, ...(voice.secondaryLocales || [])]).filter(Boolean));
  const collator = new Intl.Collator(uiLanguage || "zh", { sensitivity: "base" });
  return [...locales].map(id => {
    let label = id, nativeName = "";
    try {
      const locale = new Intl.Locale(id);
      const name = new Intl.DisplayNames([uiLanguage || "zh"], { type: "language" }).of(locale.language);
      const region = locale.region && new Intl.DisplayNames([uiLanguage || "zh"], { type: "region" }).of(locale.region);
      nativeName = new Intl.DisplayNames([id], { type: "language" }).of(locale.language);
      label = `${name}${region ? `（${region}）` : ""}`;
    } catch { /* Keep the provider's locale code. */ }
    return { id, label: `${label} · ${id}`, searchText: [label, nativeName, id].filter(Boolean).join(" ") };
  }).sort((a, b) => Number(b.id === selectedLocale) - Number(a.id === selectedLocale) || collator.compare(a.label, b.label));
}

export function speechVoicesForLocale(voices, locale) {
  return voices.filter(voice => voice.locale === locale || voice.secondaryLocales?.includes(locale));
}

export function prepareSpeechVoices(voices, language, translate, selectedId = "", preferredLocale = "") {
  const uiLanguage = language || "zh";
  let languageNames, regionNames;
  try {
    languageNames = new Intl.DisplayNames([uiLanguage], { type: "language" });
    regionNames = new Intl.DisplayNames([uiLanguage], { type: "region" });
  } catch { /* Older webviews still show the provider's locale code. */ }
  const collator = new Intl.Collator(uiLanguage, { sensitivity: "base" });
  const localeLabel = code => {
    if (!code || !languageNames || !regionNames) return code || "";
    try {
      const locale = new Intl.Locale(code);
      const name = languageNames.of(locale.language);
      return locale.region ? `${name}（${regionNames.of(locale.region)}）` : name;
    } catch { return code; }
  };
  const rank = voice => voice.id === selectedId ? 0
    : preferredLocale && voice.locale === preferredLocale ? 1
      : preferredLocale && voice.secondaryLocales?.includes(preferredLocale) ? 2
        : voice.locale?.toLowerCase().startsWith("en-") ? 3 : 4;
  return voices.map(voice => {
    const name = voice.locale?.split("-")[0].toLowerCase() === uiLanguage.split("-")[0].toLowerCase()
      ? voice.localName || voice.name : voice.name;
    const locale = localeLabel(voice.locale);
    const gender = GENDER_KEYS[voice.gender] ? translate(GENDER_KEYS[voice.gender]) : "";
    return {
      ...voice,
      label: [name, locale, gender].filter(Boolean).join(" · "),
      searchText: [...new Set([name, voice.name, voice.localName, locale, voice.locale, voice.localeName, gender, voice.id])].filter(Boolean).join(" "),
      localeLabel: locale,
    };
  }).sort((a, b) => rank(a) - rank(b) || collator.compare(a.localeLabel, b.localeLabel)
    || collator.compare(a.name, b.name));
}
