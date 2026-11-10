import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'smol-toml';
import { cliPathCandidates, acpPathCandidates, isNodeEntrypoint, resolveCliPath, resolveAcpPath, probeCliAcp, runCliAi, disposeCliAiSessions } from '../src/ai-cli.js';

test('all providers discover nvm versions with a GUI PATH, in numeric version order', () => {
  const fsApi = { readdirSync: () => ['v9.0.0', 'v24.9.0', 'v24.21.0', 'junk'].map(name => ({ name, isDirectory: () => true })) };
  const options = { home: '/home/test', envPath: '/usr/bin', fsApi, platform: 'linux', pathApi: path.posix };
  for (const id of ['codex-cli', 'claude-cli', 'grok-cli', 'kimi-cli', 'zcode-cli']) {
    for (const get of [cliPathCandidates, acpPathCandidates]) {
      const nvm = get(id, options).filter(file => file.includes('/.nvm/'));
      assert.equal(nvm.length, 3);
      assert.match(nvm[0], /v24\.21\.0/); assert.match(nvm[2], /v9\.0\.0/);
    }
  }
});

test('npm adapter shims launch with sibling Node and stream with a GUI PATH', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-gui-path-'));
  const cli = path.join(root, process.platform === 'win32' ? 'codex.exe' : 'codex'), adapter = path.join(root, 'codex-acp');
  const codexHome = path.join(root, 'codex-home'); fs.mkdirSync(codexHome);
  const configPath = path.join(codexHome, 'config.toml');
  const config = `model = "fixture-model"
model_provider = "fixture-gateway"
notify = ["unsafe-notify"]
[model_providers.fixture-gateway]
name = "Fixture provider"
base_url = "https://gateway.test/v1"
env_key = "FIXTURE_ROUTING_KEY"
wire_api = "responses"
[model_providers.fixture-gateway.http_headers]
X-Fixture = "fixture-header"
[model_providers.fixture-gateway.auth]
command = "unsafe-auth-helper"
[model_providers.unselected]
base_url = "https://unused.test"
[mcp_servers.fixture]
command = "unsafe-mcp"
`;
  const auth = JSON.stringify({ OPENAI_API_KEY:'fixture-auth-key' });
  fs.writeFileSync(configPath, config); fs.writeFileSync(path.join(codexHome,'auth.json'),auth);
  const capture = path.join(root, 'received.json');
  fs.copyFileSync(process.execPath, path.join(root, process.platform === 'win32' ? 'node.exe' : 'node'));
  if (process.platform === 'win32') fs.copyFileSync(process.execPath, cli);
  else fs.writeFileSync(cli, '#!/usr/bin/env node\nconsole.log("codex 1.0");', { mode: 0o700 });
  fs.writeFileSync(adapter, `#!/usr/bin/env node
const readline = require('node:readline');
readline.createInterface({input: process.stdin}).on('line', line => {
 const m=JSON.parse(line); const send=o=>console.log(JSON.stringify(o));
 if(m.method==='initialize') {
  const fs=require('node:fs'),path=require('node:path');
  const read=name=>{const file=path.join(process.env.CODEX_HOME,name);return fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';};
  fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({home:process.env.CODEX_HOME,config:read('config.toml'),auth:read('auth.json'),key:process.env.OPENAI_API_KEY,codexKey:process.env.CODEX_API_KEY}));
  send({id:m.id,result:{protocolVersion:1}});
 }
 if(m.method==='session/new')send({id:m.id,result:{sessionId:'test'}});
 if(m.method==='session/set_mode')send({id:m.id,result:{}});
 if(m.method==='session/prompt'){
  send({method:'session/update',params:{sessionId:'test',update:{sessionUpdate:'agent_message_chunk',content:{text:'CONNECTED'}}}});
  send({id:m.id,result:{stopReason:'end_turn'}});
 }
});`, { mode: 0o700 });
  const prior = globalThis.window;
  // Deny symlinks to exercise the Windows fallback without touching real CLI credentials.
  const isolatedFs = new Proxy(fs,{get(target,key){return key==='symlinkSync'?()=>{throw Error('fixture link denied');}:Reflect.get(target,key);}});
  globalThis.window = { process: { platform: process.platform, env: { PATH: '/usr/bin:/bin', HOME: root, CODEX_HOME: codexHome }, getBuiltinModule: name=>name==='fs'?isolatedFs:process.getBuiltinModule(name) }, setTimeout, clearTimeout };
  try {
    assert.equal(isNodeEntrypoint(adapter, fs), true);
    assert.equal(isNodeEntrypoint(process.execPath, fs), false);
    assert.equal(await resolveCliPath('codex-cli', cli), cli);
    assert.equal(await resolveAcpPath('codex-cli', adapter), adapter);
    const probe = await probeCliAcp('codex-cli', { binaryPath: cli, acpPath: adapter });
    assert.equal(probe.sessionId, 'test');
    const received=JSON.parse(fs.readFileSync(capture,'utf8'));
    assert.notEqual(received.home,codexHome); assert.equal(received.auth,auth); assert.equal(received.key,'fixture-auth-key');
    assert.deepEqual(JSON.parse(JSON.stringify(parse(received.config))),{model:'fixture-model',model_provider:'fixture-gateway',model_providers:{'fixture-gateway':{name:'Fixture provider',base_url:'https://gateway.test/v1',env_key:'FIXTURE_ROUTING_KEY',wire_api:'responses',http_headers:{'X-Fixture':'fixture-header'}}}});
    assert.equal(fs.readFileSync(configPath,'utf8'),config); assert.equal(fs.readFileSync(path.join(codexHome,'auth.json'),'utf8'),auth);
    const answer = await runCliAi('codex-cli', { binaryPath: cli, acpPath: adapter, sessionKey: 'chat', messages: [{ role: 'user', content: 'hello' }] });
    assert.equal(answer.answer, 'CONNECTED');
    disposeCliAiSessions();
    window.process.env.CODEX_API_KEY='fixture-env-codex'; window.process.env.OPENAI_API_KEY='fixture-env-openai';
    await probeCliAcp('codex-cli', { binaryPath: cli, acpPath: adapter });
    const overridden=JSON.parse(fs.readFileSync(capture,'utf8'));
    assert.equal(overridden.codexKey,'fixture-env-codex'); assert.equal(overridden.key,undefined);
    disposeCliAiSessions(); delete window.process.env.CODEX_API_KEY; delete window.process.env.OPENAI_API_KEY;
    fs.unlinkSync(path.join(codexHome,'auth.json'));
    await probeCliAcp('codex-cli', { binaryPath: cli, acpPath: adapter });
    const withoutAuth=JSON.parse(fs.readFileSync(capture,'utf8'));
    assert.notEqual(withoutAuth.home,codexHome); assert.equal(withoutAuth.auth,'');
    disposeCliAiSessions(); fs.writeFileSync(configPath,'invalid = [');
    await assert.rejects(probeCliAcp('codex-cli', { binaryPath: cli, acpPath: adapter }),/Could not read Codex ACP provider configuration/);
  } finally {
    disposeCliAiSessions(); globalThis.window = prior;
    // Windows can hold the just-killed adapter executable briefly after exit.
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
