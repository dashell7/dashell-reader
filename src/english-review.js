const OWNER = "<!-- qiaomu-reader-english -->";
const LEGACY_OWNER = "Qiaomu Reader English";

export function resolveEnglishReviewFormat(srPlugin) {
  if (srPlugin?.isInitialized !== true) return null;
  const settings = srPlugin._dataManager?.data?.settings;
  const tags = Array.isArray(settings?.flashcardTags) ? settings.flashcardTags : [settings?.flashcardTags];
  const tag = tags.find((item) => /^#[\p{L}\p{N}_/-]+$/u.test(String(item || "")));
  const delimiter = String(settings?.multilineCardSeparator || "").trim();
  if (!tag || !delimiter || delimiter.includes("\n") || delimiter.includes("\r") || delimiter === settings?.multilineReversedCardSeparator) return null;
  return { tag, delimiter };
}

function cardFields(card) {
  const word = String(card.word || "").trim().toLowerCase();
  const meaning = (Array.isArray(card.meanings) ? card.meanings : [])
    .map((item) => String(item).replace(/\s+/g, " ").trim())
    .filter(Boolean).join("；");
  const sentence = String(card.sentence || "").replace(/\s+/g, " ").trim().slice(0, 500);
  return { word, meaning, sentence };
}

function sentenceLines(sentence) {
  return sentence ? ["", "**Sentences**:", `*${sentence.replace(/\*/g, "\\*")}*`] : [];
}

function newCard(fields, delimiter) {
  return ["#word", `#### ${fields.word}`, delimiter, fields.meaning, ...sentenceLines(fields.sentence), OWNER, ""].join("\n");
}

export function upsertEnglishReviewCard(content, card, format) {
  const fields = cardFields(card);
  if (!/^[\p{L}]+(?:[ '\u2019-][\p{L}]+)*$/u.test(fields.word) || !fields.meaning || !format?.tag || !format?.delimiter || fields.meaning === format.delimiter) {
    return { status: "invalid", text: content };
  }
  const newline = String(content).includes("\r\n") ? "\r\n" : "\n";
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  if (!lines.some((line) => line.trim() === format.tag)) return { status: "conflict", text: content };

  const starts = [];
  for (let i = 0; i < lines.length; i++) if (lines[i] === "#word") starts.push(i);
  const matches = starts.map((start, index) => ({ start, end: starts[index + 1] ?? lines.length }))
    .filter(({ start }) => lines[start + 1]?.toLowerCase() === `#### ${fields.word}`);
  if (matches.length > 1) return { status: "conflict", text: content };
  if (!matches.length) {
    const next = `${String(content).trimEnd()}${newline}${newline}${newCard(fields, format.delimiter).replace(/\n/g, newline)}${newline}`;
    return { status: "created", text: next };
  }

  const { start, end } = matches[0];
  const section = lines.slice(start, end);
  const ownerAt = section.findIndex((line) => line.startsWith(OWNER) || line.startsWith(LEGACY_OWNER));
  if (ownerAt < 0 || section[2] !== format.delimiter || !section[3] || section[3].startsWith("<!--SR:")) {
    return { status: "conflict", text: content };
  }
  section[3] = fields.meaning;
  const sentenceStart = section.indexOf("**Sentences**:");
  if (sentenceStart >= 0) {
    const sentenceLine = section[sentenceStart + 1] || "";
    if (sentenceStart >= ownerAt || !/^\*.*\*$/.test(sentenceLine)) return { status: "conflict", text: content };
    const removeFrom = section[sentenceStart - 1] === "" ? sentenceStart - 1 : sentenceStart;
    section.splice(removeFrom, sentenceStart + 2 - removeFrom);
  }
  const markerAt = section.findIndex((line) => line.startsWith(OWNER) || line.startsWith(LEGACY_OWNER));
  section.splice(markerAt, 0, ...sentenceLines(fields.sentence));
  if (!section.some((line) => line.startsWith(OWNER))) section.splice(section.findIndex((line) => line.startsWith(LEGACY_OWNER)), 0, OWNER);
  lines.splice(start, end - start, ...section);
  const next = lines.join(newline);
  return { status: next === content ? "unchanged" : "updated", text: next };
}
