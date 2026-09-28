import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { compileFunction } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/learning/vendor/plugin.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("plugin.ts", source, ts.ScriptTarget.ES2022, true);
const pluginClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "LanguageLearner");

function listenerSource(methodName, variableName) {
  const method = pluginClass?.members.find(node => ts.isMethodDeclaration(node) && node.name?.getText(ast) === methodName);
  assert.ok(method?.body, `${methodName} must be available for the listener behavior test`);
  const statements = method.body.statements;
  const index = statements.findIndex(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === variableName));
  assert.ok(index >= 0, `${variableName} listener must be registered`);
  const registration = statements[index + 1];
  assert.match(registration.getText(ast), /window\.addEventListener\(['"]qiaomu-english-event-refresh['"]/);
  return `${statements[index].getText(ast)}\n${registration.getText(ast)}`;
}

test("custom vocabulary refresh recolors words but only schedules file writes when auto refresh is enabled", async () => {
  const window = new EventTarget();
  const calls = [];
  const plugin = {
    settings: { auto_refresh_db: false },
    scheduleRefreshTextDB(delay) { calls.push(delay); },
  };
  let cacheRefreshes = 0;
  let scans = 0;
  const bind = compileFunction(`
    ${listenerSource("onload", "globalRefreshHandler")}
    ${listenerSource("registerSubtitleWordHighlight", "refreshHandler")}
  `, ["window", "loadCache", "scanAll"]);
  bind.call(plugin, window, async () => { cacheRefreshes++; }, () => { scans++; });

  window.dispatchEvent(new Event("qiaomu-english-event-refresh"));
  await Promise.resolve();
  assert.deepEqual(calls, [], "disabled auto refresh must not schedule writes to words.md or review.md");
  assert.equal(cacheRefreshes, 1);
  assert.equal(scans, 1);

  plugin.settings.auto_refresh_db = true;
  window.dispatchEvent(new Event("qiaomu-english-event-refresh"));
  await Promise.resolve();
  assert.deepEqual(calls, [1000]);
  assert.equal(cacheRefreshes, 2);
  assert.equal(scans, 2);
});
