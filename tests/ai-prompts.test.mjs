import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { readingPrompts, renderPromptEditor } from '../src/ai-prompts.js';
const defaults = [{ id: 'explain', name: '解释', prompt: '解释原文' }];
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(value = null, save = async () => {}) {
  const { window } = new JSDOM('<main></main>');
  const host = window.document.querySelector('main');
  let closed = 0;
  renderPromptEditor(host, { value, defaults, translate: x => x, save, close: () => closed++ });
  const click = key => [...host.querySelectorAll('button')].find(el => el.textContent === key).click();
  const input = (selector, value) => {
    const field = host.querySelector(selector); field.value = value;
    field.dispatchEvent(new window.Event('input')); return field;
  };
  return { host, click, input, closed: () => closed };
}
test('saved custom prompts replace defaults; absent data follows language and empty lists stay empty', () => {
  assert.deepEqual(readingPrompts(undefined, defaults), defaults);
  assert.deepEqual(readingPrompts([], defaults), []);
  const custom = [{ id: 'own', name: '反驳', prompt: '寻找反例' }];
  assert.deepEqual(readingPrompts(custom, defaults), custom);
  assert.deepEqual(readingPrompts([null, {}, { name: '', prompt: 'x' }], defaults), []);
});
test('edit/add/delete/save preserves the full prompt and stable identity without changing source before save', async () => {
  const original = structuredClone(defaults); let saved;
  const x = setup(original, async value => { saved = value; });
  x.input('input', '反例'); x.input('textarea', '<script>只是原文</script>\n寻找反例');
  assert.deepEqual(original, defaults);
  assert.equal(x.host.querySelector('script'), null);
  x.click('add-prompt');
  assert.equal(x.host.ownerDocument.activeElement, x.host.querySelectorAll('input')[1]);
  x.host.querySelectorAll('.qiaomu-reader-prompt-item button')[1].click();
  x.click('save'); await tick();
  assert.deepEqual(saved, [{ id: 'explain', name: '反例', prompt: '<script>只是原文</script>\n寻找反例' }]);
  assert.equal(x.closed(), 1);
});
test('validation and failed persistence retain editable drafts; retry succeeds', async () => {
  let attempts = 0;
  const x = setup([], async () => { if (++attempts === 1) throw Error('disk'); });
  x.click('add-prompt'); x.click('save'); await tick();
  assert.equal(attempts, 0);
  assert.equal(x.host.querySelector('[role=alert]').textContent, 'enter-both-a-name-and-prompt-text');
  x.input('input', '我的问题'); x.input('textarea', '解释一下');
  x.click('save'); await tick();
  assert.equal(x.closed(), 0); assert.equal(x.host.querySelector('textarea').value, '解释一下');
  assert.equal(x.host.querySelector('textarea').disabled, false);
  assert.match(x.host.querySelector('[role=alert]').textContent, /saving-failed/);
  x.click('save'); await tick(); assert.equal(x.closed(), 1);
});
test('restore persists null for translated defaults, deletion persists empty, cancel never saves', async () => {
  let saved = 'unset'; const x = setup([], async value => { saved = value; });
  x.click('restore-defaults'); x.click('save'); await tick(); assert.equal(saved, null);
  const y = setup(null, async value => { saved = value; });
  y.click('delete'); y.click('save'); await tick(); assert.deepEqual(saved, []);
  const z = setup(null, async () => { throw Error('must not save'); });
  z.input('input', 'discard'); z.click('cancel'); assert.equal(z.closed(), 1);
});
test('twenty prompt limit prevents extra drafts and all fields have labels without hover tooltips', () => {
  const x = setup(Array.from({ length: 20 }, (_, i) => ({ id: `${i}`, name: `${i}`, prompt: 'body' })));
  x.click('add-prompt'); assert.equal(x.host.querySelectorAll('input').length, 20);
  assert.ok([...x.host.querySelectorAll('input,textarea')].every(el => el.closest('label')));
  assert.equal(x.host.querySelector('[aria-label],[title]'), null);
});
test('chat buttons and slash menu resolve saved prompts instead of the fixed defaults', () => {
  const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('function aiQuickPrompts(');
  const code = source.slice(start, source.indexOf('function normalizeAiChatHistory', start));
  const read = vm.runInNewContext(`${code}; aiQuickPrompts`, { readingPrompts, defaultAiQuickPrompts: () => defaults });
  assert.deepEqual(read({ aiQuickPrompts: [{ name: '深入思考', prompt: '分析隐含假设' }] })[0].prompt, '分析隐含假设');
  assert.match(source, /const items = aiQuickPrompts\(chat.plugin.settings\)/);
  assert.match(source, /matches = contextualAiQuickPrompts\(chat\)/);
});

function modalFixture(persist = async () => true) {
  const { window } = new JSDOM('<main></main>');
  let options, opened = 0, refreshed = 0, notices = 0, slashClosed = 0;
  const plugin = { settings: { aiQuickPrompts: null }, _saveLocalData: persist };
  const chat = { quickPromptRow: { parentElement: {} }, slashPromptController: { close() { slashClosed++; } } };
  const app = { workspace: { getLeavesOfType: () => [{ view: chat }] } };
  class Modal {
    constructor(app) { this.app = app; this.contentEl = window.document.createElement('div'); this.modalEl = this.contentEl; }
    setTitle() {}
    open() { opened++; window.document.body.append(this.contentEl); this.onOpen(); }
    close() { this.onClose(); this.contentEl.remove(); }
  }
  window.HTMLElement.prototype.empty = function () { this.replaceChildren(); };
  const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('class AiPromptModal extends Modal');
  const code = source.slice(start, source.indexOf('function contextualAiQuickPrompts(', start));
  const open = vm.runInNewContext(`${code}; openAiPromptEditor`, {
    Modal, renderPromptEditor: (_host, value) => { options = value; },
    defaultAiQuickPrompts: () => defaults, qiaomuReaderTranslate: x => x,
    AI_CHAT_VIEW_TYPE: 'chat', renderAiComposerPrompts: () => { refreshed++; },
    Notice: class { constructor() { notices++; } },
  });
  return { plugin, app, open: () => open(app, plugin), options: () => options,
    counts: () => ({ opened, refreshed, notices, slashClosed }) };
}
test('all management entry points share one editor and successful save refreshes chat and slash menus once', async () => {
  const x = modalFixture();
  x.open(); x.open();
  assert.equal(x.counts().opened, 1);
  const custom = [{ id: 'own', name: '反例', prompt: '精确文本\n<script>只是内容</script>' }];
  await x.options().save(custom);
  assert.equal(x.plugin.settings.aiQuickPrompts, custom);
  assert.deepEqual(x.counts(), { opened: 1, refreshed: 1, notices: 1, slashClosed: 1 });
  x.plugin._aiPromptModal.close();
  assert.equal(x.plugin._aiPromptModal, null);
  x.open(); assert.equal(x.counts().opened, 2);
});
test('false persistence restores prior prompts; retries keep the active editor', async () => {
  let attempts = 0;
  const x = modalFixture(async () => ++attempts > 1);
  x.open();
  const custom = [{ id: 'own', name: '反例', prompt: '寻找反例' }];
  await assert.rejects(x.options().save(custom), /could not be saved/);
  assert.equal(x.plugin.settings.aiQuickPrompts, null);
  assert.deepEqual(x.counts(), { opened: 1, refreshed: 0, notices: 0, slashClosed: 0 });
  assert.ok(x.plugin._aiPromptModal);
  await x.options().save(custom);
  assert.equal(x.plugin.settings.aiQuickPrompts, custom);
});
test('closed or unloaded editors reject new saves and late accepted saves do not refresh detached UI', async () => {
  let finish, writes = 0;
  const x = modalFixture(() => { writes++; return new Promise(resolve => { finish = resolve; }); });
  x.open();
  const options = x.options();
  const task = options.save([]);
  x.plugin._aiPromptModal.close();
  x.open(); assert.equal(x.counts().opened, 1, 'a pending accepted save owns the editor slot');
  finish(true); await task;
  assert.equal(writes, 1);
  assert.equal(x.plugin._aiPromptSavePending, false);
  assert.deepEqual(x.counts(), { opened: 1, refreshed: 0, notices: 0, slashClosed: 0 });
  await assert.rejects(options.save(null), /closed/);
  assert.equal(writes, 1);
  x.plugin._unloading = true;
  x.open(); assert.equal(x.counts().opened, 1);
});
