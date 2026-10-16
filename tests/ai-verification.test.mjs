import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const start = source.indexOf('async function testAndEnableAi(');
const code = source.slice(start, source.indexOf('function openPluginAiSettings(', start));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(testConnection = async () => ({ model: 'model', latency: 1 })) {
  const plugin = { settings: { aiProvider: 'service', aiModel: 'model', aiBase: 'https://api.example', aiKey: 'fixture', aiEnabled: false, aiNeedsVerification: true }, saveAll: async () => true };
  const verify = vm.runInNewContext(`${code}; testAndEnableAi`, {
    aiConfig: p => ({ provider: {}, id: p.settings.aiProvider, model: p.settings.aiModel, base: p.settings.aiBase, key: p.settings.aiKey }),
    ensureAiCliReady: async () => {}, aiTestConnection: testConnection,
    qiaomuReaderTranslate: key => key, accountText: key => key,
  });
  return { plugin, verify };
}

test('failed save does not enable AI or report a successful connection', async () => {
  const { plugin, verify } = fixture();
  plugin.saveAll = async () => false;
  await assert.rejects(verify(plugin), /saveFailed/);
  assert.equal(plugin.settings.aiEnabled, false);
  assert.equal(plugin.settings.aiNeedsVerification, true);
});

for (const [key, value] of [['aiProvider', 'other'], ['aiModel', 'other'], ['aiBase', 'https://other.example'], ['aiKey', 'new-key']]) {
  test(`changing ${key} during a connection test rejects the old result`, async () => {
    const pending = deferred();
    const { plugin, verify } = fixture(() => pending.promise);
    const work = verify(plugin);
    await Promise.resolve(); await Promise.resolve();
    plugin.settings[key] = value;
    pending.resolve({});
    await assert.rejects(work, /configuration changed/);
    assert.equal(plugin.settings.aiEnabled, false);
  });
}

test('a newer verification owns the result even when configuration is unchanged', async () => {
  const first = deferred(), entered = deferred(); let calls = 0;
  const { plugin, verify } = fixture(() => { if (++calls === 1) { entered.resolve(); return first.promise; } return Promise.resolve({}); });
  const old = verify(plugin);
  const rejected = assert.rejects(old, /configuration changed/);
  await entered.promise;
  await verify(plugin);
  first.resolve({});
  await rejected;
  assert.equal(plugin.settings.aiEnabled, true);
});

test('closing the connection dialog prevents a pending test from enabling AI', async () => {
  const pending = deferred(), controller = new AbortController();
  const { plugin, verify } = fixture(() => pending.promise);
  const work = verify(plugin, () => {}, controller.signal);
  await Promise.resolve(); await Promise.resolve();
  controller.abort(); pending.resolve({});
  await assert.rejects(work, /configuration changed/);
  assert.equal(plugin.settings.aiEnabled, false);
});
