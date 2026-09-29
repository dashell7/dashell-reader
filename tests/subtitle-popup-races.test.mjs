import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

const vue = fs.readFileSync(new URL('../src/learning/vendor/views/SubtitlePopup.vue', import.meta.url), 'utf8');
const script = vue.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1]
  .replace(/^import .*;\r?\n/gm, '');
assert.ok(script, 'SubtitlePopup script is available');
const js = ts.transpileModule(`${script}\nglobalThis.__popupTest = { lookupPhrases, markKnown, markLearning, close, phrases, word, sentenceEn, sentenceZh, bookTitle, readerLink, meanings, currentStatus };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.None },
}).outputText;

function setup() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const events = [];
  const writes = [];
  const db = {
    getExpression: async () => null,
    getStoredWords: async () => ({ phrases: [] }),
    postExpression: async value => { writes.push(structuredClone(value)); },
  };
  const plugin = { db, settings: { hover_definition_lang: 'zh', hover_definition_provider: 'auto' } };
  const context = {
    document: dom.window.document,
    window: dom.window,
    DOMParser: dom.window.DOMParser,
    CustomEvent: dom.window.CustomEvent,
    dispatchEvent: event => { events.push(event); },
    setTimeout,
    clearTimeout,
    requestUrl: async () => ({ json: null, text: '' }),
    Notice: class {},
    ref: value => ({ value }),
    watch: () => {},
    nextTick: () => Promise.resolve(),
    getCurrentInstance: () => ({ appContext: { config: { globalProperties: { plugin } } } }),
    defineProps: () => ({}),
    defineExpose: () => {},
    onMounted: () => {},
    onUnmounted: () => {},
    playAudio: () => {},
    fetchEnglishDefinitions: async () => [],
    normalizeReaderLink: value => value,
    logger: { debug() {}, warn() {} },
    t: value => value,
  };
  vm.runInNewContext(js, context);
  return { dom, db, writes, events, popup: context.__popupTest };
}

test('late phrase results from a previous hover cannot overwrite the current word', async () => {
  const { dom, db, popup } = setup();
  const pending = new Map();
  db.getStoredWords = ({ article }) => new Promise(resolve => pending.set(article, resolve));
  db.getExpression = async text => ({ meaning: `${text} meaning` });
  const first = popup.lookupPhrases('alpha', 'alpha example');
  const second = popup.lookupPhrases('beta', 'beta example');
  pending.get('beta example')({ phrases: [{ text: 'beta phrase' }] });
  await second;
  pending.get('alpha example')({ phrases: [{ text: 'alpha phrase' }] });
  await first;
  assert.deepEqual(JSON.parse(JSON.stringify(popup.phrases.value)), [{ text: 'beta phrase', meaning: 'beta phrase meaning' }]);
  dom.window.close();
});

test('closing the popup invalidates an in-flight phrase lookup', async () => {
  const { dom, db, popup } = setup();
  let finish;
  db.getStoredWords = () => new Promise(resolve => { finish = resolve; });
  const pending = popup.lookupPhrases('alpha', 'alpha example');
  popup.close();
  finish({ phrases: [{ text: 'alpha phrase' }] });
  await pending;
  assert.equal(popup.phrases.value.length, 0);
  dom.window.close();
});

test('Known action saves its original sentence and leaves a newer hover status alone', async () => {
  const { dom, db, writes, events, popup } = setup();
  let finish;
  db.getExpression = () => new Promise(resolve => { finish = resolve; });
  popup.word.value = 'alpha';
  popup.sentenceEn.value = 'Alpha sentence.';
  popup.sentenceZh.value = 'Alpha translation.';
  popup.meanings.value = ['Alpha meaning'];
  const action = popup.markKnown();
  popup.word.value = 'beta';
  popup.sentenceEn.value = 'Beta sentence.';
  popup.sentenceZh.value = 'Beta translation.';
  popup.meanings.value = ['Beta meaning'];
  popup.currentStatus.value = 2;
  finish({ expression: 'alpha', status: 1, sentences: [], meaning: 'saved meaning' });
  await action;
  assert.equal(writes[0].status, 3);
  assert.equal(writes[0].sentences[0].text, 'Alpha sentence.');
  assert.equal(writes[0].sentences[0].trans, 'Alpha translation.');
  assert.equal(popup.currentStatus.value, 2);
  assert.equal(events.find(event => event.type === 'qiaomu-english-event-refresh').detail.meaning, 'Alpha meaning');
  dom.window.close();
});

test('Learning action creates the original word with its original meaning after hover changes', async () => {
  const { dom, db, writes, events, popup } = setup();
  let finish;
  db.getExpression = () => new Promise(resolve => { finish = resolve; });
  popup.word.value = 'alpha';
  popup.sentenceEn.value = 'Alpha sentence.';
  popup.bookTitle.value = 'Alice';
  popup.readerLink.value = 'obsidian://qiaomu-reader-english?vault=V&book=Alice.epub&cfi=epubcfi%28%2F6%29';
  popup.meanings.value = ['Alpha meaning'];
  const action = popup.markLearning();
  popup.word.value = 'beta';
  popup.sentenceEn.value = 'Beta sentence.';
  popup.bookTitle.value = 'Another book';
  popup.readerLink.value = '';
  popup.meanings.value = ['Beta meaning'];
  popup.currentStatus.value = 3;
  finish(null);
  await action;
  assert.equal(writes[0].expression, 'alpha');
  assert.equal(writes[0].meaning, 'Alpha meaning');
  assert.equal(writes[0].sentences[0].text, 'Alpha sentence.');
  assert.equal(writes[0].sentences[0].origin, 'Alice');
  assert.match(writes[0].sentences[0].readerLink, /Alice\.epub/);
  assert.equal(events.find(event => event.type === 'qiaomu-english-event-search').detail.bookTitle, 'Alice');
  assert.equal(popup.currentStatus.value, 3);
  dom.window.close();
});
