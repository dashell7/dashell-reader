import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { compileFunction } from "node:vm";
import ts from "typescript";
import { resolveEnglishReviewFormat } from "../src/english-review.js";

const source = readFileSync(new URL("../src/learning/vendor/utils/reviewDb.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const reviewExports = {};
compileFunction(compiled, ["exports"])(reviewExports);
const { buildReviewFileContent, prepareReviewSync, extractSRProgress } = reviewExports;

const oldFormat = { tag: "#flashcards", delimiter: "?" };
const word = (expression, meaning = "释义") => ({ expression, meaning, notes: [], sentences: [] });

test("full vocabulary export follows active Spaced Repetition tag and separator", () => {
  const sr = { isInitialized: true, _dataManager: { data: { settings: {
    flashcardTags: ["#learning/english"], multilineCardSeparator: "??",
    multilineReversedCardSeparator: "!!!",
  } } } };
  const format = resolveEnglishReviewFormat(sr);
  const content = buildReviewFileContent([
    { expression: "orbit", meaning: "轨道", notes: [], sentences: [] },
  ], format, { orbit: "<!--SR:!2026-10-02,2,250-->" });
  assert.match(content, /^#learning\/english\n\n#word\n#### orbit\n\?\?\n轨道\n/);
  assert.match(content, /<!--SR:!2026-10-02,2,250-->/);
  assert.doesNotMatch(content, /#flashcards|\n\?\n/);
});

test("a blank review file becomes a bounded managed section", async () => {
  const format = { tag: "#learning/english", delimiter: "??" };
  const result = await prepareReviewSync("", [word("orbit", "轨道")], format, [oldFormat]);
  assert.equal(result.status, "created");
  assert.match(result.text, /^<!-- qiaomu-reader-english:review:start sha256=[a-f0-9]{64} -->\n#learning\/english\n\n#word\n#### orbit\n\?\?\n轨道\n/);
  assert.match(result.text, /<!-- qiaomu-reader-english:review:end -->\n$/);
  assert.equal((await prepareReviewSync(result.text, [word("orbit", "轨道")], format, [oldFormat])).status, "unchanged");
});

test("nine exact legacy cards migrate while preserving changed SR schedules", async () => {
  const words = Array.from({ length: 9 }, (_, i) => word(`word${i + 1}`, `释义${i + 1}`));
  const schedule = "<!--SR:!2026-10-02,2,250!2026-10-04,4,260-->";
  const old = buildReviewFileContent(words, oldFormat, { word4: schedule });
  const format = { tag: "#learning/english", delimiter: "??" };
  const result = await prepareReviewSync(old, words, format, [oldFormat]);
  assert.equal(result.status, "migrated");
  assert.equal(result.preservedSR, 1);
  assert.match(result.text, /#learning\/english/);
  assert.match(result.text, /#### word4\n\?\?\n释义4\n<!--SR:!2026-10-02,2,250!2026-10-04,4,260-->/);
  assert.deepEqual({ ...await extractSRProgress(result.text) }, { word4: schedule });
  assert.deepEqual({ ...await extractSRProgress(old) }, {}, "unowned legacy cards cannot drive status reflux before migration");
});

test("manual prose and foreign cards outside the managed region survive later full sync", async () => {
  const format = { tag: "#flashcards", delimiter: "?" };
  const initial = await prepareReviewSync("", [word("orbit", "轨道")], format, [oldFormat]);
  const handWritten = "\nMy hand-written notes stay here.\n\n#word\n#### another\n?\nA card from another source.\n";
  const current = initial.text + handWritten;
  const changed = await prepareReviewSync(current, [word("orbit", "天体轨道")], format, [oldFormat]);
  assert.equal(changed.status, "updated");
  assert.ok(changed.text.endsWith(handWritten));
  assert.match(changed.text, /#### orbit\n\?\n天体轨道/);
});

test("SR can alter an owned card without invalidating the generated-content check", async () => {
  const words = [word("orbit", "轨道")];
  const created = await prepareReviewSync("", words, oldFormat, [oldFormat]);
  const tag = "<!--SR:!2026-10-02,2,250-->";
  const withSchedule = created.text.replace("轨道\n", `轨道 ${tag}\n`);
  const changed = await prepareReviewSync(withSchedule, [word("orbit", "天体轨道")], oldFormat, [oldFormat]);
  assert.equal(changed.status, "updated");
  assert.match(changed.text, /天体轨道\n<!--SR:!2026-10-02,2,250-->/);
  assert.deepEqual({ ...await extractSRProgress(changed.text) }, { orbit: tag });
});

test("a case-only vocabulary spelling change keeps the unique SR schedule", async () => {
  const tag = "<!--SR:!2026-10-02,2,250-->";
  const created = await prepareReviewSync("", [word("Orbit", "轨道")], oldFormat, [oldFormat]);
  const scheduled = created.text.replace("轨道\n", `轨道\n${tag}\n`);
  const next = await prepareReviewSync(scheduled, [word("orbit", "轨道")], oldFormat, [oldFormat]);
  assert.equal(next.status, "updated");
  assert.equal(next.preservedSR, 1);
  assert.match(next.text, /#### orbit\n\?\n轨道\n<!--SR:!2026-10-02,2,250-->/);
  assert.deepEqual({ ...await extractSRProgress(next.text) }, { orbit: tag });
  const ambiguous = buildReviewFileContent([word("orbit")], oldFormat, {
    Orbit: tag, orbit: "<!--SR:!2026-10-03,3,250-->",
  });
  assert.doesNotMatch(ambiguous, /<!--SR:/, "conflicting same-word schedules must not be assigned arbitrarily");
});

test("hand edits inside the generated section and malformed markers are not overwritten", async () => {
  const created = await prepareReviewSync("", [word("orbit", "轨道")], oldFormat, [oldFormat]);
  const edited = created.text.replace("轨道\n", "轨道\nRemember the telescope.\n");
  const blocked = await prepareReviewSync(edited, [word("orbit", "天体轨道")], oldFormat, [oldFormat]);
  assert.equal(blocked.status, "conflict");
  assert.equal(blocked.reason, "managed-edited");
  assert.equal(blocked.text, edited);
  const broken = created.text.replace("<!-- qiaomu-reader-english:review:end -->", "");
  assert.equal((await prepareReviewSync(broken, [word("orbit")], oldFormat, [oldFormat])).reason, "markers");
});

test("status reflux ignores SR schedules when an owned card fails its content checksum", async () => {
  const created = await prepareReviewSync("", [word("orbit", "轨道")], oldFormat, [oldFormat]);
  const tag = "<!--SR:!2026-10-02,14,250-->";
  const reviewed = created.text.replace("轨道\n", `轨道\n${tag}\n`);
  assert.deepEqual({ ...await extractSRProgress(reviewed) }, { orbit: tag });
  const handEdited = reviewed.replace("轨道\n", "手写释义\n");
  assert.deepEqual({ ...await extractSRProgress(handEdited) }, {});
});

test("duplicate owned cards and ambiguous SR comments stop sync before progress is lost", async () => {
  const words = [word("orbit", "轨道")];
  const created = await prepareReviewSync("", words, oldFormat, [oldFormat]);
  const tag = "<!--SR:!2026-10-02,2,250-->";
  const ambiguous = created.text.replace("轨道\n", `轨道 ${tag} ${tag}\n`);
  const result = await prepareReviewSync(ambiguous, [word("orbit", "新释义")], oldFormat, [oldFormat]);
  assert.equal(result.reason, "managed-edited");
  assert.equal(result.text, ambiguous);
  assert.deepEqual({ ...await extractSRProgress(ambiguous) }, {});

  const duplicateBody = buildReviewFileContent([word("Orbit"), word("orbit")], oldFormat, {});
  const digestBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(duplicateBody.trimEnd()));
  const digest = Buffer.from(digestBytes).toString("hex");
  const duplicateFile = `<!-- qiaomu-reader-english:review:start sha256=${digest} -->\n${duplicateBody}<!-- qiaomu-reader-english:review:end -->\n`;
  assert.equal((await prepareReviewSync(duplicateFile, words, oldFormat, [oldFormat])).reason, "duplicate");
  assert.equal((await prepareReviewSync("", [word("Orbit"), word("orbit")], oldFormat, [oldFormat])).reason, "duplicate");
});

test("unknown old content and same-word foreign cards block sync without changing the file", async () => {
  const foreign = "#flashcards\n\n#word\n#### orbit\n?\nMy own explanation\n";
  const conflict = await prepareReviewSync(foreign, [word("orbit", "轨道")], oldFormat, [oldFormat]);
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.reason, "unowned");
  assert.equal(conflict.text, foreign);
  const created = await prepareReviewSync("", [word("orbit", "轨道")], oldFormat, [oldFormat]);
  const mixed = created.text + foreign;
  const duplicate = await prepareReviewSync(mixed, [word("orbit", "轨道")], oldFormat, [oldFormat]);
  assert.equal(duplicate.reason, "duplicate");
  assert.equal(duplicate.text, mixed);
});

test("CRLF review files retain outside text and both schedule entries", async () => {
  const tag = "<!--SR:!2026-10-02,2,250!2026-10-04,4,260-->";
  const old = buildReviewFileContent([word("orbit", "轨道")], oldFormat, { orbit: tag }).replace(/\n/g, "\r\n");
  const migrated = await prepareReviewSync(old, [word("orbit", "轨道")], oldFormat, [oldFormat]);
  assert.equal(migrated.status, "migrated");
  const current = migrated.text + "\r\nPersonal note.\r\n";
  const next = await prepareReviewSync(current, [word("orbit", "新释义")], oldFormat, [oldFormat]);
  assert.equal(next.status, "updated");
  assert.equal(next.text.replace(/\r\n/g, "").includes("\n"), false);
  assert.ok(next.text.endsWith("\r\nPersonal note.\r\n"));
  assert.deepEqual({ ...await extractSRProgress(next.text) }, { orbit: tag });
});
