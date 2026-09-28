// Provider request formats adapted from Aloud/open-tts, commit 0bd97a49 (MIT).
import { signPollyRequest } from "./selection-tts-aws.js";

export const SPEECH_MODELS = ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"];
export const SPEECH_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"];
// Azure Speech neural TTS regions: https://learn.microsoft.com/azure/ai-services/speech-service/regions
export const AZURE_SPEECH_REGIONS = [
  ["eastasia", "东亚", "East Asia"], ["southeastasia", "东南亚", "Southeast Asia"],
  ["australiaeast", "澳大利亚东部", "Australia East"], ["centralindia", "印度中部", "Central India"],
  ["japaneast", "日本东部", "Japan East"], ["japanwest", "日本西部", "Japan West"],
  ["koreacentral", "韩国中部", "Korea Central"],
  ["eastus", "美国东部", "East US"], ["eastus2", "美国东部 2", "East US 2"],
  ["centralus", "美国中部", "Central US"], ["northcentralus", "美国中北部", "North Central US"],
  ["southcentralus", "美国中南部", "South Central US"], ["westcentralus", "美国中西部", "West Central US"],
  ["westus", "美国西部", "West US"], ["westus2", "美国西部 2", "West US 2"],
  ["westus3", "美国西部 3", "West US 3"],
  ["canadacentral", "加拿大中部", "Canada Central"], ["canadaeast", "加拿大东部", "Canada East"],
  ["brazilsouth", "巴西南部", "Brazil South"], ["southafricanorth", "南非北部", "South Africa North"],
  ["northeurope", "北欧", "North Europe"], ["westeurope", "西欧", "West Europe"],
  ["francecentral", "法国中部", "France Central"], ["germanywestcentral", "德国中西部", "Germany West Central"],
  ["italynorth", "意大利北部", "Italy North"], ["norwayeast", "挪威东部", "Norway East"],
  ["swedencentral", "瑞典中部", "Sweden Central"],
  ["switzerlandnorth", "瑞士北部", "Switzerland North"], ["switzerlandwest", "瑞士西部", "Switzerland West"],
  ["uksouth", "英国南部", "UK South"], ["ukwest", "英国西部", "UK West"],
  ["uaenorth", "阿联酋北部", "UAE North"], ["qatarcentral", "卡塔尔中部", "Qatar Central"],
];
export const SPEECH_SERVICES = [
  ["openai", "OpenAI"], ["compatible", "OpenAI Compatible (Advanced)"],
  ["azure", "Azure Speech Services"], ["elevenlabs", "ElevenLabs"],
  ["gemini", "Google Gemini"], ["hume", "Hume"], ["minimax", "MiniMax"],
  ["fish", "Fish Audio"], ["inworld", "Inworld"], ["polly", "AWS Polly"],
];
export const SPEECH_DEFAULTS = {
  openai: { model: SPEECH_MODELS[0], voice: "alloy", instructions: "" },
  compatible: { base: "", model: "", voice: "", format: "mp3", generationSpeed: 1 },
  azure: { region: "eastus", voice: "", model: "audio-24khz-96kbitrate-mono-mp3" },
  elevenlabs: { model: "eleven_multilingual_v2", voice: "", stability: 0.5, similarity: 0.75 },
  gemini: { model: "gemini-2.5-flash-preview-tts", voice: "Zephyr", instructions: "" },
  hume: { voice: "", source: "HUME_AI", instructions: "" },
  minimax: { groupId: "", model: "speech-2.6-turbo", voice: "English_expressive_narrator", china: false },
  fish: { model: "s2-pro", voice: "", pause: "none" },
  inworld: { model: "inworld-tts-1", voice: "Ronald" },
  polly: { accessKeyId: "", region: "us-east-1", voice: "Joanna", engine: "neural" },
};
export const SPEECH_STATIC_VOICES = {
  openai: SPEECH_VOICES,
  gemini: ["Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome"],
  minimax: ["English_expressive_narrator"],
};

export function speechService(settings) {
  return Object.hasOwn(SPEECH_DEFAULTS, settings.ttsService) ? settings.ttsService : "openai";
}

export function speechConfig(settings, service = speechService(settings)) {
  const defaults = SPEECH_DEFAULTS[service] || SPEECH_DEFAULTS.openai;
  const legacy = service === "openai" && !settings.ttsConfigs?.openai
    ? { model: settings.ttsModel, voice: settings.ttsVoice, secretId: settings.ttsSecretId } : {};
  const compatibleLegacy = service === "compatible" && !settings.ttsConfigs?.compatible
    ? { base: settings.ttsBase } : {};
  return { ...defaults, ...Object.fromEntries(Object.entries(legacy).filter(([, value]) => value)), ...compatibleLegacy, ...(settings.ttsConfigs?.[service] || {}) };
}

export function speechEndpoint(settings) {
  if (settings.ttsService !== "compatible") return "https://api.openai.com/v1/audio/speech";
  const base = String(settings.ttsBase || settings.ttsConfigs?.compatible?.base || "").trim().replace(/\/+$/, "");
  const url = new URL(base);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("tts-invalid-endpoint");
  if (base.endsWith("/v1/audio/speech")) return base;
  return base.endsWith("/v1") ? `${base}/audio/speech` : `${base}/v1/audio/speech`;
}

const jsonRequest = (url, headers, body, signal) => ({ url, options: { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal } });
const base64Bytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0)).buffer;
const hexBytes = value => Uint8Array.from(value.match(/.{2}/g) || [], pair => parseInt(pair, 16)).buffer;
const xml = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const voiceLocale = voice => /^[a-z]{2,3}-[A-Z]{2}\b/u.exec(voice || "")?.[0] || "en-US";
const region = value => {
  if (!/^[a-z0-9-]+$/u.test(value || "")) throw new Error("invalid speech region");
  return value;
};

// Fish Audio does not allow the Obsidian webview's CORS preflight. Send its
// requests through Obsidian's host API; never replay a failed paid POST.
export async function speechHttpRequest(service, url, options, browserRequest, hostRequest) {
  if (service !== "fish") return browserRequest(url, options);
  if (!hostRequest) throw new Error("tts-host-request-unavailable");
  const { signal, ...hostOptions } = options;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(new DOMException("Aborted", "AbortError"));
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const pending = Promise.resolve().then(() => {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return hostRequest({ url, ...hostOptions, throw: false });
    });
    const response = await Promise.race([pending, aborted]);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      arrayBuffer: async () => response.arrayBuffer,
      json: async () => response.json,
    };
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export function pcmToWav(pcm, sampleRate = 24000) {
  const output = new ArrayBuffer(44 + pcm.byteLength), view = new DataView(output);
  const label = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  label(0, "RIFF"); view.setUint32(4, 36 + pcm.byteLength, true); label(8, "WAVE"); label(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, "data"); view.setUint32(40, pcm.byteLength, true);
  new Uint8Array(output, 44).set(new Uint8Array(pcm));
  return output;
}

export async function speechRequest(service, config, key, text, signal) {
  const bearer = { Authorization: `Bearer ${key}` };
  switch (service) {
    case "openai": return jsonRequest("https://api.openai.com/v1/audio/speech", bearer, {
      model: config.model, voice: config.voice, input: text, response_format: "mp3",
      ...(config.model === "gpt-4o-mini-tts" && config.instructions ? { instructions: config.instructions } : {}),
    }, signal);
    case "compatible": {
      const url = speechEndpoint({ ttsService: "compatible", ttsBase: config.base });
      return jsonRequest(url, key ? bearer : {}, { model: config.model, voice: config.voice, input: text,
        speed: config.generationSpeed || 1, response_format: config.format || "mp3" }, signal);
    }
    case "azure": return { url: `https://${region(config.region)}.tts.speech.microsoft.com/cognitiveservices/v1`, options: {
      method: "POST", headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": config.model },
      body: `<speak version='1.0' xml:lang='${voiceLocale(config.locale || config.voice)}'><voice name='${xml(config.voice)}'>${xml(text)}</voice></speak>`, signal,
    } };
    case "elevenlabs": return jsonRequest(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.voice)}?output_format=mp3_44100_128`,
      { "xi-api-key": key }, { text, model_id: config.model,
        voice_settings: { stability: config.stability, similarity_boost: config.similarity } }, signal);
    case "gemini": return jsonRequest(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
      { "x-goog-api-key": key }, { contents: [{ parts: [{ text: `Read aloud only the content below. ${config.instructions || ""}\nContent: ${text}` }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voice } } } } }, signal);
    case "hume": return jsonRequest("https://api.hume.ai/v0/tts", { "X-Hume-Api-Key": key }, {
      utterances: [{ text, ...(config.voice ? { voice: { id: config.voice, provider: config.source || "HUME_AI" } } : {}),
        ...(config.instructions ? { description: config.instructions } : {}) }], format: { type: "mp3" }, num_generations: 1,
      split_utterances: true,
    }, signal);
    case "minimax": return jsonRequest(`https://${config.china ? "api.minimaxi.com" : "api.minimax.io"}/v1/t2a_v2?GroupId=${encodeURIComponent(config.groupId)}`,
      bearer, { model: config.model, text, stream: false, voice_setting: { voice_id: config.voice, speed: 1, vol: 1, pitch: 0 },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 }, output_format: "hex" }, signal);
    case "fish": return jsonRequest("https://api.fish.audio/v1/tts", { ...bearer, model: config.model }, {
      text: config.pause === "none" ? text : text.replace(/([.!?]["')\]]?)(\s+)/g, `$1 ${config.pause === "long" ? "(long-break)" : "(break)"}$2`),
      reference_id: config.voice, format: "mp3", mp3_bitrate: 128, normalize: config.pause === "none",
    }, signal);
    case "inworld": return jsonRequest("https://api.inworld.ai/tts/v1/voice", { Authorization: `Basic ${key}` }, {
      text, voiceId: config.voice, modelId: config.model, audioConfig: { audioEncoding: "MP3" },
    }, signal);
    case "polly": {
      region(config.region);
      const body = JSON.stringify({ Text: text, OutputFormat: "mp3", VoiceId: config.voice, Engine: config.engine });
      const headers = await signPollyRequest({ method: "POST", region: config.region, path: "/v1/speech", body,
        accessKeyId: config.accessKeyId, secretAccessKey: key });
      return { url: `https://polly.${config.region}.amazonaws.com/v1/speech`, options: { method: "POST", headers, body, signal } };
    }
    default: throw new Error("tts-unknown-service");
  }
}

export async function speechAudio(service, config, response) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (["openai", "azure", "elevenlabs", "fish", "polly"].includes(service)) return { data: await response.arrayBuffer(), format: "mp3" };
  if (service === "compatible") {
    const format = config.format || "mp3", data = await response.arrayBuffer();
    return format === "pcm" ? { data: pcmToWav(data), format: "wav" } : { data, format };
  }
  const result = await response.json();
  if (service === "gemini") {
    const inline = result.candidates?.[0]?.content?.parts?.find(part => part.inlineData)?.inlineData;
    if (!inline?.data) throw new Error("empty audio");
    return { data: pcmToWav(base64Bytes(inline.data)), format: "wav" };
  }
  if (service === "hume") return { data: base64Bytes(result.generations?.[0]?.audio || ""), format: "mp3" };
  if (service === "minimax") {
    if (result.base_resp && result.base_resp.status_code !== 0) throw new Error(`MiniMax ${result.base_resp.status_code || "error"}`);
    return { data: hexBytes(result.data?.audio || ""), format: "mp3" };
  }
  if (service === "inworld") return { data: base64Bytes(result.audioContent || ""), format: "mp3" };
  throw new Error("tts-unknown-service");
}

export async function listSpeechVoices(service, config, key, request = (...args) => window.fetch(...args), signal) {
  let url, headers = {}, options = {};
  if (service === "azure") { url = `https://${region(config.region)}.tts.speech.microsoft.com/cognitiveservices/voices/list`; headers = { "Ocp-Apim-Subscription-Key": key }; }
  else if (service === "elevenlabs") { url = "https://api.elevenlabs.io/v2/voices"; headers = { "xi-api-key": key }; }
  else if (service === "hume") { url = `https://api.hume.ai/v0/tts/voices?provider=${encodeURIComponent(config.source || "HUME_AI")}&page_size=100`; headers = { "X-Hume-Api-Key": key }; }
  else if (service === "fish") { url = "https://api.fish.audio/model?page_size=50&page_number=1&self=true"; headers = { Authorization: `Bearer ${key}` }; }
  else if (service === "inworld") { url = "https://api.inworld.ai/tts/v1/voices"; headers = { Authorization: `Basic ${key}` }; }
  else if (service === "polly") {
    region(config.region);
    url = `https://polly.${config.region}.amazonaws.com/v1/voices`;
    headers = await signPollyRequest({ method: "GET", region: config.region, path: "/v1/voices",
      accessKeyId: config.accessKeyId, secretAccessKey: key });
  } else return [];
  const response = await request(url, { ...options, headers, signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (service === "azure") return data.map(item => ({
    id: item.ShortName, name: item.DisplayName, localName: item.LocalName,
    locale: item.Locale, secondaryLocales: item.SecondaryLocaleList || [], localeName: item.LocaleName,
    gender: item.Gender, status: item.Status,
  }));
  if (service === "elevenlabs") return (data.voices || []).map(item => ({ id: item.voice_id, name: item.name }));
  if (service === "hume") return (data.voices_page || []).map(item => ({ id: item.id, name: item.name }));
  if (service === "fish") return (data.items || []).filter(item => item.state === "trained" && item.type === "tts")
    .map(item => ({ id: item._id, name: item.title }));
  if (service === "inworld") return (data.voices || []).map(item => ({ id: item.voiceId, name: item.displayName }));
  return (data.Voices || []).filter(item => !item.SupportedEngines?.length || item.SupportedEngines.includes(config.engine))
    .map(item => ({ id: item.Id, name: `${item.Name} (${item.LanguageName})` }));
}
