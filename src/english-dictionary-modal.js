import { Modal, setIcon } from "obsidian";
import { lookupEnglishWord, normalizeEnglishLookup } from "./english-lookup.js";

const LABELS = {
  zh: {
    title: "查词", search: "查询", word: "单词或短语", meaning: "释义", sentence: "原句", examples: "例句",
    loading: "正在查询…", empty: "没有找到释义", error: "查询失败，请重试", timeout: "查询超时，请重试",
    retry: "重试", speak: "发音", save: "加入复习", saving: "正在保存…", saved: "已加入复习",
    saveFailed: "保存失败，请检查复习文件后重试", openWeb: "在网页词典打开",
  },
  en: {
    title: "Dictionary", search: "Look up", word: "Word or phrase", meaning: "Definition", sentence: "Source sentence", examples: "Examples",
    loading: "Looking up…", empty: "No definition found", error: "Lookup failed. Try again.", timeout: "Lookup timed out. Try again.",
    retry: "Retry", speak: "Pronounce", save: "Add to review", saving: "Saving…", saved: "Added to review",
    saveFailed: "Could not save. Check the review file and try again.", openWeb: "Open web dictionary",
  },
};

function iconButton(doc, icon, label, handler) {
  const button = doc.createElement("button");
  button.type = "button";
  const mark = doc.createElement("span");
  setIcon(mark, icon);
  const name = doc.createElement("span");
  name.className = "qiaomu-reader-dictionary-visually-hidden";
  name.textContent = label;
  button.append(mark, name);
  button.addEventListener("click", handler);
  return button;
}

export class EnglishDictionaryModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.settings = options.settings || (() => ({}));
    this.onAddReview = options.onAddReview || (async () => false);
    this.onOpenExternal = options.onOpenExternal || (() => {});
    this.onClosed = options.onClosed || (() => {});
    this.word = normalizeEnglishLookup(options.word);
    this.sentence = String(options.sentence || "").trim().slice(0, 500);
    this.initialResult = options.initialResult || null;
    this.sequence = 0;
  }

  onOpen() {
    const doc = this.contentEl.ownerDocument;
    const labels = this.labels = String(this.settings().language || "zh").startsWith("zh") ? LABELS.zh : LABELS.en;
    this.modalEl.addClass("qiaomu-reader-dictionary-modal");
    this.contentEl.empty();
    const shell = this.contentEl.createDiv("qiaomu-reader-dictionary");
    shell.createEl("h2", { text: labels.title });
    const search = shell.createEl("form", { cls: "qiaomu-reader-dictionary-search" });
    const wordLabel = search.createEl("label", { text: labels.word });
    this.wordInput = wordLabel.createEl("input", { type: "text" });
    this.wordInput.value = this.word;
    const searchButton = iconButton(doc, "search", labels.search, () => void this.lookup());
    search.appendChild(searchButton);
    search.addEventListener("submit", (event) => { event.preventDefault(); void this.lookup(); });

    this.statusEl = shell.createDiv("qiaomu-reader-dictionary-status");
    this.resultEl = shell.createDiv("qiaomu-reader-dictionary-result");
    this.examplesEl = shell.createDiv("qiaomu-reader-dictionary-examples");
    const meaningLabel = shell.createEl("label", { cls: "qiaomu-reader-dictionary-field", text: labels.meaning });
    this.meaningInput = meaningLabel.createEl("textarea");
    this.meaningInput.rows = 3;
    this.meaningInput.addEventListener("input", () => {
      this.saveButton.disabled = !normalizeEnglishLookup(this.wordInput.value) || !this.meaningInput.value.trim();
    });
    const sentenceLabel = shell.createEl("label", { cls: "qiaomu-reader-dictionary-field", text: labels.sentence });
    this.sentenceInput = sentenceLabel.createEl("textarea");
    this.sentenceInput.rows = 2;
    this.sentenceInput.value = this.sentence;

    const actions = shell.createDiv("qiaomu-reader-dictionary-actions");
    actions.appendChild(iconButton(doc, "volume-2", labels.speak, () => this.speak()));
    actions.appendChild(iconButton(doc, "external-link", labels.openWeb, () => this.onOpenExternal(this.word)));
    this.saveButton = actions.createEl("button", { text: labels.save, cls: "mod-cta" });
    this.saveButton.type = "button";
    this.saveButton.addEventListener("click", () => void this.save());

    if (this.initialResult?.word?.toLowerCase() === this.word.toLowerCase() && this.initialResult.meanings?.length) {
      this.renderResult(this.initialResult);
    } else {
      void this.lookup();
    }
  }

  async lookup() {
    const word = normalizeEnglishLookup(this.wordInput?.value);
    if (!word) { this.setStatus(this.labels.empty); return; }
    this.word = word;
    const id = ++this.sequence;
    this._abort?.abort();
    this._abort = new AbortController();
    this.result = null;
    this.setStatus(this.labels.loading);
    this.resultEl.empty();
    this.examplesEl.empty();
    this.meaningInput.value = "";
    this.saveButton.disabled = true;
    try {
      const result = await lookupEnglishWord(word, this.settings(), { signal: this._abort.signal });
      if (id !== this.sequence || !this.contentEl.isConnected) return;
      this.renderResult(result);
    } catch (error) {
      if (error?.name === "AbortError" || id !== this.sequence) return;
      this.setStatus(this.labels.error, true);
    }
  }

  renderResult(result) {
    this.result = result;
    this.resultEl.empty();
    this.examplesEl.empty();
    if (!result.meanings?.length) {
      this.setStatus(this.labels[result.status] || this.labels.empty, result.status === "error" || result.status === "timeout");
      this.saveButton.disabled = true;
      return;
    }
    this.setStatus("");
    if (result.phonetic) this.resultEl.createDiv({ cls: "qiaomu-reader-dictionary-phonetic", text: result.phonetic });
    for (const meaning of result.meanings) this.resultEl.createDiv({ cls: "qiaomu-reader-dictionary-meaning", text: meaning });
    if (result.examples?.length) {
      this.examplesEl.createDiv({ cls: "qiaomu-reader-dictionary-examples-heading", text: this.labels.examples });
      for (const example of result.examples) {
        const row = this.examplesEl.createDiv("qiaomu-reader-dictionary-example");
        row.createDiv({ text: example.text });
        if (example.translation) row.createDiv({ cls: "qiaomu-reader-dictionary-example-translation", text: example.translation });
      }
    }
    this.meaningInput.value = result.meanings.join("\n");
    this.saveButton.disabled = false;
  }

  setStatus(message, retry = false) {
    this.statusEl.empty();
    if (message) this.statusEl.createSpan({ text: message });
    if (retry) {
      const button = this.statusEl.createEl("button", { text: this.labels.retry });
      button.type = "button";
      button.addEventListener("click", () => void this.lookup());
    }
  }

  speak() {
    const word = normalizeEnglishLookup(this.wordInput.value);
    if (!word) return;
    const audio = this.result?.audio || `https://dict.youdao.com/dictvoice?type=2&audio=${encodeURIComponent(word)}`;
    try { void new (this.contentEl.ownerDocument.defaultView.Audio)(audio).play(); }
    catch { /* Pronunciation is optional when the audio service is unavailable. */ }
  }

  async save() {
    if (this.saveButton.disabled) return;
    const word = normalizeEnglishLookup(this.wordInput.value);
    const meanings = this.meaningInput.value.split(/[\n;；]+/).map(item => item.trim()).filter(Boolean);
    if (!word || !meanings.length) { this.setStatus(this.labels.empty); return; }
    this.saveButton.disabled = true;
    this.saveButton.textContent = this.labels.saving;
    try {
      const saved = await this.onAddReview({ word, meanings, sentence: this.sentenceInput.value.trim().slice(0, 500) });
      this.setStatus(saved === false ? this.labels.saveFailed : this.labels.saved);
      if (saved === false) this.saveButton.disabled = false;
    } catch {
      this.setStatus(this.labels.saveFailed);
      this.saveButton.disabled = false;
    } finally {
      this.saveButton.textContent = this.labels.save;
    }
  }

  onClose() {
    this.sequence++;
    this._abort?.abort();
    this.contentEl.empty();
    this.onClosed();
  }
}
