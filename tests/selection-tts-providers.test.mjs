import assert from "node:assert/strict";
import test from "node:test";
import {
  AZURE_SPEECH_REGIONS, SPEECH_DEFAULTS, SPEECH_SERVICES, listSpeechVoices, pcmToWav, speechAudio, speechConfig, speechHttpRequest, speechRequest,
} from "../src/selection-tts-providers.js";

test("Azure region choices include saved East Asia and use the same code for speech and voice discovery", async () => {
  assert.ok(AZURE_SPEECH_REGIONS.some(([id, chinese]) => id === "eastasia" && chinese === "东亚"));
  assert.equal(new Set(AZURE_SPEECH_REGIONS.map(([id]) => id)).size, AZURE_SPEECH_REGIONS.length);
  const config = { ...SPEECH_DEFAULTS.azure, region: "eastasia" };
  const speech = await speechRequest("azure", config, "test-key", "Hello");
  assert.equal(speech.url, "https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1");
  let voicesUrl;
  await listSpeechVoices("azure", config, "test-key", async url => {
    voicesUrl = url;
    return { ok: true, json: async () => [] };
  });
  assert.equal(voicesUrl, "https://eastasia.tts.speech.microsoft.com/cognitiveservices/voices/list");
});

test("Aloud service choices retain per-provider settings and the prior OpenAI configuration", () => {
  assert.deepEqual(SPEECH_SERVICES.map(([id]) => id), [
    "openai", "compatible", "azure", "elevenlabs", "gemini", "hume", "minimax", "fish", "inworld", "polly",
  ]);
  const settings = { ttsService: "openai", ttsModel: "tts-1-hd", ttsVoice: "nova", ttsSecretId: "old-key", ttsConfigs: {} };
  assert.deepEqual([speechConfig(settings).model, speechConfig(settings).voice, speechConfig(settings).secretId], ["tts-1-hd", "nova", "old-key"]);
  settings.ttsConfigs = { openai: { model: "gpt-4o-mini-tts", voice: "coral", secretId: "new-key" }, gemini: { voice: "Puck" } };
  assert.equal(speechConfig(settings, "openai").secretId, "new-key");
  assert.equal(speechConfig(settings, "gemini").voice, "Puck");
  assert.equal(speechConfig(settings, "gemini").model, SPEECH_DEFAULTS.gemini.model);
});

test("each service constructs its own Aloud-compatible speech request", async () => {
  const requests = {};
  for (const [service] of SPEECH_SERVICES) {
    const config = service === "compatible" ? { ...SPEECH_DEFAULTS.compatible, base: "https://tts.example" } : SPEECH_DEFAULTS[service];
    requests[service] = await speechRequest(service, config, "test-key", "Read <this>.", new AbortController().signal);
    assert.equal(requests[service].options.method, "POST");
  }
  assert.equal(requests.openai.url, "https://api.openai.com/v1/audio/speech");
  assert.equal(JSON.parse(requests.openai.options.body).input, "Read <this>.");
  assert.equal(requests.azure.options.headers["Ocp-Apim-Subscription-Key"], "test-key");
  assert.match(requests.azure.options.body, /Read &lt;this&gt;/);
  const chinese = await speechRequest("azure", { ...SPEECH_DEFAULTS.azure, voice: "zh-CN-XiaoxiaoNeural" }, "test-key", "你好");
  assert.match(chinese.options.body, /xml:lang='zh-CN'/);
  assert.match(chinese.options.body, /你好/);
  const multilingual = await speechRequest("azure", { ...SPEECH_DEFAULTS.azure,
    voice: "en-US-AvaMultilingualNeural", locale: "zh-CN" }, "test-key", "你好");
  assert.match(multilingual.options.body, /xml:lang='zh-CN'/);
  assert.match(requests.elevenlabs.url, /elevenlabs\.io\/v1\/text-to-speech/);
  assert.equal(JSON.parse(requests.elevenlabs.options.body).model_id, "eleven_multilingual_v2");
  assert.equal(requests.gemini.options.headers["x-goog-api-key"], "test-key");
  assert.ok(!requests.gemini.url.includes("test-key"));
  assert.equal(JSON.parse(requests.hume.options.body).utterances[0].text, "Read <this>.");
  assert.equal(JSON.parse(requests.minimax.options.body).output_format, "hex");
  assert.equal(requests.fish.options.headers.model, "s2-pro");
  assert.equal(requests.inworld.options.headers.Authorization, "Basic test-key");
  assert.match(requests.polly.options.headers.authorization, /^AWS4-HMAC-SHA256 Credential=/);
  await assert.rejects(() => speechRequest("azure", { ...SPEECH_DEFAULTS.azure, region: "evil.com/" }, "key", "text"), /invalid speech region/);
});

test("PCM and encoded JSON responses become playable audio", async () => {
  const pcm = new Uint8Array([1, 0, 2, 0]).buffer;
  const wav = pcmToWav(pcm);
  assert.equal(new TextDecoder().decode(new Uint8Array(wav, 0, 4)), "RIFF");
  assert.equal(wav.byteLength, 48);
  const mock = value => ({ ok: true, json: async () => value });
  const base64 = Buffer.from([1, 2, 3, 4]).toString("base64");
  const gemini = await speechAudio("gemini", {}, mock({ candidates: [{ content: { parts: [{ inlineData: { data: base64 } }] } }] }));
  assert.equal(gemini.format, "wav"); assert.equal(gemini.data.byteLength, 48);
  const hume = await speechAudio("hume", {}, mock({ generations: [{ audio: base64 }] }));
  assert.deepEqual([...new Uint8Array(hume.data)], [1, 2, 3, 4]);
  const minimax = await speechAudio("minimax", {}, mock({ base_resp: { status_code: 0 }, data: { audio: "01020304" } }));
  assert.deepEqual([...new Uint8Array(minimax.data)], [1, 2, 3, 4]);
  const inworld = await speechAudio("inworld", {}, mock({ audioContent: base64 }));
  assert.deepEqual([...new Uint8Array(inworld.data)], [1, 2, 3, 4]);
  await assert.rejects(() => speechAudio("minimax", {}, mock({ base_resp: { status_code: 1001 } })), /MiniMax 1001/);
});

test("voice discovery maps service responses to selectable IDs", async () => {
  const examples = [
    ["azure", [{ ShortName: "en-US-JennyNeural", DisplayName: "Jenny", LocalName: "Jenny", Locale: "en-US", LocaleName: "English (United States)", Gender: "Female" }], "en-US-JennyNeural"],
    ["elevenlabs", { voices: [{ voice_id: "voice-1", name: "Reader" }] }, "voice-1"],
    ["hume", { voices_page: [{ id: "voice-2", name: "Reader" }] }, "voice-2"],
    ["fish", { items: [{ _id: "voice-3", title: "Reader", state: "trained", type: "tts" }] }, "voice-3"],
    ["inworld", { voices: [{ voiceId: "voice-4", displayName: "Reader" }] }, "voice-4"],
    ["polly", { Voices: [{ Id: "Joanna", Name: "Joanna", LanguageName: "English", SupportedEngines: ["neural"] }] }, "Joanna"],
  ];
  for (const [service, payload, id] of examples) {
    const found = await listSpeechVoices(service, SPEECH_DEFAULTS[service], "test-key", async () => ({ ok: true, json: async () => payload }));
    assert.equal(found[0].id, id, service);
    if (service === "azure") assert.deepEqual(
      [found[0].locale, found[0].secondaryLocales, found[0].localeName, found[0].gender],
      ["en-US", [], "English (United States)", "Female"],
    );
  }
});

test("Fish speech and voice discovery use one host request each without browser CORS fetch", async () => {
  const calls = [];
  const browserRequest = () => assert.fail("Fish must not use browser fetch");
  const audio = new Uint8Array([1, 2, 3]).buffer;
  const hostRequest = async options => {
    calls.push(options);
    return options.method === "POST"
      ? { status: 200, arrayBuffer: audio }
      : { status: 200, json: { items: [{ _id: "voice-1", title: "Reader", state: "trained", type: "tts" }] } };
  };
  const speech = await speechRequest("fish", SPEECH_DEFAULTS.fish, "key", "Hello", new AbortController().signal);
  const response = await speechHttpRequest("fish", speech.url, speech.options, browserRequest, hostRequest);
  assert.deepEqual([...new Uint8Array((await speechAudio("fish", SPEECH_DEFAULTS.fish, response)).data)], [1, 2, 3]);
  const voices = await listSpeechVoices("fish", SPEECH_DEFAULTS.fish, "key",
    (url, options) => speechHttpRequest("fish", url, options, browserRequest, hostRequest));
  assert.equal(voices[0].id, "voice-1");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => [call.method || "GET", call.throw]), [["POST", false], ["GET", false]]);
  assert.equal(calls[0].headers.Authorization, "Bearer key");
  assert.equal(calls[0].headers.model, "s2-pro");
  assert.equal(calls[0].body, speech.options.body);
  assert.equal("signal" in calls[0], false);
});

test("Fish host HTTP rejection is reported without retrying through browser fetch", async () => {
  let calls = 0;
  const speech = await speechRequest("fish", SPEECH_DEFAULTS.fish, "key", "Hello");
  const response = await speechHttpRequest("fish", speech.url, speech.options,
    () => assert.fail("no browser fallback"), async () => { calls++; return { status: 401 }; });
  await assert.rejects(() => speechAudio("fish", SPEECH_DEFAULTS.fish, response), /HTTP 401/);
  assert.equal(calls, 1);
});

test("Fish abort ends the local wait and ignores a late uncancellable host response", async () => {
  const controller = new AbortController();
  let complete, calls = 0;
  const pending = speechHttpRequest("fish", "https://api.fish.audio/v1/tts",
    { method: "POST", body: "{}", signal: controller.signal },
    () => assert.fail("no browser fallback"), () => { calls++; return new Promise(resolve => { complete = resolve; }); });
  await Promise.resolve();
  assert.equal(calls, 1);
  controller.abort();
  await assert.rejects(pending, error => error.name === "AbortError");
  complete({ status: 200, arrayBuffer: new Uint8Array([1]).buffer });
  await Promise.resolve();
  assert.equal(calls, 1);

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(speechHttpRequest("fish", "https://api.fish.audio/v1/tts",
    { method: "POST", signal: alreadyAborted.signal }, () => assert.fail("no browser fallback"),
    () => { calls++; }), error => error.name === "AbortError");
  assert.equal(calls, 1);
});
