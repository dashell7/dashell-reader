import assert from "node:assert/strict";
import test from "node:test";
import { resolveEnglishReviewFormat, upsertEnglishReviewCard } from "../src/english-review.js";

const format = { tag: "#flashcards", delimiter: "?" };
const card = { word: "Alice", meanings: ["爱丽丝"], sentence: "Alice opened the book." };

test("reads the initialized Spaced Repetition 1.15 settings", () => {
  const plugin = { isInitialized: true, _dataManager: { data: { settings: {
    flashcardTags: ["#learning/english"], multilineCardSeparator: "??", multilineReversedCardSeparator: "!!!",
  } } } };
  assert.deepEqual(resolveEnglishReviewFormat(plugin), { tag: "#learning/english", delimiter: "??" });
  assert.equal(resolveEnglishReviewFormat({ ...plugin, isInitialized: false }), null);
  assert.equal(resolveEnglishReviewFormat(null), null);
});

test("creates one card with the configured tag and delimiter", () => {
  const custom = { tag: "#learning/english", delimiter: "->" };
  const first = upsertEnglishReviewCard(`${custom.tag}\n`, card, custom);
  assert.equal(first.status, "created");
  assert.match(first.text, /#learning\/english\n\n#word\n#### alice\n->\n爱丽丝/);
  assert.equal(upsertEnglishReviewCard(first.text, card, custom).status, "unchanged");
  assert.equal((first.text.match(/#### alice/g) || []).length, 1);
});

test("updates a legacy card without dropping its schedule or hand-written prose", () => {
  const before = [
    "#flashcards", "", "#word", "#### alice", "?", "旧释义", "", "**Sentences**:",
    "*Old sentence.*", "Qiaomu Reader English <!--SR:!2026-10-02,2,250-->",
    "Hand-written memory aid.", "", "#word", "#### another", "?", "Other card", "",
  ].join("\n");
  const result = upsertEnglishReviewCard(before, card, format);
  assert.equal(result.status, "updated");
  assert.match(result.text, /#### alice\n\?\n爱丽丝\n\n\*\*Sentences\*\*:\n\*Alice opened the book\.\*/);
  assert.match(result.text, /Qiaomu Reader English <!--SR:!2026-10-02,2,250-->/);
  assert.match(result.text, /Hand-written memory aid\.\n\n#word\n#### another\n\?\nOther card/);
  assert.equal(upsertEnglishReviewCard(result.text, card, format).status, "unchanged");
});

test("preserves the schedule comment attached to a managed marker", () => {
  const first = upsertEnglishReviewCard("#flashcards\n", card, format);
  const scheduled = first.text.replace("<!-- qiaomu-reader-english -->", "<!-- qiaomu-reader-english --><!--SR:!2026-10-02,2,250-->");
  const result = upsertEnglishReviewCard(scheduled, { ...card, meanings: ["新释义"], sentence: "A new sentence." }, format);
  assert.equal(result.status, "updated");
  assert.match(result.text, /<!-- qiaomu-reader-english --><!--SR:!2026-10-02,2,250-->/);
  assert.equal(upsertEnglishReviewCard(result.text, { ...card, meanings: ["新释义"], sentence: "A new sentence." }, format).status, "unchanged");
});

test("refuses to replace an unowned or duplicate word card", () => {
  const foreign = "#flashcards\n\n#word\n#### alice\n?\nSomeone else's card\n";
  assert.deepEqual(upsertEnglishReviewCard(foreign, card, format), { status: "conflict", text: foreign });
  const owned = upsertEnglishReviewCard("#flashcards\n", card, format).text;
  assert.equal(upsertEnglishReviewCard(`${owned}\n${foreign}`, card, format).status, "conflict");
});

test("preserves CRLF and stops if the active SR tag is absent", () => {
  const first = upsertEnglishReviewCard("#flashcards\r\n", card, format);
  assert.equal(first.status, "created");
  assert.equal(first.text.replace(/\r\n/g, "").includes("\n"), false);
  assert.equal(upsertEnglishReviewCard(first.text, card, format).status, "unchanged");
  assert.equal(upsertEnglishReviewCard(first.text, card, { tag: "#new-tag", delimiter: "?" }).status, "conflict");
});
