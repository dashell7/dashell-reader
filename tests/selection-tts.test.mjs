import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { SelectionSpeechPlayer, speechEndpoint, splitSpeechText } from "../src/selection-tts.js";

test("speech endpoint validates custom hosts and accepts base or full paths", () => {
  assert.equal(speechEndpoint({ ttsService: "openai" }), "https://api.openai.com/v1/audio/speech");
  assert.equal(speechEndpoint({ ttsService: "compatible", ttsBase: "https://tts.example/v1" }), "https://tts.example/v1/audio/speech");
  assert.equal(speechEndpoint({ ttsService: "compatible", ttsBase: "https://tts.example/v1/audio/speech" }), "https://tts.example/v1/audio/speech");
  assert.throws(() => speechEndpoint({ ttsService: "compatible", ttsBase: "http://remote.example" }));
});

test("long selections are split without losing words", () => {
  const source = "First sentence. " + "long ".repeat(800) + "Last sentence!";
  const chunks = splitSpeechText(source, 100);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every(chunk => chunk.length <= 100));
  assert.equal(chunks.join(" ").replace(/\s+/gu, " "), source.replace(/\s+/gu, " "));
});

test("sentence chunks make previous and next controls meaningful for a selected paragraph", () => {
  assert.deepEqual(splitSpeechText("First sentence. Second sentence!"), ["First sentence.", "Second sentence!"]);
  assert.deepEqual(splitSpeechText("第一句话。第二句话。"), ["第一句话。", "第二句话。"]);
});

test("sentence chunks work without Intl.Segmenter on older webviews", () => {
  const segmenter = Intl.Segmenter;
  Intl.Segmenter = undefined;
  try {
    assert.deepEqual(splitSpeechText("First sentence. Second sentence!"), ["First sentence.", "Second sentence!"]);
    assert.deepEqual(splitSpeechText("第一句话。第二句话。"), ["第一句话。", "第二句话。"]);
  } finally { Intl.Segmenter = segmenter; }
});

test("reader speech uses a top toolbar with transport, highlight and live speed controls", async () => {
  const dom = new JSDOM("<main><div class='qiaomu-reader-top'></div><p>First sentence. Second sentence.</p></main>");
  const host = dom.window.document.querySelector("main");
  const proto = dom.window.HTMLElement.prototype;
  proto.createEl = function(tag, opts = {}) { const el = this.ownerDocument.createElement(tag); el.className = typeof opts === "string" ? opts : opts.cls || ""; for (const [key, value] of Object.entries(opts.attr || {})) el.setAttribute(key, value); this.append(el); return el; };
  proto.createDiv = function(cls) { return this.createEl("div", cls); };
  proto.createSpan = function(cls) { return this.createEl("span", cls); };
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => {};
  dom.window.CSS = { highlights: new Map() };
  dom.window.Highlight = class { constructor(...ranges) { this.ranges = ranges; } };
  dom.window.HTMLMediaElement.prototype.play = function() { return Promise.resolve(); };
  dom.window.HTMLMediaElement.prototype.pause = function() {};
  let saves = 0;
  let openedSettings = 0;
  const settings = { ttsService: "openai", ttsSecretId: "key", ttsVoice: "nova", ttsSpeed: 1 };
  const range = dom.window.document.createRange();
  range.selectNodeContents(host.querySelector("p"));
  const player = new SelectionSpeechPlayer({
    app: { secretStorage: { getSecret: () => "test-key" } }, settings,
    settingsTab: { openSpeechSettings: () => { openedSettings++; } },
    saveAll: async () => { saves++; },
  }, { translate: key => key, icon: () => {}, onError: error => assert.fail(error),
    request: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) });
  try {
    const pending = player.play("First sentence. Second sentence.", host, { range });
    await new Promise(resolve => setTimeout(resolve, 0));
    const bar = host.querySelector(".qiaomu-reader-speech-docked");
    assert.ok(bar);
    assert.equal(host.classList.contains("qiaomu-reader-speech-active"), true);
    assert.deepEqual([...bar.querySelectorAll("[data-control]")].map(item => item.dataset.control),
      ["restart", "previous", "pause", "next", "highlight", "speed", "more", "stop"]);
    assert.equal(dom.window.CSS.highlights.has("qiaomu-reader-speech"), true);
    assert.equal(bar.querySelector('[data-control="previous"]').disabled, true);
    assert.equal(bar.querySelector('[data-control="next"]').disabled, false);
    bar.querySelector('[data-control="next"]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(bar.querySelector('[data-control="previous"]').disabled, false);
    assert.equal(bar.querySelector('[data-control="next"]').disabled, true);
    bar.querySelector('[data-control="pause"]').click();
    assert.equal(player.session.paused, true);
    assert.equal(bar.querySelector('[data-control="pause"]').textContent, "tts-resume");
    bar.querySelector('[data-control="pause"]').click();
    assert.equal(player.session.paused, false);
    bar.querySelector('[data-control="highlight"]').click();
    assert.equal(dom.window.CSS.highlights.has("qiaomu-reader-speech"), false);
    bar.querySelector('[data-control="highlight"]').click();
    assert.equal(dom.window.CSS.highlights.has("qiaomu-reader-speech"), true);
    bar.querySelector('[data-control="speed"]').click();
    const speed = bar.querySelector('input[type="range"]');
    assert.equal(speed.parentElement.hidden, false);
    speed.value = "1.5";
    speed.dispatchEvent(new dom.window.Event("input"));
    speed.dispatchEvent(new dom.window.Event("change"));
    assert.equal(settings.ttsSpeed, 1.5);
    assert.equal(player.session.audio.playbackRate, 1.5);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(saves, 1);
    dom.window.document.body.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
    assert.equal(speed.parentElement.hidden, true);
    bar.querySelector('[data-control="more"]').click();
    assert.equal(bar.querySelector(".qiaomu-reader-speech-menu").hidden, false);
    bar.querySelector(".qiaomu-reader-speech-menu button").click();
    assert.equal(openedSettings, 1);
    bar.querySelector('[data-control="stop"]').click();
    assert.equal(await pending, false);
    assert.equal(host.classList.contains("qiaomu-reader-speech-active"), false);
    assert.equal(dom.window.CSS.highlights.has("qiaomu-reader-speech"), false);
    assert.equal(host.querySelector(".qiaomu-reader-speech-docked"), null);
  } finally {
    player.stop();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    dom.window.close();
  }
});

test("speech plays selected text, exposes controls, and releases its audio URL", async () => {
  const dom = new JSDOM("<main></main>");
  const host = dom.window.document.querySelector("main");
  const proto = dom.window.HTMLElement.prototype;
  proto.createEl = function(tag, opts = {}) { const el = this.ownerDocument.createElement(tag); el.className = typeof opts === "string" ? opts : opts.cls || ""; for (const [key, value] of Object.entries(opts.attr || {})) el.setAttribute(key, value); this.append(el); return el; };
  proto.createDiv = function(cls) { return this.createEl("div", cls); };
  proto.createSpan = function(cls) { return this.createEl("span", cls); };
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const revoked = [], requests = [];
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = value => revoked.push(value);
  dom.window.HTMLMediaElement.prototype.play = function() { setTimeout(() => this.onended?.(), 0); return Promise.resolve(); };
  dom.window.HTMLMediaElement.prototype.pause = function() {};
  try {
    const plugin = { app: { secretStorage: { getSecret: () => "test-key" } }, settings: { ttsService: "openai", ttsSecretId: "key", ttsVoice: "nova", ttsSpeed: 1.2 } };
    const player = new SelectionSpeechPlayer(plugin, {
      translate: key => key, icon: () => {}, onError: error => assert.fail(error),
      request: async (url, options) => { requests.push({ url, options }); return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; },
    });
    await player.play("Read this sentence.", host);
    assert.equal(requests.length, 1);
    assert.equal(JSON.parse(requests[0].options.body).voice, "nova");
    assert.equal(JSON.parse(requests[0].options.body).input, "Read this sentence.");
    assert.deepEqual(revoked, ["blob:test"]);
    assert.equal(host.querySelector(".qiaomu-reader-speech-bar"), null);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    dom.window.close();
  }
});

test("reading a Chinese selection chooses an Azure voice without changing the saved English voice", async () => {
  const dom = new JSDOM("<main></main>");
  const host = dom.window.document.querySelector("main");
  const proto = dom.window.HTMLElement.prototype;
  proto.createEl = function(tag, opts = {}) { const el = this.ownerDocument.createElement(tag); el.className = typeof opts === "string" ? opts : opts.cls || ""; for (const [key, value] of Object.entries(opts.attr || {})) el.setAttribute(key, value); this.append(el); return el; };
  proto.createDiv = function(cls) { return this.createEl("div", cls); };
  proto.createSpan = function(cls) { return this.createEl("span", cls); };
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => {};
  dom.window.HTMLMediaElement.prototype.play = function() { setTimeout(() => this.onended?.(), 0); return Promise.resolve(); };
  dom.window.HTMLMediaElement.prototype.pause = function() {};
  const settings = { ttsService: "azure", ttsConfigs: { azure: { region: "eastasia", secretId: "key", voice: "en-GB-AlfieNeural",
    model: "audio-24khz-96kbitrate-mono-mp3" } }, ttsSpeed: 1, ttsAutoLanguage: true };
  const requests = [];
  const player = new SelectionSpeechPlayer({ app: { secretStorage: { getSecret: () => "test-key" } }, settings }, {
    translate: key => key, icon: () => {}, onError: error => assert.fail(error),
    request: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/voices/list")) return { ok: true, json: async () => [
        { ShortName: "en-GB-AlfieNeural", DisplayName: "Alfie", Locale: "en-GB", Status: "GA" },
        { ShortName: "zh-CN-XiaoxiaoNeural", DisplayName: "Xiaoxiao", Locale: "zh-CN", Status: "GA" },
      ] };
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    },
  });
  try {
    assert.equal(await player.play("阳光穿过空中的雨滴，形成一道彩虹。", host), true);
    assert.equal(requests.filter(item => item.url.endsWith("/voices/list")).length, 1);
    assert.match(requests.at(-1).options.body, /xml:lang='zh-CN'.*zh-CN-XiaoxiaoNeural/u);
    assert.equal(settings.ttsConfigs.azure.voice, "en-GB-AlfieNeural");
    assert.equal(await player.play("bank", host), true);
    assert.match(requests.at(-1).options.body, /en-GB-AlfieNeural/u);
    assert.equal(await player.play("今天的天气很好，阳光照在河边的树上。", host), true);
    assert.equal(requests.filter(item => item.url.endsWith("/voices/list")).length, 1);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    dom.window.close();
  }
});

test("Azure reads English and Chinese runs in order with matching voices", async () => {
  const dom = new JSDOM("<main></main>");
  const host = dom.window.document.querySelector("main");
  const proto = dom.window.HTMLElement.prototype;
  proto.createEl = function(tag, opts = {}) { const el = this.ownerDocument.createElement(tag); el.className = typeof opts === "string" ? opts : opts.cls || ""; for (const [key, value] of Object.entries(opts.attr || {})) el.setAttribute(key, value); this.append(el); return el; };
  proto.createDiv = function(cls) { return this.createEl("div", cls); };
  proto.createSpan = function(cls) { return this.createEl("span", cls); };
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => {};
  dom.window.HTMLMediaElement.prototype.play = function() { setTimeout(() => this.onended?.(), 0); return Promise.resolve(); };
  dom.window.HTMLMediaElement.prototype.pause = function() {};
  const settings = { ttsService: "azure", ttsConfigs: { azure: { region: "eastasia", secretId: "key", voice: "en-GB-AlfieNeural",
    model: "audio-24khz-96kbitrate-mono-mp3" } }, ttsSpeed: 1, ttsAutoLanguage: true };
  const bodies = [];
  let voiceLists = 0;
  const player = new SelectionSpeechPlayer({ app: { secretStorage: { getSecret: () => "test-key" } }, settings }, {
    translate: key => key, icon: () => {}, onError: error => assert.fail(error),
    request: async (url, options) => {
      if (url.endsWith("/voices/list")) {
        voiceLists++;
        return { ok: true, json: async () => [
          { ShortName: "en-GB-AlfieNeural", DisplayName: "Alfie", Locale: "en-GB", Status: "GA" },
          { ShortName: "zh-CN-XiaoxiaoNeural", DisplayName: "Xiaoxiao", Locale: "zh-CN", Status: "GA" },
          { ShortName: "ja-JP-NanamiNeural", DisplayName: "Nanami", Locale: "ja-JP", Status: "GA" },
        ] };
      }
      bodies.push(options.body);
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    },
  });
  try {
    assert.equal(await player.play("Read it. 读出来吧。", host), true);
    assert.equal(voiceLists, 1);
    assert.equal(bodies.length, 2);
    assert.match(bodies[0], /xml:lang='en-GB'.*en-GB-AlfieNeural.*Read it\./u);
    assert.match(bodies[1], /xml:lang='zh-CN'.*zh-CN-XiaoxiaoNeural.*读出来吧。/u);

    bodies.length = 0;
    settings.ttsConfigs.azure.voice = "zh-CN-XiaoxiaoNeural";
    assert.equal(await player.play("请读 The sunlight passes through raindrops and creates a rainbow in the sky.", host), true);
    assert.equal(voiceLists, 1);
    assert.equal(bodies.length, 2);
    assert.match(bodies[0], /xml:lang='zh-CN'.*zh-CN-XiaoxiaoNeural.*请读/u);
    assert.match(bodies[1], /xml:lang='en-GB'.*en-GB-AlfieNeural.*The sunlight passes/u);

    bodies.length = 0;
    assert.equal(await player.play("请读 bank.", host), true);
    assert.equal(bodies.length, 2);
    assert.match(bodies[1], /xml:lang='zh-CN'.*zh-CN-XiaoxiaoNeural.*bank\./u);

    bodies.length = 0;
    settings.ttsConfigs.azure.voice = "en-GB-AlfieNeural";
    assert.equal(await player.play("中文こんにちは中文", host), true);
    assert.equal(bodies.length, 3);
    assert.match(bodies[0], /xml:lang='zh-CN'.*zh-CN-XiaoxiaoNeural.*中文/u);
    assert.match(bodies[1], /xml:lang='ja-JP'.*ja-JP-NanamiNeural.*こんにちは/u);
    assert.match(bodies[2], /xml:lang='zh-CN'.*zh-CN-XiaoxiaoNeural.*中文/u);
  } finally {
    player.stop();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    dom.window.close();
  }
});

test("default speech request calls the reader window fetch with its required receiver", async () => {
  const dom = new JSDOM("<main></main>");
  const host = dom.window.document.querySelector("main");
  const proto = dom.window.HTMLElement.prototype;
  proto.createEl = function(tag, opts = {}) { const el = this.ownerDocument.createElement(tag); el.className = typeof opts === "string" ? opts : opts.cls || ""; this.append(el); return el; };
  proto.createDiv = function(cls) { return this.createEl("div", cls); };
  proto.createSpan = function(cls) { return this.createEl("span", cls); };
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  let called = false;
  dom.window.fetch = function() {
    assert.equal(this, dom.window);
    called = true;
    return Promise.resolve({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer });
  };
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => {};
  dom.window.HTMLMediaElement.prototype.play = function() { setTimeout(() => this.onended?.(), 0); return Promise.resolve(); };
  dom.window.HTMLMediaElement.prototype.pause = function() {};
  try {
    const player = new SelectionSpeechPlayer({
      app: { secretStorage: { getSecret: () => "key" } },
      settings: { ttsService: "openai", ttsConfigs: {} },
    }, { translate: key => key, icon: () => {}, onError: error => assert.fail(error) });
    assert.equal(await player.play("Read this.", host), true);
    assert.equal(called, true);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    dom.window.close();
  }
});

test("Fish playback uses the injected Obsidian host request and plays its binary response", async () => {
  const dom = new JSDOM("<main></main>");
  const host = dom.window.document.querySelector("main");
  const proto = dom.window.HTMLElement.prototype;
  proto.createEl = function(tag, opts = {}) { const el = this.ownerDocument.createElement(tag); el.className = typeof opts === "string" ? opts : opts.cls || ""; this.append(el); return el; };
  proto.createDiv = function(cls) { return this.createEl("div", cls); };
  proto.createSpan = function(cls) { return this.createEl("span", cls); };
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const calls = [];
  let played = false;
  dom.window.fetch = () => assert.fail("Fish must not use browser fetch");
  URL.createObjectURL = () => "blob:fish";
  URL.revokeObjectURL = () => {};
  dom.window.HTMLMediaElement.prototype.play = function() { played = true; setTimeout(() => this.onended?.(), 0); return Promise.resolve(); };
  dom.window.HTMLMediaElement.prototype.pause = function() {};
  try {
    const player = new SelectionSpeechPlayer({
      app: { secretStorage: { getSecret: () => "fish-key" } },
      settings: { ttsService: "fish", ttsConfigs: { fish: { voice: "voice-1" } } },
    }, { translate: key => key, icon: () => {}, onError: error => assert.fail(error),
      hostRequest: async options => { calls.push(options); return { status: 200, arrayBuffer: new Uint8Array([1, 2, 3]).buffer }; } });
    assert.equal(await player.play("Read this.", host), true);
    assert.equal(played, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.fish.audio/v1/tts");
    assert.equal(JSON.parse(calls[0].body).reference_id, "voice-1");
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    dom.window.close();
  }
});

test("stopping a pending speech request prevents late audio playback", async () => {
  const dom = new JSDOM("<main></main>");
  const host = dom.window.document.querySelector("main");
  const proto = dom.window.HTMLElement.prototype;
  proto.createEl = function(tag, opts = {}) { const el = this.ownerDocument.createElement(tag); el.className = typeof opts === "string" ? opts : opts.cls || ""; for (const [key, value] of Object.entries(opts.attr || {})) el.setAttribute(key, value); this.append(el); return el; };
  proto.createDiv = function(cls) { return this.createEl("div", cls); };
  proto.createSpan = function(cls) { return this.createEl("span", cls); };
  let finishRequest, played = false;
  dom.window.HTMLMediaElement.prototype.play = () => { played = true; return Promise.resolve(); };
  const plugin = { app: { secretStorage: { getSecret: () => "test-key" } }, settings: { ttsService: "openai", ttsSecretId: "key" } };
  const player = new SelectionSpeechPlayer(plugin, {
    translate: key => key, icon: () => {}, onError: error => assert.fail(error),
    request: () => new Promise(resolve => { finishRequest = resolve; }),
  });
  const pending = player.play("Selected words", host);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(host.querySelector(".qiaomu-reader-speech-bar"));
  player.stop();
  finishRequest({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer });
  await pending;
  assert.equal(played, false);
  assert.equal(host.querySelector(".qiaomu-reader-speech-bar"), null);
  dom.window.close();
});
