// Adapted from Aloud's chunked playback design.
// Original source: https://github.com/adrianlyjak/obsidian-aloud-tts (MIT).
import { listSpeechVoices, speechAudio, speechConfig, speechHttpRequest, speechRequest, speechService } from "./selection-tts-providers.js";
import { detectSpeechLanguage, selectAzureSpeechVoice, splitSpeechLanguageRuns } from "./selection-tts-language.js";
export { SPEECH_MODELS, SPEECH_VOICES, speechEndpoint } from "./selection-tts-providers.js";

export function splitSpeechText(text, limit = 3500) {
  const source = String(text || "").trim();
  const sentences = typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(source)]
      .map(part => part.segment.trim()).filter(Boolean)
    : (source.match(/[^.!?。！？\n]*[.!?。！？]+|[^.!?。！？\n]+/gu) || [])
      .map(part => part.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  const flush = () => { if (current) chunks.push(current); current = ""; };
  for (const sentence of sentences) {
    const words = sentence.match(/\S+\s*/gu) || [];
    for (const word of words) {
      if (current.length + word.length > limit) flush();
      if (word.length <= limit) { current += word; continue; }
      for (let i = 0; i < word.length; i += limit) {
        if (current) flush();
        chunks.push(word.slice(i, i + limit));
      }
    }
    current = current.trimEnd() + " ";
    flush();
  }
  flush();
  return chunks.map(chunk => chunk.trim()).filter(Boolean);
}

export class SelectionSpeechPlayer {
  constructor(plugin, { translate, icon, onError, request, hostRequest } = {}) {
    this.plugin = plugin;
    this.translate = translate;
    this.icon = icon;
    this.onError = onError;
    this.request = request;
    this.hostRequest = hostRequest;
    this.session = null;
    this.azureVoices = null;
  }

  stop() {
    const session = this.session;
    if (!session) return;
    this.session = null;
    session.prefetch?.controller.abort();
    session.controller.abort();
    session.audio?.pause();
    session.finishAudio?.();
    if (session.url) URL.revokeObjectURL(session.url);
    session.cleanup?.();
    session.host?.classList.remove("qiaomu-reader-speech-active", "qiaomu-reader-speech-bottom", "qiaomu-reader-speech-floating");
    session.bar?.remove();
  }

  async play(text, host, { locale, context, range } = {}) {
    this.stop();
    const window = host.ownerDocument.defaultView;
    const settings = this.plugin.settings;
    const service = speechService(settings);
    const request = this.request || ((url, options) => speechHttpRequest(service, url, options,
      (...args) => window.fetch(...args), this.hostRequest));
    const autoLanguage = service === "azure" && !locale && settings.ttsAutoLanguage !== false;
    const chunks = splitSpeechText(text).flatMap(chunk => autoLanguage
      ? splitSpeechLanguageRuns(chunk) : [{ text: chunk, script: "", language: null }]);
    if (!chunks.length) return false;
    const config = { ...speechConfig(settings, service), ...(service === "azure" && locale ? { locale } : {}) };
    const key = this.plugin.app.secretStorage?.getSecret(config.secretId || "");
    if (!key && service !== "compatible") { this.onError?.("tts-key-required"); return false; }
    const visibilityValues = ["always", "always-mobile", "playing", "never"];
    const visibility = visibilityValues.includes(settings.ttsBarVisibility) ? settings.ttsBarVisibility : "playing";
    const session = { controller: new AbortController(), bar: null, audio: null, url: null, finishAudio: null,
      host, text, options: { locale, context, range }, index: 0, jumpTo: null, prefetch: null,
      position: settings.ttsBarPosition === "bottom" ? "bottom" : "top", visibility };
    session.display = settings.ttsBarDisplay === "auto-hide" ? "auto-hide" : "fixed";
    this.session = session;
    this._bar(session, host, chunks.length);
    try {
      const chunkConfigs = chunks.map(() => config);
      if (autoLanguage) {
        const latinText = chunks.filter(chunk => chunk.script === "latin").map(chunk => chunk.text).join(" ");
        // Short Latin text can belong to many languages; keep the chosen voice when detection is uncertain.
        const latinLanguage = detectSpeechLanguage(latinText, context);
        const languages = chunks.map(chunk => chunk.language || detectSpeechLanguage(chunk.text, context)
          || (chunk.script === "latin" ? latinLanguage : null));
        const unmatched = [...new Set(languages.filter(language => language && !config.voice?.startsWith(`${language}-`)))];
        if (unmatched.length) {
          this._status(session, "tts-matching-voice", 1, chunks.length);
          const identity = JSON.stringify([config.region, config.secretId]);
          let voices = this.azureVoices?.identity === identity ? this.azureVoices.voices : null;
          if (!voices) {
            const timeout = window.setTimeout(() => session.controller.abort(), 15000);
            try { voices = await listSpeechVoices("azure", config, key, request, session.controller.signal); }
            catch (error) { throw new Error("tts-auto-voice-failed", { cause: error }); }
            finally { window.clearTimeout(timeout); }
            if (this.session !== session) return false;
            this.azureVoices = { identity, voices };
          }
          const selected = new Map();
          for (const language of unmatched) {
            const chosen = selectAzureSpeechVoice(language, voices, config.voice);
            if (!chosen) throw new Error("tts-auto-voice-failed");
            selected.set(language, { ...config, voice: chosen.voice, locale: chosen.locale });
          }
          languages.forEach((language, index) => {
            if (selected.has(language)) chunkConfigs[index] = selected.get(language);
          });
        }
      }
      if (service === "azure" && !config.voice?.trim()) throw new Error("tts-choose-voice");
      const synthesize = index => {
        const controller = new AbortController();
        const abortFromSession = () => controller.abort();
        if (session.controller.signal.aborted) controller.abort();
        else session.controller.signal.addEventListener("abort", abortFromSession, { once: true });
        const timeout = window.setTimeout(() => controller.abort(), 45000);
        const promise = (async () => {
          const { url, options } = await speechRequest(service, chunkConfigs[index], key, chunks[index].text, controller.signal);
          const response = await request(url, options);
          const audioData = await speechAudio(service, chunkConfigs[index], response);
          if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
          if (!audioData.data.byteLength) throw new Error("empty audio");
          return audioData;
        })().then(data => ({ data }), error => ({ error })).finally(() => {
          window.clearTimeout(timeout);
          session.controller.signal.removeEventListener("abort", abortFromSession);
        });
        return { index, controller, promise };
      };
      for (let index = 0; index < chunks.length && this.session === session;) {
        session.index = index;
        this._status(session, "tts-loading", index + 1, chunks.length);
        let task = session.prefetch;
        session.prefetch = null;
        if (task?.index !== index) {
          task?.controller.abort();
          task = synthesize(index);
        }
        const result = await task.promise;
        if (result.error) throw result.error;
        const audioData = result.data;
        if (this.session !== session) return false;
        session.url = URL.createObjectURL(new Blob([audioData.data], { type: audioData.format === "wav" ? "audio/wav" : "audio/mpeg" }));
        const audio = session.audio = host.ownerDocument.createElement("audio");
        audio.src = session.url;
        audio.playbackRate = Number(settings.ttsSpeed) || 1;
        this._status(session, "tts-playing", index + 1, chunks.length);
        if (index + 1 < chunks.length) session.prefetch = synthesize(index + 1);
        await new Promise((resolve, reject) => {
          session.finishAudio = resolve;
          audio.onended = resolve;
          audio.onerror = () => reject(new Error("audio playback failed"));
          audio.play().catch(reject);
        });
        session.finishAudio = null;
        audio.pause();
        URL.revokeObjectURL(session.url);
        session.url = null;
        session.audio = null;
        const nextIndex = session.jumpTo === null ? index + 1 : session.jumpTo;
        if (nextIndex !== index + 1 && session.prefetch) {
          session.prefetch.controller.abort();
          session.prefetch = null;
        }
        index = nextIndex;
        session.jumpTo = null;
      }
      if (this.session === session) { this.stop(); return true; }
      return false;
    } catch (error) {
      if (this.session !== session) return false;
      this.stop();
      this.onError?.(["tts-invalid-endpoint", "tts-auto-voice-failed", "tts-choose-voice"].includes(error.message)
        ? error.message : "tts-failed", error);
      return false;
    }
  }

  _bar(session, host, total) {
    if (host.querySelector(".qiaomu-reader-top")) {
      this._readerBar(session, host, total);
      return;
    }
    const bar = session.bar = host.createDiv(`qiaomu-reader-speech-bar qiaomu-reader-speech-position-${session.position}`);
    bar.setAttribute("role", "status");
    const label = session.label = bar.createSpan("qiaomu-reader-speech-status");
    label.textContent = this.translate("tts-loading");
    const pause = session.pauseButton = bar.createEl("button", { attr: { type: "button" } });
    pause.hidden = true;
    const pauseIcon = pause.createSpan();
    this.icon(pauseIcon, "pause");
    const pauseName = pause.createSpan("qiaomu-reader-sr-only");
    pauseName.textContent = this.translate("tts-pause");
    pause.addEventListener("click", () => {
      const audio = session.audio;
      if (!audio) return;
      if (audio.paused) { audio.play().catch(() => this.onError?.("tts-failed")); this.icon(pauseIcon, "pause"); pauseName.textContent = this.translate("tts-pause"); }
      else { audio.pause(); this.icon(pauseIcon, "play"); pauseName.textContent = this.translate("tts-resume"); }
    });
    const stop = bar.createEl("button", { attr: { type: "button" } });
    this.icon(stop.createSpan(), "square");
    stop.createSpan("qiaomu-reader-sr-only").textContent = this.translate("tts-stop");
    stop.addEventListener("click", () => this.stop());
  }

  _readerBar(session, host, total) {
    host.classList.toggle("qiaomu-reader-speech-bottom", session.position === "bottom");
    const win = host.ownerDocument.defaultView;
    const touch = this._isTouchDevice(win);
    const visibilityAllowed = session.visibility !== "never"
      && (session.visibility !== "always-mobile" || touch);
    const alwaysVisible = session.visibility === "always"
      || (session.visibility === "always-mobile" && touch);
    const autoHide = session.display === "auto-hide" && !touch && !alwaysVisible && session.visibility === "playing";
    const modeClass = autoHide
      ? " qiaomu-reader-speech-floating qiaomu-reader-speech-auto-hide qiaomu-reader-speech-visible" : "";
    const hiddenClass = visibilityAllowed ? "" : " qiaomu-reader-speech-hidden";
    const bar = session.bar = host.createDiv(`qiaomu-reader-speech-bar qiaomu-reader-speech-docked qiaomu-reader-speech-position-${session.position}${modeClass}${hiddenClass}`);
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-hidden", String(!visibilityAllowed));
    bar.hidden = !visibilityAllowed;
    session.toolbarVisible = visibilityAllowed;
    session.autoHide = autoHide;
    host.classList.toggle("qiaomu-reader-speech-active", visibilityAllowed);
    host.classList.toggle("qiaomu-reader-speech-floating", autoHide);
    const group = bar.createDiv("qiaomu-reader-speech-controls");
    const button = (parent, control, icon, label, action) => {
      const item = parent.createEl("button", { attr: { type: "button", "data-control": control } });
      this.icon(item.createSpan(), icon);
      item.createSpan("qiaomu-reader-sr-only").textContent = label;
      item.addEventListener("click", action);
      return item;
    };
    const restartButton = button(group, "restart", "play", this.translate("tts-play"), () => {
      void this.play(session.text, host, session.options);
    });
    restartButton.classList.add("qiaomu-reader-speech-play");
    const transport = group.createDiv("qiaomu-reader-speech-transport");
    const jump = offset => {
      if (this.session !== session || !session.audio) return;
      const target = session.index + offset;
      if (target < 0 || target >= total) return;
      session.jumpTo = target;
      session.finishAudio?.();
    };
    session.previousButton = button(transport, "previous", "skip-back", this.translate("tts-previous"), () => jump(-1));
    session.pauseButton = button(transport, "pause", "pause", this.translate("tts-pause"), () => {
      const audio = session.audio;
      if (!audio) return;
      if (session.paused) audio.play().catch(() => this.onError?.("tts-failed"));
      else audio.pause();
      session.paused = !session.paused;
      this._syncPause(session);
    });
    session.nextButton = button(transport, "next", "skip-forward", this.translate("tts-next"), () => jump(1));
    session.eyeButton = button(transport, "highlight", "eye", this.translate("tts-show-selection"), () => {
      session.highlightVisible = !session.highlightVisible;
      session.eyeButton.classList.toggle("is-active", session.highlightVisible);
      session.eyeButton.setAttribute("aria-pressed", String(session.highlightVisible));
      this._paintSelection(session);
    });
    session.highlightVisible = true;
    session.eyeButton.classList.add("is-active");
    session.eyeButton.setAttribute("aria-pressed", "true");
    session.followText = true;
    session.followButton = button(transport, "follow", "locate-fixed", this.translate("tts-follow-text-on"), () => {
      session.followText = !session.followText;
      session.followButton.classList.toggle("is-active", session.followText);
      session.followButton.setAttribute("aria-pressed", String(session.followText));
      const name = session.followButton.lastChild;
      if (name) name.textContent = this.translate(session.followText ? "tts-follow-text-on" : "tts-follow-text-off");
      if (session.followText) this._scrollSelection(session);
    });
    session.followButton.classList.add("is-active");
    session.followButton.setAttribute("aria-pressed", "true");
    this._paintSelection(session);
    const speedWrap = group.createDiv("qiaomu-reader-speech-speed-wrap");
    session.speedButton = speedWrap.createEl("button", { attr: { type: "button", "data-control": "speed" } });
    session.speedButton.textContent = `${Number(this.plugin.settings.ttsSpeed) || 1}x`;
    session.speedButton.createSpan("qiaomu-reader-sr-only").textContent = this.translate("tts-speed");
    const speedPanel = speedWrap.createDiv("qiaomu-reader-speech-popover");
    speedPanel.hidden = true;
    const speed = speedPanel.createEl("input", { attr: { type: "range", min: "0.5", max: "2", step: "0.1" } });
    speed.value = String(Number(this.plugin.settings.ttsSpeed) || 1);
    speed.addEventListener("input", () => {
      const value = Number(speed.value);
      session.speedButton.firstChild.textContent = `${value.toFixed(1).replace(/\.0$/u, "")}x`;
      this.plugin.settings.ttsSpeed = value;
      if (session.audio) session.audio.playbackRate = value;
    });
    speed.addEventListener("change", () => {
      void Promise.resolve(this.plugin.saveAll?.()).catch(() => this.onError?.("tts-failed"));
    });
    session.speedButton.addEventListener("click", () => { speedPanel.hidden = !speedPanel.hidden; });
    const moreWrap = group.createDiv("qiaomu-reader-speech-more-wrap");
    button(moreWrap, "more", "more-vertical", this.translate("more"), () => {
      morePanel.hidden = !morePanel.hidden;
    });
    const morePanel = moreWrap.createDiv("qiaomu-reader-speech-popover qiaomu-reader-speech-menu");
    morePanel.hidden = true;
    const settings = morePanel.createEl("button", { text: this.translate("tts-settings"), attr: { type: "button" } });
    settings.addEventListener("click", () => {
      morePanel.hidden = true;
      this.plugin.settingsTab?.openSpeechSettings();
    });
    const statusArea = session.statusArea = bar.createDiv("qiaomu-reader-speech-status-area");
    statusArea.setAttribute("role", "status");
    const visualizer = session.visualizer = statusArea.createDiv("qiaomu-reader-speech-visualizer");
    visualizer.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 6; index++) visualizer.createSpan("qiaomu-reader-speech-visualizer-bar");
    const label = session.label = statusArea.createSpan("qiaomu-reader-speech-status");
    label.textContent = this.translate("tts-loading");
    button(bar, "stop", "x", this.translate("tts-stop"), () => this.stop());
    const doc = host.ownerDocument;
    let hideTimer = null;
    const clearHideTimer = () => {
      if (hideTimer !== null) win.clearTimeout(hideTimer);
      hideTimer = null;
    };
    const hideWhenIdle = () => {
      clearHideTimer();
      if (!session.autoHide || !session.speechActive) return;
      hideTimer = win.setTimeout(() => {
        if (session.pointerInBar || bar.contains(doc.activeElement)) return;
        bar.classList.remove("qiaomu-reader-speech-visible");
      }, 3000);
    };
    const reveal = () => {
      if (!session.autoHide) return;
      bar.classList.add("qiaomu-reader-speech-visible");
      hideWhenIdle();
    };
    const pointerMove = event => { if (event.pointerType !== "touch") reveal(); };
    const focusIn = () => reveal();
    const focusOut = () => { if (!bar.contains(doc.activeElement)) hideWhenIdle(); };
    const pointerEnter = () => { session.pointerInBar = true; reveal(); };
    const pointerLeave = () => { session.pointerInBar = false; hideWhenIdle(); };
    if (session.autoHide) {
      host.addEventListener("pointermove", pointerMove);
      host.addEventListener("pointerdown", reveal);
      host.addEventListener("focusin", focusIn);
      bar.addEventListener("pointerenter", pointerEnter);
      bar.addEventListener("pointerleave", pointerLeave);
      bar.addEventListener("focusout", focusOut);
      session.setSpeechVisibility = (visible) => {
        session.speechActive = visible;
        if (visible) reveal();
        else {
          clearHideTimer();
          bar.classList.add("qiaomu-reader-speech-visible");
        }
      };
    }
    const dismiss = event => {
      if (!speedWrap.contains(event.target)) speedPanel.hidden = true;
      if (!moreWrap.contains(event.target)) morePanel.hidden = true;
    };
    const escape = event => {
      if (event.key === "Escape") { speedPanel.hidden = true; morePanel.hidden = true; }
    };
    doc.addEventListener("pointerdown", dismiss);
    doc.addEventListener("keydown", escape);
    session.cleanup = () => {
      clearHideTimer();
      host.removeEventListener("pointermove", pointerMove);
      host.removeEventListener("pointerdown", reveal);
      host.removeEventListener("focusin", focusIn);
      bar.removeEventListener("pointerenter", pointerEnter);
      bar.removeEventListener("pointerleave", pointerLeave);
      bar.removeEventListener("focusout", focusOut);
      doc.removeEventListener("pointerdown", dismiss);
      doc.removeEventListener("keydown", escape);
      this._clearSelectionPaint(session);
    };
    this._status(session, "tts-loading", 1, total);
  }

  _paintSelection(session) {
    const range = session.options.range;
    const doc = range?.startContainer?.ownerDocument;
    const win = doc?.defaultView;
    if (!win?.CSS?.highlights || !win.Highlight) {
      if (session.eyeButton) session.eyeButton.disabled = true;
      return;
    }
    try {
      this._clearSelectionPaint(session);
      session.eyeButton?.classList.toggle("is-active", session.highlightVisible);
      session.eyeButton?.setAttribute("aria-pressed", String(session.highlightVisible));
      if (!session.highlightVisible) return;
      const highlight = new win.Highlight(range.cloneRange());
      win.CSS.highlights.set("qiaomu-reader-speech", highlight);
      session.highlight = { win, highlight };
      if (doc !== session.host.ownerDocument) {
        const style = doc.createElement("style");
        style.textContent = "::highlight(qiaomu-reader-speech){background-color:rgba(139,92,246,.34)}";
        doc.head?.append(style);
        session.highlightStyle = style;
      }
      this._scrollSelection(session);
    } catch {
      this._clearSelectionPaint(session);
      if (session.eyeButton) session.eyeButton.disabled = true;
    }
  }

  _scrollSelection(session) {
    if (session.followText === false) return;
    const range = session.options.range;
    range?.startContainer?.parentElement?.scrollIntoView?.({ block: "nearest" });
  }

  _isTouchDevice(win) {
    if (!win) return false;
    return win.innerWidth <= 600 || !!win.matchMedia?.("(hover: none), (pointer: coarse)").matches;
  }

  _clearSelectionPaint(session) {
    const entry = session.highlight;
    try {
      if (entry && entry.win.CSS.highlights.get("qiaomu-reader-speech") === entry.highlight)
        entry.win.CSS.highlights.delete("qiaomu-reader-speech");
    } catch { /* The source document may have been closed while audio was playing. */ }
    session.highlightStyle?.remove();
    session.highlightStyle = null;
    session.highlight = null;
  }

  _syncPause(session) {
    const paused = session.paused;
    const icon = session.pauseButton?.firstChild;
    if (icon) { icon.replaceChildren(); this.icon(icon, paused ? "step-forward" : "pause"); }
    const name = session.pauseButton?.lastChild;
    if (name) name.textContent = this.translate(paused ? "tts-resume" : "tts-pause");
  }

  _status(session, key, index, total) {
    if (session.bar.classList.contains("qiaomu-reader-speech-docked")) {
      const playing = key === "tts-playing";
      session.setSpeechVisibility?.(playing);
      session.visualizer?.classList.toggle("is-active", playing);
      session.statusArea?.setAttribute("data-state", key);
      session.label.textContent = playing ? "" : `${this.translate(key)} ${index}/${total}`;
      session.previousButton.disabled = !playing || session.index === 0;
      session.nextButton.disabled = !playing || session.index === total - 1;
      session.pauseButton.disabled = !playing;
      if (playing) { session.paused = false; this._syncPause(session); }
      return;
    }
    session.label.textContent = `${this.translate(key)} ${index}/${total}`;
    session.pauseButton.hidden = key !== "tts-playing";
  }
}
