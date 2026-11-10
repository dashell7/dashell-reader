import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const source = fs.readFileSync(new URL('../src/learning/vocabulary-view.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
function setup() {
  const dom = new JSDOM('<div id="root"></div>');
  const { document, Element } = dom.window;
  Element.prototype.empty = function () { this.replaceChildren(); };
  Element.prototype.addClass = function (name) { this.classList.add(name); };
  Element.prototype.setText = function (text) { this.textContent = text; };
  Element.prototype.createEl = function (tag, opts = {}) {
    const node = document.createElement(tag);
    node.textContent = opts.text || '';
    node.className = opts.cls || '';
    for (const [name, value] of Object.entries(opts.attr || {})) node.setAttribute(name, value);
    this.appendChild(node);
    return node;
  };
  for (const [fn, tag] of [['createDiv', 'div'], ['createSpan', 'span']]) {
    Element.prototype[fn] = function (opts) { return this.createEl(tag, typeof opts === 'string' ? { cls: opts } : opts); };
  }
  const notices = [], calls = [], leaves = [];
  const app = {
    commands: { commands: { 'obsidian-spaced-repetition:srs-review-flashcards-in-note': {} },
      executeCommandById: id => { calls.push(['command', id]); return true; } },
    vault: { getAbstractFileByPath: path => ({ path, extension: 'md' }), on: () => ({}) },
    workspace: {
      getLeavesOfType: type => leaves.filter(leaf => leaf.type === type),
      getLeaf: () => {
        const leaf = { type: 'markdown', view: {}, openFile: async file => { leaf.view.file = file; calls.push(['file', file.path]); },
          setViewState: async state => { leaf.type = state.type; leaf.view = { selectExpression: expr => calls.push(['select', expr]) }; } };
        leaves.push(leaf); return leaf;
      },
      setActiveLeaf: leaf => { calls.push(['activate', leaf.view.file.path]); },
      revealLeaf: () => {},
    },
  };
  class ItemView {
    constructor(leaf) { this.leaf = leaf; this.app = app; this.contentEl = document.querySelector('#root'); }
    registerDomEvent() {} registerEvent() {}
  }
  const context = { ItemView, Notice: class { constructor(text) { notices.push(text); } }, t: key => key,
    window: dom.window, setTimeout, clearTimeout };
  vm.runInNewContext(source + '\nglobalThis.api = { openVocabulary, startVocabularyReview, VocabularyView };', context);
  const learning = { app, settings: { review_database: 'Words/Review.md', word_folder: 'Words' },
    refreshReviewDb: async () => { calls.push(['sync']); return true; },
    db: { getAllExpressionSimple: async () => [{ expression: 'resilient', meaning: 'recovers from difficulty', status: 1, date: 123 }] },
    activateView: async type => calls.push(['edit', type]), lookup: async word => calls.push(['lookup', word]) };
  return { ...context.api, dom, app, learning, calls, notices, leaves };
}

test('vocabulary entry opens a reusable collection and can focus the just-saved word', async () => {
  const s = setup();
  await s.openVocabulary(s.learning, 'resilient');
  await s.openVocabulary(s.learning);
  assert.equal(s.leaves.length, 1);
  assert.deepEqual(s.calls, [['select', 'resilient'], ['select', '']]);
});

test('review only starts after a successful sync and activates the intended review file', async () => {
  const s = setup();
  assert.equal(await s.startVocabularyReview(s.learning), true);
  assert.deepEqual(s.calls.map(call => call[0]), ['sync', 'file', 'activate', 'command']);
  assert.equal(s.calls[1][1], 'Words/Review.md');
  s.calls.length = 0;
  s.learning.refreshReviewDb = async () => false;
  assert.equal(await s.startVocabularyReview(s.learning), false);
  assert.equal(s.calls.length, 0);
});

test('missing review dependency and sync exceptions remain recoverable without opening unrelated notes', async () => {
  const s = setup();
  s.app.commands.commands = {};
  assert.equal(await s.startVocabularyReview(s.learning), false);
  assert.equal(s.notices.at(-1), 'Enable review plugin');
  assert.equal(s.calls.length, 0);
  s.app.commands.commands['obsidian-spaced-repetition:srs-review-flashcards-in-note'] = {};
  s.learning.refreshReviewDb = async () => { throw new Error('disk unavailable'); };
  assert.equal(await s.startVocabularyReview(s.learning), false);
  assert.equal(s.notices.at(-1), 'Vocabulary action failed');
  assert.equal(s.calls.length, 0);
});

test('saved collection lists the actual DB record, filters, clears and opens its learning form', async () => {
  const s = setup();
  const view = new s.VocabularyView({}, s.learning);
  view.onOpen();
  await new Promise(setImmediate);
  const root = view.contentEl;
  assert.equal(root.querySelector('.qrv-expression').textContent, 'resilient');
  assert.equal(root.querySelector('.qrv-meaning').textContent, 'recovers from difficulty');
  root.querySelector('.qrv-row').click();
  await new Promise(setImmediate);
  assert.deepEqual(s.calls, [['edit', 'qiaomu-english-learn-panel'], ['lookup', 'resilient']]);
  view.input.value = 'missing'; view.renderRows();
  assert.equal(root.querySelector('.qrv-row'), null);
  root.querySelector('.qrv-list button').click();
  assert.equal(view.input.value, '');
  assert.ok(root.querySelector('.qrv-row'));
  view.onClose();
});
