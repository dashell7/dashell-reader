import { ItemView } from "obsidian";
import { EnglishDictionaryContent, EnglishReviewContent } from "./english-dictionary-modal.js";

export const ENGLISH_DICTIONARY_VIEW_TYPE = "qiaomu-reader-english-dictionary";
export const ENGLISH_REVIEW_VIEW_TYPE = "qiaomu-reader-english-review";

export class EnglishDictionaryView extends ItemView {
  constructor(leaf, plugin, translate) {
    super(leaf);
    this.plugin = plugin;
    this.translate = translate;
  }

  getViewType() { return ENGLISH_DICTIONARY_VIEW_TYPE; }
  getDisplayText() { return this.translate("english-dictionary-panel"); }
  getIcon() { return "book-open"; }

  onOpen() {
    this.contentEl.addClass("qiaomu-reader-dictionary-sidebar");
    this.content = new EnglishDictionaryContent(this.contentEl, {
      settings: () => this.plugin.settings,
      onOpenExternal: (word) => this.plugin.openEnglishDictionaryWeb(word),
      onQuery: (word, sentence) => this.plugin.updateEnglishReviewPanel({ word, sentence }),
      onResult: (result) => this.plugin.updateEnglishReviewPanel({ result }),
    });
    this.content.mount();
    if (this.pendingQuery) {
      this.content.setQuery(this.pendingQuery.word, this.pendingQuery.context);
      this.pendingQuery = null;
    }
  }

  lookup(word, context = {}) {
    if (this.content) this.content.setQuery(word, context);
    else this.pendingQuery = { word, context };
  }

  onClose() {
    this.content?.destroy();
    this.content = null;
    this.pendingQuery = null;
  }
}

export class EnglishReviewView extends ItemView {
  constructor(leaf, plugin, translate) {
    super(leaf);
    this.plugin = plugin;
    this.translate = translate;
  }

  getViewType() { return ENGLISH_REVIEW_VIEW_TYPE; }
  getDisplayText() { return this.translate("english-review-panel"); }
  getIcon() { return "bookmark-plus"; }

  onOpen() {
    this.contentEl.addClass("qiaomu-reader-review-sidebar");
    this.content = new EnglishReviewContent(this.contentEl, {
      settings: () => this.plugin.settings,
      onAddReview: (card) => this.plugin.addEnglishReviewCard(card),
    });
    this.content.mount();
    if (this.pendingQuery) this.content.setQuery(this.pendingQuery.word, this.pendingQuery.sentence);
    if (this.pendingResult) this.content.setResult(this.pendingResult);
    this.pendingQuery = null;
    this.pendingResult = null;
  }

  update({ word, sentence, result }) {
    if (word !== undefined) {
      if (this.content) this.content.setQuery(word, sentence);
      else this.pendingQuery = { word, sentence };
    }
    if (result) {
      if (this.content) this.content.setResult(result);
      else this.pendingResult = result;
    }
  }

  onClose() {
    this.content?.destroy();
    this.content = null;
    this.pendingQuery = null;
    this.pendingResult = null;
  }
}
