import { FuzzySuggestModal, SecretComponent, Setting } from "obsidian";
import { AZURE_SPEECH_REGIONS, listSpeechVoices, SPEECH_MODELS, SPEECH_SERVICES, SPEECH_STATIC_VOICES, speechConfig, speechHttpRequest, speechService } from "./selection-tts-providers.js";
import { prepareSpeechLanguages, prepareSpeechVoices, speechTestSample, speechVoicesForLocale } from "./selection-tts-voice-options.js";

class SpeechVoicePicker extends FuzzySuggestModal {
  constructor(app, voices, choose, translate) {
    super(app);
    this.voices = voices;
    this.choose = choose;
    this.titleEl.setText(translate("tts-choose-voice"));
    this.setPlaceholder(translate("tts-search-voices"));
  }

  getItems() { return this.voices; }
  getItemText(voice) { return voice.searchText; }
  renderSuggestion(match, el) {
    el.createDiv({ cls: "qiaomu-reader-voice-label", text: match.item.label });
    el.createDiv({ cls: "qiaomu-reader-voice-id", text: match.item.id });
  }
  onChooseItem(voice) { void this.choose(voice); }
}

class SpeechLanguagePicker extends FuzzySuggestModal {
  constructor(app, languages, choose, translate) {
    super(app);
    this.languages = languages;
    this.choose = choose;
    this.titleEl.setText(translate("tts-test-language"));
    this.setPlaceholder(translate("tts-search-languages"));
  }

  getItems() { return this.languages; }
  getItemText(language) { return language.searchText; }
  renderSuggestion(match, el) { el.setText(match.item.label); }
  onChooseItem(language) { void this.choose(language); }
}

export function renderSpeechSettings(host, plugin, { translate: t, save, redraw, withSliderValue }) {
  const window = host.ownerDocument.defaultView;
  const settings = plugin.settings;
  const service = speechService(settings);
  const config = speechConfig(settings, service);
  const update = async (field, value) => {
    settings.ttsConfigs = { ...(settings.ttsConfigs || {}), [service]: { ...speechConfig(settings, service), [field]: value } };
    await save();
  };
  const field = (key, name = key) => new Setting(host).setName(t(name));
  const text = (key, value = "", placeholder = "") => field(key).addText(input => input
    .setPlaceholder(placeholder).setValue(String(config[value] ?? ""))
    .onChange(async next => { await update(value, next.trim()); }));
  const dropdown = (key, name, options, value) => field(key, name).addDropdown(input => {
    for (const [id, label] of options) input.addOption(id, label);
    input.setValue(String(config[value] ?? options[0]?.[0] ?? ""))
      .onChange(async next => { await update(value, next); if (service === "openai" && value === "model") redraw(); });
  });
  const slider = (key, value, min, max, step) => field(key).addSlider(input => withSliderValue(input
    .setLimits(min, max, step).setValue(Number(config[value]) || min))
    .onChange(async next => { await update(value, next); }));
  const instructions = () => field("tts-voice-instructions").addTextArea(input => input
    .setValue(config.instructions || "").onChange(async next => { await update("instructions", next); }));
  let voiceInput, voiceCatalog, voiceCatalogKey, updateTestVoiceState = () => {};
  const loadVoices = async (row, button) => {
    const latest = speechConfig(settings, service);
    const key = plugin.app.secretStorage?.getSecret(latest.secretId || "");
    if (!key) { row.setDesc(t("tts-key-required")); return null; }
    const identity = JSON.stringify([service, latest.secretId, latest.region, latest.source]);
    if (voiceCatalog && voiceCatalogKey === identity) return voiceCatalog;
    button.setDisabled(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const voices = await listSpeechVoices(service, latest, key,
        (url, options) => speechHttpRequest(service, url, options, (...args) => window.fetch(...args),
          plugin.selectionSpeech?.hostRequest), controller.signal);
      if (!row.settingEl.isConnected || speechService(settings) !== service) return null;
      voiceCatalog = voices;
      voiceCatalogKey = identity;
      row.setDesc(t("tts-voices-loaded").replace("{0}", String(voices.length)));
      return voices;
    } catch { row.setDesc(t("tts-voices-failed")); return null; }
    finally { window.clearTimeout(timeout); button.setDisabled(false); }
  };
  const chooseVoice = async (row, button, locale = "") => {
    const voices = await loadVoices(row, button);
    if (!voices) return;
    const matching = locale ? speechVoicesForLocale(voices, locale) : voices;
    if (!matching.length) { row.setDesc(t("tts-no-voices-language")); return; }
    new SpeechVoicePicker(plugin.app,
      prepareSpeechVoices(matching, settings.language, t, speechConfig(settings, service).voice, locale), async entry => {
        if (!voiceInput?.inputEl.isConnected || speechService(settings) !== service) return;
        voiceInput.setValue(entry.id);
        await update("voice", entry.id);
        updateTestVoiceState();
      }, t).open();
  };
  const voice = (discover = false) => {
    const row = field("tts-voice");
    const choices = SPEECH_STATIC_VOICES[service];
    if (choices?.length && service !== "minimax") {
      row.addDropdown(input => {
        for (const id of choices) input.addOption(id, id);
        input.setValue(config.voice || choices[0]).onChange(async next => { await update("voice", next); });
      });
      return;
    }
    row.addText(input => {
      voiceInput = input;
      input.setValue(config.voice || "").onChange(async next => { await update("voice", next.trim()); updateTestVoiceState(); });
    });
    if (discover) row.addButton(button => button.setButtonText(t("tts-load-voices"))
      .onClick(() => chooseVoice(row, button)));
  };

  field("tts-service").addDropdown(input => {
    for (const [id, label] of SPEECH_SERVICES) input.addOption(id, label);
    input.setValue(service).onChange(async next => { settings.ttsService = next; await save(); redraw(); });
  });
  const secret = field(service === "polly" ? "tts-aws-secret" : "tts-api-key")
    .setDesc(t(service === "compatible" ? "tts-key-optional" : "tts-secret-desc"));
  if (service === "polly") text("tts-access-id", "accessKeyId", "AKIA...");
  if (typeof SecretComponent === "function" && plugin.app.secretStorage) {
    secret.addComponent(el => new SecretComponent(plugin.app, el)
      .setValue(config.secretId || "")
      .onChange(async id => { await update("secretId", id || ""); }));
  } else secret.setDesc(t("tts-secret-unavailable"));

  if (service === "openai") {
    dropdown("tts-model", "tts-model", SPEECH_MODELS.map(id => [id, id]), "model"); voice();
    if (config.model === SPEECH_MODELS[0]) instructions();
  } else if (service === "compatible") {
    text("tts-endpoint", "base", "https://example.com");
    text("tts-model", "model"); voice();
    slider("tts-generation-speed", "generationSpeed", 0.3, 2.5, 0.05);
    dropdown("tts-format", "tts-format", [["mp3", "MP3"], ["wav", "WAV"], ["pcm", "PCM"]], "format");
  } else if (service === "azure") {
    const savedRegion = config.region || "";
    const knownRegion = AZURE_SPEECH_REGIONS.some(([id]) => id === savedRegion);
    const regionRow = field("tts-region");
    const customRow = field("tts-custom-region");
    let customInput;
    customRow.addText(input => {
      customInput = input;
      input.setValue(savedRegion).onChange(async next => {
        const region = next.trim();
        if (!/^[a-z0-9-]+$/u.test(region)) {
          customRow.setDesc(t("tts-region-invalid"));
          return;
        }
        customRow.setDesc("");
        await update("region", region);
      });
    });
    customRow.settingEl.hidden = knownRegion;
    regionRow.addDropdown(input => {
      for (const [id, chinese, english] of AZURE_SPEECH_REGIONS) {
        input.addOption(id, `${settings.language === "zh" ? chinese : english} (${id})`);
      }
      input.addOption("custom", t("tts-custom-region"));
      input.setValue(knownRegion ? savedRegion : "custom").onChange(async next => {
        customRow.settingEl.hidden = next !== "custom";
        if (next === "custom") {
          customInput.setValue(speechConfig(settings, service).region || "");
          customInput.inputEl.focus();
        } else {
          customRow.setDesc("");
          await update("region", next);
        }
      });
    });
    dropdown("tts-format", "tts-format", [
      ["audio-24khz-96kbitrate-mono-mp3", "MP3 24 kHz"],
      ["audio-48khz-192kbitrate-mono-mp3", "MP3 48 kHz"],
    ], "model"); voice(true);
    field("tts-auto-language").setDesc(t("tts-auto-language-desc")).addToggle(toggle => toggle
      .setValue(settings.ttsAutoLanguage !== false).onChange(async next => {
        settings.ttsAutoLanguage = next;
        await save();
      }));
  } else if (service === "elevenlabs") {
    dropdown("tts-model", "tts-model", [["eleven_multilingual_v2", "Eleven Multilingual v2"], ["eleven_flash_v2_5", "Eleven Flash v2.5"], ["eleven_turbo_v2_5", "Eleven Turbo v2.5"]], "model");
    voice(true); slider("tts-stability", "stability", 0, 1, 0.05); slider("tts-similarity", "similarity", 0, 1, 0.05);
  } else if (service === "gemini") {
    dropdown("tts-model", "tts-model", [["gemini-2.5-flash-preview-tts", "Gemini 2.5 Flash TTS"], ["gemini-2.5-pro-preview-tts", "Gemini 2.5 Pro TTS"]], "model");
    voice(); instructions();
  } else if (service === "hume") {
    dropdown("tts-source", "tts-source", [["HUME_AI", "Hume AI"], ["CUSTOM_VOICE", "Custom Voice"]], "source");
    voice(true); instructions();
  } else if (service === "minimax") {
    text("tts-group-id", "groupId");
    dropdown("tts-model", "tts-model", [["speech-2.6-turbo", "Speech 2.6 Turbo"], ["speech-2.6-hd", "Speech 2.6 HD"]], "model");
    voice(); field("tts-mainland").addToggle(toggle => toggle.setValue(config.china === true)
      .onChange(async next => { await update("china", next); }));
  } else if (service === "fish") {
    dropdown("tts-model", "tts-model", [["s2-pro", "S2 Pro"], ["s1", "S1"]], "model");
    voice(true); dropdown("tts-sentence-pause", "tts-sentence-pause", [["none", t("tts-pause-none")], ["short", t("tts-pause-short")], ["long", t("tts-pause-long")]], "pause");
  } else if (service === "inworld") {
    dropdown("tts-model", "tts-model", [["inworld-tts-1", "Standard"], ["inworld-tts-1-max", "Max Quality"]], "model"); voice(true);
  } else if (service === "polly") {
    text("tts-region", "region", "us-east-1");
    dropdown("tts-engine", "tts-engine", [["neural", "Neural"], ["standard", "Standard"]], "engine"); voice(true);
  }
  field("tts-speed").addSlider(input => withSliderValue(input.setLimits(0.5, 2, 0.1)
    .setValue(Number(settings.ttsSpeed) || 1)).onChange(async next => { settings.ttsSpeed = next; await save(); }));

  const testLocale = settings.ttsTestLocale || "";
  let selectedTestLocale = testLocale;
  let phraseInput;
  if (service === "azure") {
    const languageRow = field("tts-test-language");
    languageRow.addButton(button => button
      .setButtonText(testLocale ? prepareSpeechLanguages([{ locale: testLocale }], settings.language)[0].label
        : t("tts-choose-language"))
      .onClick(async () => {
        const voices = await loadVoices(languageRow, button);
        if (!voices) return;
        const languages = prepareSpeechLanguages(voices, settings.language, selectedTestLocale);
        new SpeechLanguagePicker(plugin.app, languages, async language => {
          selectedTestLocale = language.id;
          settings.ttsTestLocale = language.id;
          await save();
          button.setButtonText(language.label);
          phraseInput.value = speechTestSample(language.id);
          plugin._speechTestPhrase = phraseInput.value;
          plugin._speechTestPhraseLocale = language.id;
          updateTestVoiceState();
        }, t).open();
      }));
  }
  const test = new Setting(host).setName(t("tts-test-voice")).setDesc(t("tts-test-desc"));
  if (service === "azure") test.addButton(button => button.setButtonText(t("tts-choose-voice"))
    .onClick(() => chooseVoice(test, button, selectedTestLocale)));
  test.addButton(button => {
    button.setButtonText(t("tts-play")).onClick(async () => {
      const phrase = phraseInput.value.trim();
      if (!phrase) { phraseInput.focus(); return; }
      button.setDisabled(true);
      test.setDesc(t("tts-test-generating"));
      let success = false;
      try {
        success = await plugin.selectionSpeech.play(phrase, host.closest(".qiaomu-reader-settings-root") || host,
          service === "azure" ? { locale: selectedTestLocale } : undefined);
      } finally {
        test.setDesc(t(success ? "tts-test-complete" : "tts-test-failed"));
        if (service === "azure") updateTestVoiceState();
        else button.setDisabled(false);
      }
    });
    if (service === "azure") updateTestVoiceState = () => {
      const voiceId = speechConfig(settings, service).voice;
      const voice = voiceCatalog?.find(item => item.id === voiceId);
      const matches = selectedTestLocale && (voice ? speechVoicesForLocale([voice], selectedTestLocale).length > 0
        : voiceId?.startsWith(`${selectedTestLocale}-`));
      button.setDisabled(!matches);
      if (!matches) test.setDesc(t(selectedTestLocale ? "tts-choose-voice" : "tts-choose-language"));
      else if ([t("tts-choose-voice"), t("tts-choose-language")].includes(test.descEl.textContent)) test.setDesc(t("tts-test-desc"));
    };
    updateTestVoiceState();
  });
  phraseInput = host.createEl("textarea", { cls: "qiaomu-reader-speech-test-input", attr: { rows: "3" } });
  phraseInput.value = service === "azure"
    ? testLocale ? plugin._speechTestPhraseLocale === testLocale ? plugin._speechTestPhrase : speechTestSample(testLocale) : ""
    : plugin._speechTestPhrase || t("tts-test-default");
  phraseInput.addEventListener("input", () => {
    plugin._speechTestPhrase = phraseInput.value;
    plugin._speechTestPhraseLocale = service === "azure" ? selectedTestLocale : "";
  });
}
