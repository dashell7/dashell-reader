import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateSpeechSettings } from '../src/tts-migration.js';
import { buildSpeechRequest, ttsProfile } from '../src/tts-providers.js';

test('Azure migration retains the configured voice, region and secret reference without treating encoding as a model', () => {
  const settings = { ttsService: 'azure', ttsSpeed: 1.25, ttsConfigs: {
    azure: { region: 'eastasia', voice: 'en-GB-BellaNeural', secretId: 'azure-reference', model: 'audio-24khz-96kbitrate-mono-mp3' },
  }, ttsBarPosition: 'bottom', ttsBarVisibility: 'always' };
  const original = structuredClone(settings);
  assert.equal(migrateSpeechSettings(settings), true);
  const profile = ttsProfile(settings.tts);
  const request = buildSpeechRequest(profile, 'A short test.', 'synthetic-key');
  assert.equal(request.url, 'https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1');
  assert.match(request.body, /en-GB-BellaNeural/);
  assert.equal(profile.secretId, 'azure-reference');
  assert.equal(settings.tts.profiles.azure.model, undefined);
  assert.equal(settings.tts.rate, 1.25);
  assert.deepEqual(Object.fromEntries(Object.entries(settings).filter(([key]) => key !== 'tts')), original);
  const persisted = JSON.parse(JSON.stringify(settings));
  assert.equal(migrateSpeechSettings(persisted), false);
  assert.deepEqual(persisted, settings);
});

test('legacy compatible addresses preserve the actual endpoint for full URLs, v1 bases and bare/custom bases', () => {
  for (const [base, endpoint] of [
    ['https://voice.example/v1/audio/speech/', 'https://voice.example/v1/audio/speech'],
    ['https://voice.example/v1', 'https://voice.example/v1/audio/speech'],
    [' https://voice.example/gateway/ ', 'https://voice.example/gateway/v1/audio/speech'],
    ['http://localhost:8880', 'http://localhost:8880/v1/audio/speech'],
  ]) {
    const settings = { ttsService: 'compatible', ttsBase: 'https://unused.example', ttsConfigs: {
      compatible: { base, model: 'kokoro', voice: 'af_heart', secretId: 'custom-reference' },
    } };
    migrateSpeechSettings(settings);
    const profile = ttsProfile(settings.tts);
    assert.equal(buildSpeechRequest(profile, 'Hello').url, endpoint);
    assert.equal(profile.secretId, 'custom-reference');
  }
  const settings = { ttsService: 'compatible', ttsBase: 'https://voice.example' };
  migrateSpeechSettings(settings);
  assert.equal(settings.tts.profiles.compatible.baseUrl, 'https://voice.example/v1');
});

test('existing Qiaomu settings take precedence without any changes or a second migration', () => {
  const settings = { tts: { provider: 'edge', profiles: { edge: { voice: 'en-US-AriaNeural' } }, rate: 1.8 },
    ttsService: 'azure', ttsConfigs: { azure: { voice: 'old' } } };
  const original = structuredClone(settings);
  assert.equal(migrateSpeechSettings(settings), false);
  assert.deepEqual(settings, original);
  assert.equal(migrateSpeechSettings({ tts: {} }), false);
});

test('all shared service profiles survive switching, while removed services are retained only in the rollback record', () => {
  const settings = { ttsService: 'gemini', ttsConfigs: {
    openai: { voice: 'nova', secretId: 'openai-reference' },
    minimax: { china: true, model: 'speech-2.6-turbo', voice: 'old-voice', secretId: 'minimax-reference' },
    elevenlabs: { voice: 'voice-id', secretId: 'eleven-reference' },
    gemini: { voice: 'Zephyr', secretId: 'gemini-reference' },
    polly: { accessKeyId: 'legacy-reference' },
  } };
  const legacy = structuredClone(settings.ttsConfigs);
  assert.equal(migrateSpeechSettings(settings), true);
  assert.equal(ttsProfile(settings.tts).id, 'system');
  assert.deepEqual(Object.keys(settings.tts.profiles).sort(), ['elevenlabs', 'minimax', 'openai']);
  assert.equal(buildSpeechRequest(ttsProfile(settings.tts, 'minimax'), 'Hello', 'synthetic-key').url, 'https://api.minimaxi.com/v1/t2a_v2');
  assert.equal(ttsProfile(settings.tts, 'openai').voice, 'nova');
  assert.equal(ttsProfile(settings.tts, 'elevenlabs').model, 'eleven_multilingual_v2');
  assert.deepEqual(settings.ttsConfigs, legacy);
});

test('first-generation OpenAI fields migrate and malformed values never select an inherited provider', () => {
  const settings = { ttsSecretId: 'legacy-reference', ttsVoice: 'shimmer', ttsModel: 'tts-1-hd', ttsSpeed: 8 };
  assert.equal(migrateSpeechSettings(settings), true);
  assert.equal(ttsProfile(settings.tts, 'openai').secretId, 'legacy-reference');
  assert.equal(settings.tts.profiles.openai.model, 'tts-1-hd');
  assert.equal(settings.tts.rate, 2);
  for (const rate of [NaN, Infinity, -1, 0, 'bad']) {
    const values = { ttsService: 'azure', ttsSpeed: rate, ttsConfigs: { azure: [] } };
    migrateSpeechSettings(values); assert.equal(values.tts.rate, 1);
  }
  const values = { ttsService: 'constructor', ttsConfigs: { constructor: {}, azure: null } };
  assert.equal(migrateSpeechSettings(values), false);
  assert.equal(values.tts, undefined);
  assert.equal(migrateSpeechSettings(null), false);
});
