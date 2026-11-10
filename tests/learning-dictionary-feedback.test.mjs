import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { ref, nextTick, effectScope } from 'vue';

const require = createRequire(import.meta.url);
const hookSource = fs.readFileSync(new URL('../src/learning/vendor/dictionary/uses.ts', import.meta.url), 'utf8');
const hookJs = ts.transpileModule(hookSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const hookContext = { exports: {}, require, Error };
vm.runInNewContext(hookJs, hookContext);
const { useLoading } = hookContext.exports;
const flush = async () => { await nextTick(); await Promise.resolve(); };

test('empty queries stay idle; ready, empty and failed requests remain distinguishable and recoverable', async () => {
  const word = ref('');
  const statuses = [];
  let searches = 0;
  const scope = effectScope();
  scope.run(() => useLoading(() => word.value, 'fixture', async () => {
    searches++;
    if (word.value === 'offline') throw new Error('connection unavailable');
    return word.value !== 'missing';
  }, (_event, state) => statuses.push(state)));
  assert.equal(searches, 0);
  assert.equal(statuses.at(-1).state, 'idle');
  word.value = 'missing';
  await flush();
  assert.equal(statuses.at(-1).state, 'empty');
  word.value = 'offline';
  await flush();
  assert.equal(statuses.at(-1).state, 'error');
  assert.equal(statuses.at(-1).message, 'connection unavailable');
  word.value = 'restored';
  await flush();
  assert.equal(statuses.at(-1).state, 'ready');
  assert.equal(statuses.at(-1).result, true);
  scope.stop();
});

test('late requests and disposed result instances cannot replace the latest feedback', async () => {
  const word = ref('alpha');
  const statuses = [];
  const pending = [];
  const scope = effectScope();
  scope.run(() => useLoading(() => word.value, 'fixture', () => new Promise((resolve, reject) => {
    pending.push({ resolve, reject });
  }), (_event, state) => statuses.push(state)));
  word.value = 'beta';
  await nextTick();
  pending[1].resolve(true);
  await flush();
  pending[0].reject(new Error('old failure'));
  await flush();
  assert.equal(statuses.at(-1).state, 'ready');
  word.value = 'gamma';
  await nextTick();
  scope.stop();
  const count = statuses.length;
  pending[2].resolve(false);
  await flush();
  assert.equal(statuses.length, count);
});

const panelSource = fs.readFileSync(new URL('../src/learning/vendor/views/SearchPanel.vue', import.meta.url), 'utf8');
const panelLogic = panelSource.slice(panelSource.indexOf('function retrySearch'), panelSource.indexOf('function handleClick'));
const panelJs = ts.transpileModule(`${panelLogic}\nglobalThis.api = {
  word, inputWord, aiContext, queryRevision, retryRevisions, historyIndex, lastHistory,
  handleSearch, retrySearch, switchHistory, onSearch,
  getHistory: () => history, setComposing: value => { isComposing = value; }
};`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
function panel() {
  const events = [];
  const context = { ref, queryRevision: ref(0), retryRevisions: ref({}), isComposing: false,
    searchInputId: 'fixture-panel', dispatchEvent: event => events.push(event),
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    setTimeout, clearTimeout, KeyboardEvent: class KeyboardEvent {
      constructor(values) { Object.assign(this, values); }
    } };
  vm.runInNewContext(panelJs, context);
  return { ...context.api, events, KeyboardEvent: context.KeyboardEvent };
}

test('submitting the same word issues a fresh query and retains its reading context', () => {
  const s = panel();
  s.inputWord.value = 'alpha';
  s.handleSearch();
  s.aiContext.value = { sentence: 'The alpha example.', bookTitle: 'Fixture book' };
  const revision = s.queryRevision.value;
  s.handleSearch();
  assert.equal(s.queryRevision.value, revision + 1);
  assert.equal(s.aiContext.value.sentence, 'The alpha example.');
  assert.equal(s.getHistory().length, 1);
  s.inputWord.value = 'unsubmitted draft';
  s.retrySearch('ai');
  assert.equal(s.word.value, 'alpha');
  assert.equal(s.inputWord.value, 'unsubmitted draft');
  assert.equal(s.retryRevisions.value.ai, 1);
  assert.equal(s.retryRevisions.value.bing, undefined);
});

test('composition confirmation does not search and new searches prune abandoned forward history', () => {
  const s = panel();
  s.inputWord.value = '中文';
  s.setComposing(true);
  s.handleSearch();
  assert.equal(s.queryRevision.value, 0);
  s.setComposing(false);
  s.handleSearch(new s.KeyboardEvent({ keyCode: 229 }));
  assert.equal(s.queryRevision.value, 0);
  for (const word of ['alpha', 'beta', 'gamma']) {
    s.inputWord.value = word;
    s.handleSearch();
  }
  s.switchHistory('prev');
  s.handleSearch();
  assert.deepEqual(Array.from(s.getHistory()), ['alpha', 'beta']);
  assert.equal(s.historyIndex.value, 1);
  assert.equal(s.lastHistory.value, 1);
});

test('manual search and history publish the displayed word once without replaying their own history', () => {
  const s = panel();
  s.inputWord.value = 'clear';
  s.handleSearch();
  s.inputWord.value = 'resilient';
  s.handleSearch();
  assert.deepEqual(s.events.map(event => event.detail.selection), ['clear', 'resilient']);
  const revision = s.queryRevision.value;
  s.onSearch(s.events.at(-1));
  assert.equal(s.queryRevision.value, revision);
  assert.deepEqual(Array.from(s.getHistory()), ['clear', 'resilient']);
  s.switchHistory('prev');
  assert.equal(s.events.at(-1).detail.selection, 'clear');
  assert.equal(s.events.at(-1).detail.sentence, '');
});
