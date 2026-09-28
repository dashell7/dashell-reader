import { francAll } from "franc-min";

const count = (text, pattern) => [...text.matchAll(pattern)].length;
const baseLanguage = locale => String(locale || "").split("-")[0].toLowerCase();
const latinScript = /\p{Script=Latin}/u;
const hanScript = /\p{Script=Han}/u;
const kanaScript = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const hangulScript = /\p{Script=Hangul}/u;
const otherLetter = /\p{Letter}/u;
const japaneseParticles = /^(?:を|は|が|に|で|と|の|へ|も|や|です|ます)/u;

function speechScript(text) {
  if (kanaScript.test(text)) return "kana";
  if (hangulScript.test(text)) return "hangul";
  if (hanScript.test(text)) return "han";
  if (latinScript.test(text)) return "latin";
  if (otherLetter.test(text)) return "other";
  return "";
}

function speechTokens(text) {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter("ja", { granularity: "word" }).segment(text)]
      .map(part => ({ text: part.segment, script: speechScript(part.segment) }));
  }
  const tokens = [];
  for (const char of text) {
    const script = speechScript(char);
    if (script && script !== tokens.at(-1)?.script) tokens.push({ text: char, script });
    else if (tokens.length) tokens.at(-1).text += char;
    else tokens.push({ text: char, script: "" });
  }
  return tokens;
}

export function splitSpeechLanguageRuns(text) {
  const tokens = speechTokens(String(text || ""));
  const runs = [];
  let prefix = "";
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token.script) {
      if (runs.length) runs.at(-1).text += token.text;
      else prefix += token.text;
      continue;
    }
    let language = null;
    if (token.script === "han") {
      // A Japanese word can mix kanji and kana, or be followed by a grammatical particle.
      // Other isolated kanji stay Chinese; neighboring kana alone is not proof of Japanese.
      const next = tokens[index + 1], previous = tokens[index - 1];
      const joinedToKana = next?.script === "kana" && hanScript.test([...token.text.trim()].at(-1));
      language = joinedToKana && (japaneseParticles.test(next.text.trim()) || previous?.script === "kana") ? "ja" : "zh";
    } else if (token.script === "kana") language = "ja";
    else if (token.script === "hangul") language = "ko";
    const script = token.script === "latin" ? "latin" : token.script === "other" ? "other" : "east-asian";
    const value = prefix + token.text;
    prefix = "";
    if (runs.at(-1)?.script === script && runs.at(-1)?.language === language) runs.at(-1).text += value;
    else runs.push({ text: value, script, language });
  }
  if (!runs.length && prefix.trim()) runs.push({ text: prefix, script: "", language: null });
  return runs.map(run => ({ ...run, text: run.text.trim() })).filter(run => run.text);
}

export function detectSpeechLanguage(text, context = "") {
  const selected = String(text || "").trim();
  if (!selected) return null;
  const kana = count(selected, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const hangul = count(selected, /\p{Script=Hangul}/gu);
  if (kana >= 2) return "ja";
  if (hangul >= 2) return "ko";
  const han = count(selected, /\p{Script=Han}/gu);
  const latin = count(selected, /\p{Script=Latin}/gu);
  if (han >= 3 && latin / (han + latin) < 0.35) return "zh";
  if (han >= 3 && latin >= 3 && Math.min(han, latin) / (han + latin) >= 0.35) return null;

  const nearby = String(context || "").trim();
  const sample = latin < 20 && nearby && count(nearby, /\p{Script=Latin}/gu) >= 20
    && count(nearby, /\p{Script=Han}/gu) < 3 ? nearby : selected;
  const letters = count(sample, /\p{Letter}/gu);
  if (letters < 18) return null;
  const [[code, score], [, runnerUp = 0] = []] = francAll(sample, { minLength: 10 });
  if (!code || code === "und" || score - runnerUp < 0.12) return null;
  try { return new Intl.Locale(code).language; }
  catch { return null; }
}

export function selectAzureSpeechVoice(language, voices, currentVoice = "") {
  const supported = voice => [voice.locale, ...(voice.secondaryLocales || [])]
    .find(locale => baseLanguage(locale) === language);
  const current = voices.find(voice => voice.id === currentVoice);
  if (current && supported(current)) return { voice: current.id, locale: supported(current) };
  let preferredLocale = "";
  try {
    const locale = new Intl.Locale(language).maximize();
    preferredLocale = `${locale.language}-${locale.region}`;
  } catch { /* A provider can use a language code unknown to this runtime. */ }
  const candidates = voices.filter(supported);
  const score = voice => {
    const locale = supported(voice);
    return (baseLanguage(voice.locale) === language ? 100 : 0)
      + (locale === preferredLocale ? 30 : 0)
      + (/Neural$/u.test(voice.id) && !voice.id.includes(":") ? 20 : 0)
      + (!/Multilingual|Dialects/u.test(voice.id) ? 5 : 0)
      + (voice.status === "GA" ? 2 : 0);
  };
  candidates.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  const chosen = candidates[0];
  return chosen ? { voice: chosen.id, locale: supported(chosen) } : null;
}
