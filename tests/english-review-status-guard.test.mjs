import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { compileFunction } from "node:vm";
import ts from "typescript";

function loadReviewDb() {
  const source = readFileSync(new URL("../src/learning/vendor/utils/reviewDb.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  compileFunction(compiled, ["exports"])(exports);
  return exports;
}

const { prepareReviewSync, readReviewProgress, ReviewIntegrityError } = loadReviewDb();
const source = readFileSync(new URL("../src/learning/vendor/db/file_db.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("file_db.ts", source, ts.ScriptTarget.ES2022, true);
const fileDbClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FileDb");
const evidenceMethod = fileDbClass?.members.find(node => ts.isMethodDeclaration(node)
  && node.name?.getText(ast) === "currentReviewEvidence");
assert.ok(evidenceMethod?.body);

class TestFile {
  path = "review.md";
  stat = { mtime: 1, size: 100 };
}

const compiledMethod = ts.transpileModule(
  `const currentReviewEvidence = async function(expression) ${evidenceMethod.body.getText(ast)};`,
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
).outputText;
const currentReviewEvidence = compileFunction(`${compiledMethod}\nreturn currentReviewEvidence;`, [
  "TFile", "normalizePath", "readReviewProgress", "ReviewIntegrityError", "t", "expressionKey", "reviewEvidence",
])(TestFile, path => path, readReviewProgress, ReviewIntegrityError,
  key => key, word => word.toLowerCase(), tag => tag);

const word = { expression: "orbit", meaning: "轨道", notes: [], sentences: [] };
const format = { tag: "#flashcards", delimiter: "?" };

test("manual status guard accepts intact progress and blocks a damaged managed section", async () => {
  const created = await prepareReviewSync("", [word], format, [format]);
  const tag = "<!--SR:!2026-10-02,14,250-->";
  const file = new TestFile();
  let content = created.text.replace("轨道\n", `轨道\n${tag}\n`);
  const vault = { getAbstractFileByPath: () => file, read: async () => content };
  const database = { reviewRevision: 0, plugin: { settings: { review_database: file.path }, app: { vault } } };

  const trusted = await currentReviewEvidence.call(database, "orbit");
  assert.equal(trusted.tag, tag);
  assert.equal(trusted.evidence, tag);

  content = content.replace("轨道\n", "手写释义\n");
  await assert.rejects(() => currentReviewEvidence.call(database, "orbit"), error =>
    error instanceof ReviewIntegrityError && error.code === "review-invalid"
      && error.message === "Review status blocked invalid managed section");
});

test("old unmarked review files retain their previous empty-evidence behavior", async () => {
  const file = new TestFile();
  const vault = {
    getAbstractFileByPath: () => file,
    read: async () => "#flashcards\n\n#word\n#### orbit\n?\n轨道\n<!--SR:!2026-10-02,14,250-->\n",
  };
  const database = { reviewRevision: 0, plugin: { settings: { review_database: file.path }, app: { vault } } };
  const evidence = await currentReviewEvidence.call(database, "orbit");
  assert.equal(evidence.tag, "");
  assert.equal(evidence.evidence, "");
  assert.equal((await readReviewProgress(await vault.read())).status, "unmanaged");
});

test("malformed managed markers are invalid instead of masquerading as a legacy file", async () => {
  const malformed = "<!-- qiaomu-reader-english:review:start sha256=broken -->\n#flashcards\n";
  const snapshot = await readReviewProgress(malformed);
  assert.equal(snapshot.status, "invalid");
  assert.deepEqual(snapshot.progress, {});
});
