import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const obsidianStub = `
export class FuzzySuggestModal {
  constructor() { this.titleEl = { setText() {} }; }
  setPlaceholder() { return this; }
  open() {}
}
export class SecretComponent {
  setValue() { return this; }
  onChange() { return this; }
}
export class Setting {
  constructor(host) {
    const document = host.ownerDocument;
    this.settingEl = document.createElement("div");
    this.descEl = document.createElement("div");
    this.settingEl.append(this.descEl);
    host.append(this.settingEl);
  }
  setName(value) { this.settingEl.dataset.name = value; return this; }
  setDesc(value) { this.descEl.textContent = value; return this; }
  addButton(attach) {
    const element = this.settingEl.ownerDocument.createElement("button");
    this.settingEl.append(element);
    const component = {
      setButtonText(value) { element.textContent = value; return this; },
      setDisabled(value) { element.disabled = value; return this; },
      onClick(handler) { element.addEventListener("click", handler); return this; },
    };
    attach(component);
    return this;
  }
  addComponent(attach) { attach(this.settingEl); return this; }
  addDropdown(attach) { const input = this.input(); this.settingEl._dropdown = input; attach(input); return this; }
  addText(attach) { attach(this.input()); return this; }
  addTextArea(attach) { attach(this.input()); return this; }
  addSlider(attach) { attach(this.input()); return this; }
  input() {
    return {
      options: [],
      addOption(value, label) { this.options.push([value, label]); return this; }, setPlaceholder() { return this; },
      setLimits() { return this; }, setValue(value) { this.value = value; return this; },
      onChange(handler) { this.handler = handler; return this; },
    };
  }
}
`;

async function loadSettingsRenderer() {
  const entry = fileURLToPath(new URL("../src/selection-tts-settings.js", import.meta.url));
  const result = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false,
    plugins: [{ name: "obsidian-test-double", setup(buildContext) {
      buildContext.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-double" }));
      buildContext.onLoad({ filter: /.*/, namespace: "test-double" }, () => ({ contents: obsidianStub, loader: "js" }));
    } }] });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
}

test("non-Azure voice preview can be played again after success or failure", async () => {
  const { renderSpeechSettings } = await loadSettingsRenderer();
  const dom = new JSDOM("<main class='qiaomu-reader-settings-root'><div id='speech'></div></main>");
  const host = dom.window.document.querySelector("#speech");
  host.createEl = (tag, options = {}) => {
    const element = dom.window.document.createElement(tag);
    if (options.cls) element.className = options.cls;
    host.append(element);
    return element;
  };
  let finishPlayback, calls = 0;
  const plugin = {
    app: {},
    settings: { language: "zh", ttsService: "openai", ttsConfigs: { openai: { model: "tts-1", voice: "nova" } } },
    selectionSpeech: { play: () => { calls++; return new Promise(resolve => { finishPlayback = resolve; }); } },
  };
  try {
    renderSpeechSettings(host, plugin, { translate: value => value, save: async () => {}, redraw: () => {},
      withSliderValue: value => value });
    const button = [...host.querySelectorAll("button")].find(item => item.textContent === "tts-play");
    assert.ok(button);
    button.click();
    assert.equal(button.disabled, true);
    finishPlayback(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(button.disabled, false);
    button.click();
    assert.equal(calls, 2);
    finishPlayback(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(button.disabled, false);
    assert.equal(host.querySelector('[data-name="tts-test-voice"]').firstElementChild.textContent, "tts-test-failed");
  } finally { dom.window.close(); }
});

test("speech toolbar settings default to fixed at the top and save Aloud visibility choices", async () => {
  const { renderSpeechSettings } = await loadSettingsRenderer();
  const dom = new JSDOM("<main id='speech'></main>");
  const host = dom.window.document.querySelector("#speech");
  host.createEl = (tag, options = {}) => {
    const element = dom.window.document.createElement(tag);
    if (options.cls) element.className = options.cls;
    for (const [key, value] of Object.entries(options.attr || {})) element.setAttribute(key, value);
    host.append(element);
    return element;
  };
  let saves = 0;
  const plugin = {
    app: {},
    settings: { language: "zh", ttsService: "openai", ttsConfigs: {} },
    selectionSpeech: { play: async () => true },
  };
  try {
    renderSpeechSettings(host, plugin, { translate: value => value, save: async () => { saves++; }, redraw: () => {},
      withSliderValue: value => value });
    const position = host.querySelector('[data-name="tts-bar-position"]')._dropdown;
    const display = host.querySelector('[data-name="tts-bar-display"]');
    assert.equal(position.value, "top");
    assert.deepEqual(position.options, [["top", "tts-position-top"], ["bottom", "tts-position-bottom"]]);
    assert.equal(display._dropdown.value, "fixed");
    assert.deepEqual(display._dropdown.options, [["fixed", "tts-bar-display-fixed"], ["auto-hide", "tts-bar-display-auto-hide"]]);
    const visibility = host.querySelector('[data-name="tts-bar-visibility"]');
    assert.equal(visibility._dropdown.value, "playing");
    assert.deepEqual(visibility._dropdown.options, [["always", "tts-bar-visibility-always"], ["always-mobile", "tts-bar-visibility-always-mobile"], ["playing", "tts-bar-visibility-playing"], ["never", "tts-bar-visibility-never"]]);
    await position.handler("bottom");
    await display._dropdown.handler("auto-hide");
    await visibility._dropdown.handler("always");
    assert.equal(plugin.settings.ttsBarPosition, "bottom");
    assert.equal(plugin.settings.ttsBarDisplay, "auto-hide");
    assert.equal(plugin.settings.ttsBarVisibility, "always");
    assert.equal(saves, 3);
  } finally { dom.window.close(); }
});

test("Fish voice picker discovers voices through the host request", async () => {
  const { renderSpeechSettings } = await loadSettingsRenderer();
  const dom = new JSDOM("<main id='speech'></main>");
  const host = dom.window.document.querySelector("#speech");
  host.createEl = (tag, options = {}) => {
    const element = dom.window.document.createElement(tag);
    if (options.cls) element.className = options.cls;
    host.append(element);
    return element;
  };
  dom.window.fetch = () => assert.fail("Fish voice discovery must not use browser fetch");
  const calls = [];
  const plugin = {
    app: { secretStorage: { getSecret: () => "fish-key" } },
    settings: { language: "zh", ttsService: "fish", ttsConfigs: { fish: { secretId: "fish-secret" } } },
    selectionSpeech: { hostRequest: async options => {
      calls.push(options);
      return { status: 200, json: { items: [{ _id: "voice-1", title: "Reader", state: "trained", type: "tts" }] } };
    } },
  };
  try {
    renderSpeechSettings(host, plugin, { translate: value => value, save: async () => {}, redraw: () => {},
      withSliderValue: value => value });
    host.querySelector('[data-name="tts-voice"] button').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.fish.audio/model?page_size=50&page_number=1&self=true");
    assert.equal(calls[0].headers.Authorization, "Bearer fish-key");
    assert.equal(calls[0].throw, false);
  } finally { dom.window.close(); }
});
