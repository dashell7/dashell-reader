import { TTS_PROVIDERS } from './tts-providers.js';

const record = value => value && typeof value === 'object' && !Array.isArray(value);
const LEGACY_DEFAULTS = {
  openai: { model: 'gpt-4o-mini-tts', voice: 'alloy' },
  compatible: { model: '', voice: '' },
  azure: { region: 'eastus', voice: '' },
  elevenlabs: { model: 'eleven_multilingual_v2', voice: '' },
  minimax: { model: 'speech-2.6-turbo', voice: 'English_expressive_narrator' },
};

function compatibleBase(value) {
  const base = String(value || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  // Aloud appended /v1 to a bare/custom base, unlike Qiaomu's explicit base URL.
  if (base.endsWith('/v1/audio/speech')) return base.slice(0, -'/audio/speech'.length);
  return base.endsWith('/v1') ? base : `${base}/v1`;
}

// Upgrade the retired Aloud settings once without reading or deleting secrets.
// Existing Qiaomu profiles win. Keep the original settings as an inert rollback
// record, including services/advanced options the new component does not support.
export function migrateSpeechSettings(settings) {
  if (!record(settings) || record(settings.tts)) return false;
  const configs = record(settings.ttsConfigs) ? settings.ttsConfigs : {};
  const profiles = {};
  for (const [id, value] of Object.entries(configs)) {
    if (!Object.hasOwn(LEGACY_DEFAULTS, id) || !record(value)) continue;
    const profile = { ...LEGACY_DEFAULTS[id] };
    for (const field of ['secretId', 'voice', 'region', ...(id === 'azure' ? [] : ['model'])]) {
      if (typeof value[field] === 'string') profile[field] = value[field];
    }
    if (id === 'compatible') profile.baseUrl = compatibleBase(value.base ?? settings.ttsBase);
    if (id === 'minimax') profile.baseUrl = value.china ? 'https://api.minimaxi.com/v1' : 'https://api.minimax.io/v1';
    profiles[id] = profile;
  }
  if (!profiles.openai && (settings.ttsService === 'openai' || settings.ttsSecretId || settings.ttsVoice || settings.ttsModel)) {
    profiles.openai = { secretId: settings.ttsSecretId || '', voice: settings.ttsVoice || 'alloy', model: settings.ttsModel || 'gpt-4o-mini-tts' };
  }
  if (!profiles.compatible && settings.ttsBase) profiles.compatible = { ...LEGACY_DEFAULTS.compatible, baseUrl: compatibleBase(settings.ttsBase) };
  const id = settings.ttsService;
  const supported = Object.hasOwn(TTS_PROVIDERS, id);
  if (!supported && !Object.keys(profiles).length) return false;
  const rate = Number(settings.ttsSpeed);
  settings.tts = { profiles, rate: Number.isFinite(rate) && rate > 0 ? Math.min(2, Math.max(0.5, rate)) : 1,
    ...(supported ? { provider: id } : {}) };
  return true;
}
