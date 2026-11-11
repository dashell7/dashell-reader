import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const vue = fs.readFileSync(new URL('../src/learning/vendor/views/LearnPanel.vue', import.meta.url), 'utf8');
const script = vue.slice(vue.indexOf('let submitLoading ='), vue.indexOf('// 翻译切换逻辑'))
  .replace('const selectionToken = ref(0);', '');
const js = ts.transpileModule(`${script}\nglobalThis.api = { submit, clearPanel, submitLoading, formErrors, expressionInput, meaningInput, lastSavedExpression };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.None },
}).outputText;

function draft(expression = 'alpha') {
  return { expression, meaning: `${expression} definition`, aliases: 'ALPHAS, alphas', t: 'WORD',
    status: 1, tags: [], notes: [], sentences: [], date: 123 };
}

function setup() {
  const events = [];
  const notices = [];
  const writes = [];
  const pending = [];
  const queries = [];
  const handlers = new Map();
  const model = { value: draft() };
  const selectionToken = { value: 1 };
  const plugin = { settings: {}, db: { postExpression: data => {
    writes.push(structuredClone(data));
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  }, getExpression: word => {
    queries.push(word);
    return Promise.resolve(null);
  }, tryGetSen: async () => null } };
  const context = { model, selectionToken, plugin, ref: value => ({ value }),
    computed: getter => ({ get value() { return getter(); } }), nextTick: async () => {}, onMounted: () => {}, t: value => value,
    window: {}, useEvent: (_window, name, handler) => handlers.set(name, handler),
    translationTypes: { value: {} }, translationCache: { value: {} },
    youdaoSearch: async () => null, googleTranslate: async () => null,
    normalizeReaderLink: value => value,
    Notice: class { constructor(message) { notices.push(message); } },
    logger: { info() {}, error() {} },
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    dispatchEvent: event => events.push(event) };
  vm.runInNewContext(js, context);
  return { ...context.api, model, selectionToken, events, notices, writes, pending, plugin, queries, context,
    newWord: () => handlers.get('qiaomu-english-event-new-word')(),
    query: async (selection, extra = {}) => {
      await handlers.get('qiaomu-english-event-search')({ detail: { selection, ...extra } });
      await new Promise(setImmediate);
    } };
}

test('saving an earlier word broadcasts its saved snapshot and preserves a newly queried draft', async () => {
  const s = setup();
  const save = s.submit();
  s.selectionToken.value++;
  s.model.value = draft('beta');
  s.pending[0].resolve(200);
  await save;
  assert.equal(s.writes[0].expression, 'alpha');
  const refresh = s.events.find(event => event.type === 'qiaomu-english-event-refresh');
  assert.equal(refresh.detail.expression, 'alpha');
  assert.equal(refresh.detail.meaning, 'alpha definition');
  assert.deepEqual(Array.from(refresh.detail.aliases), ['alphas', 'alphas']);
  assert.equal(s.model.value.expression, 'beta');
  assert.equal(s.model.value.meaning, 'beta definition');
});

test('edits to the same word during a save remain available after the saved snapshot completes', async () => {
  const s = setup();
  const save = s.submit();
  s.model.value.meaning = 'new unsaved meaning';
  s.model.value.notes.push('new note');
  s.pending[0].resolve(200);
  await save;
  assert.equal(s.writes[0].meaning, 'alpha definition');
  assert.equal(s.model.value.meaning, 'new unsaved meaning');
  assert.deepEqual(s.model.value.notes, ['new note']);
});

test('an unchanged successfully saved draft clears once and invalidates pending query enrichment', async () => {
  const s = setup();
  const save = s.submit();
  await s.submit();
  assert.equal(s.writes.length, 1);
  s.pending[0].resolve(200);
  await save;
  assert.equal(s.model.value.expression, null);
  assert.equal(s.submitLoading.value, false);
  assert.ok(s.selectionToken.value > 1);
});

test('failed saves retain the exact editable draft and allow retry', async () => {
  const s = setup();
  const original = structuredClone(s.model.value);
  const save = s.submit();
  s.pending[0].reject(new Error('disk unavailable'));
  await save;
  assert.deepEqual(s.model.value, original);
  assert.equal(s.submitLoading.value, false);
  assert.equal(s.events.length, 0);
  assert.match(s.notices.at(-1), /disk unavailable/);
  const retry = s.submit();
  s.pending[1].resolve(500);
  await retry;
  assert.deepEqual(s.model.value, original);
  assert.equal(s.events.length, 0);
});

test('querying another word and returning restores every field of the unsaved draft', async () => {
  const s = setup();
  s.model.value.expression = null;
  await s.query('alpha');
  s.model.value = { ...draft(), notes: ['my note'], tags: ['tag'],
    sentences: [{ text: 'Alpha sentence.', trans: 'My translation', origin: 'Book', readerLink: 'obsidian://source' }] };
  const unsaved = structuredClone(s.model.value);
  await s.query('beta');
  s.model.value.meaning = 'Beta draft';
  await s.query('ALPHA');
  assert.deepEqual(JSON.parse(JSON.stringify(s.model.value)), unsaved);
  assert.deepEqual(s.queries, ['alpha', 'beta']);
  await s.query('beta');
  assert.equal(s.model.value.meaning, 'Beta draft');
});

test('save completion while another word is open clears only its unchanged cached draft', async () => {
  const s = setup();
  const save = s.submit();
  await s.query('beta');
  s.model.value.meaning = 'Beta draft';
  s.pending[0].resolve(200);
  await save;
  await s.query('alpha');
  assert.equal(s.model.value.meaning, '', 'saved draft is reloaded rather than restored as unsaved');
  assert.deepEqual(s.queries, ['beta', 'alpha']);
  await s.query('beta');
  assert.equal(s.model.value.meaning, 'Beta draft');
});

test('save completion cannot discard a newer cached edit of the submitted word', async () => {
  const s = setup();
  const save = s.submit();
  s.model.value.meaning = 'Newer alpha draft';
  await s.query('beta');
  s.pending[0].resolve(200);
  await save;
  await s.query('alpha');
  assert.equal(s.model.value.meaning, 'Newer alpha draft');
});

test('late lookup results cannot replace a restored draft after switching away and back', async () => {
  const s = setup();
  let finish;
  s.plugin.db.getExpression = () => new Promise(resolve => { finish = resolve; });
  s.model.value.expression = null;
  const firstQuery = s.query('alpha');
  await firstQuery;
  const finishAlpha = finish;
  s.model.value.meaning = 'Hand written alpha';
  await s.query('beta');
  await s.query('alpha');
  finishAlpha({ ...draft(), meaning: 'Old database meaning' });
  await new Promise(setImmediate);
  assert.equal(s.model.value.meaning, 'Hand written alpha');
});

test('a late database lookup cannot overwrite typing that started on the current word', async () => {
  const s = setup();
  let finish;
  s.plugin.db.getExpression = () => new Promise(resolve => { finish = resolve; });
  s.model.value.expression = null;
  await s.query('alpha');
  s.model.value.meaning = 'Hand written while loading';
  finish({ ...draft(), aliases: [], meaning: 'Old database meaning' });
  await new Promise(setImmediate);
  assert.equal(s.model.value.meaning, 'Hand written while loading');
});

test('automatic word forms still allow the saved entry to populate an untouched form', async () => {
  const s = setup();
  let finish;
  s.plugin.db.getExpression = () => new Promise(resolve => { finish = resolve; });
  s.context.youdaoSearch = async () => ({ result: { pattern: '( alphas. )' } });
  s.model.value.expression = null;
  await s.query('alpha');
  assert.equal(s.model.value.aliases, 'alphas');
  finish({ ...draft(), aliases: ['alphas'], notes: ['Saved note'], meaning: 'Saved definition' });
  await new Promise(setImmediate);
  assert.equal(s.model.value.meaning, 'Saved definition');
  assert.deepEqual(s.model.value.notes, ['Saved note']);
});

test('late automatic word forms preserve aliases typed while the lookup is pending', async () => {
  const s = setup();
  let finish;
  s.context.youdaoSearch = () => new Promise(resolve => { finish = resolve; });
  s.model.value.expression = null;
  await s.query('alpha');
  s.model.value.aliases = 'my-alpha, custom-alpha';
  finish({ result: { pattern: '( alphas. )' } });
  await new Promise(setImmediate);
  assert.equal(s.model.value.aliases, 'my-alpha, custom-alpha');
});

test('editing the meaning does not block automatic forms for an unchanged empty aliases field', async () => {
  const s = setup();
  let finish;
  s.context.youdaoSearch = () => new Promise(resolve => { finish = resolve; });
  s.model.value.expression = null;
  await s.query('alpha');
  s.model.value.meaning = 'My own meaning';
  finish({ result: { pattern: '( alphas. )' } });
  await new Promise(setImmediate);
  assert.equal(s.model.value.meaning, 'My own meaning');
  assert.equal(s.model.value.aliases, 'alphas');
});

test('returning to an unchanged draft during its save clears only that completed draft', async () => {
  const s = setup();
  s.model.value.expression = null;
  await s.query('alpha');
  s.model.value.meaning = 'Alpha to save';
  const save = s.submit();
  await s.query('beta');
  s.model.value.meaning = 'Beta unsaved';
  await s.query('alpha');
  s.pending[0].resolve(200);
  await save;
  assert.equal(s.model.value.expression, null);
  await s.query('beta');
  assert.equal(s.model.value.meaning, 'Beta unsaved');
});

test('required fields keep actionable errors and focus the first missing field without writing', async () => {
  const s = setup();
  const focus = [];
  s.expressionInput.value = { focus: () => focus.push('expression') };
  s.meaningInput.value = { focus: () => focus.push('meaning') };
  s.model.value.expression = '  ';
  s.model.value.meaning = '';
  await s.submit();
  assert.deepEqual(focus, ['expression']);
  assert.equal(s.formErrors.value.expression, 'Please input a word/phrase');
  assert.equal(s.formErrors.value.meaning, 'A short definition is needed');
  assert.equal(s.writes.length, 0);
  s.model.value.expression = 'alpha';
  await s.submit();
  assert.deepEqual(focus, ['expression', 'meaning']);
  s.model.value.meaning = 'my definition';
  const save = s.submit();
  s.pending[0].resolve(200);
  await save;
  assert.equal(s.lastSavedExpression.value, 'alpha');
  assert.equal(s.model.value.expression, null);
  assert.equal(s.formErrors.value.expression, undefined);
});

test('adding a word starts blank and preserves the previous word draft for a later lookup', async () => {
  const s = setup();
  s.model.value.expression = null;
  await s.query('alpha');
  s.model.value.meaning = 'Unsaved meaning';
  s.model.value.notes = ['Unsaved note'];
  let focused = false;
  s.expressionInput.value = { focus: () => { focused = true; } };
  s.newWord();
  assert.equal(s.model.value.expression, null);
  assert.equal(s.model.value.meaning, null);
  assert.equal(focused, true);
  assert.equal(s.writes.length, 0);
  await s.query('alpha');
  assert.equal(s.model.value.meaning, 'Unsaved meaning');
  assert.deepEqual(Array.from(s.model.value.notes), ['Unsaved note']);
});
