import LanguageLearner from "./vendor/plugin.ts";
import { SearchPanelView, SEARCH_ICON, SEARCH_PANEL_VIEW } from "./vendor/views/SearchPanelView.ts";
import { LearnPanelView, LEARN_ICON, LEARN_PANEL_VIEW } from "./vendor/views/LearnPanelView.ts";
import { t } from "./vendor/lang/helper.ts";
import { createApp } from "vue";
import SubtitlePopup from "./vendor/views/SubtitlePopup.vue";

function outerDocument(target) {
  let doc = target?.ownerDocument || document;
  // EPUB text can live in an iframe while its coordinates have already been
  // converted to the containing reader window.
  try {
    while (doc.defaultView?.frameElement?.ownerDocument) {
      doc = doc.defaultView.frameElement.ownerDocument;
    }
  } catch { /* A detached or cross-origin frame cannot expose its parent. */ }
  return doc;
}

export class QiaomuEnglishLearning extends LanguageLearner {
  constructor(host) {
    super(host.app, { ...host.manifest, id: `${host.manifest.id}-learning`, name: "Qiaomu Reader English Learning" });
    this.host = host;
    this.hoverOverlays = new Map();
    this.hoverDocument = null;
    this.hoverOwner = null;
  }

  async loadData() { return this.host.learningSettings || {}; }

  async saveData(data) {
    this.host.learningSettings = data;
    if (!await this.host._saveLocalData()) throw new Error("Could not save English learning settings");
  }

  register(cleanup) { this.host.register(cleanup); }
  registerEvent(event) { this.host.registerEvent(event); }
  registerDomEvent(...args) { this.host.registerDomEvent(...args); }

  addSettingTab(tab) { this.settingTab = tab; }

  supportsLegacyReadingView() { return false; }

  registerCustomViews() {
    this.registerView(SEARCH_PANEL_VIEW, (leaf) => new SearchPanelView(leaf, this));
    this.addRibbonIcon(SEARCH_ICON, t("Open word search panel"), () => void this.activateView(SEARCH_PANEL_VIEW, "left"));
    this.registerView(LEARN_PANEL_VIEW, (leaf) => new LearnPanelView(leaf, this));
    this.addRibbonIcon(LEARN_ICON, t("Open new word panel"), () => void this.activateView(LEARN_PANEL_VIEW, "right"));
  }

  async activateView(type, side) {
    if (side === "tab") return super.activateView(type, side);
    return this.app.workspace.ensureSideLeaf(type, side, { active: false, split: false, reveal: true });
  }

  registerContextMenu() {}
  registerLeftClick() {}
  registerMouseup() {}
  registerSubtitleHover() {}
  registerSubtitleWordHighlight() {}

  searchDictionaryWithAi(word) {
    return this.host.completeEnglishLearningAi("definition", word, this.settings.ai.prompt);
  }
  translateSentenceWithAi(sentence) {
    return this.host.completeEnglishLearningAi("translation", sentence, this.settings.ai.trans_prompt);
  }

  lookup(word, context = {}) {
    const target = context.target || this.host.app.workspace.activeLeaf?.view?.containerEl || null;
    const position = context.position || undefined;
    return this.queryWord(word, target, position, context.sentence, true);
  }

  hover(word, context = {}) {
    const doc = context.hostDocument || outerDocument(context.target);
    if (this.hoverDocument && (this.hoverDocument !== doc || this.hoverOwner !== context.hoverOwner)) {
      this.closeHover(this.hoverOwner);
    }
    this.hoverDocument = doc;
    this.hoverOwner = context.hoverOwner || null;
    const detail = {
      word,
      sentenceEn: context.sentence || "",
      sentenceZh: "",
      x: context.position?.x || 0,
      y: context.position?.y || 0,
    };
    if (doc === document) {
      window.dispatchEvent(new CustomEvent("qiaomu-english-event-subtitle-popup", { detail }));
      return;
    }
    let overlay = this.hoverOverlays.get(doc);
    if (!overlay) {
      const root = doc.createElement("div");
      root.className = "qiaomu-english-app";
      doc.body.appendChild(root);
      const app = createApp(SubtitlePopup, { hostDocument: doc });
      app.config.globalProperties.plugin = this;
      const popup = app.mount(root);
      const hostWindow = doc.defaultView;
      const dispose = () => this.disposeHoverOverlay(doc);
      hostWindow?.addEventListener("beforeunload", dispose, { once: true });
      overlay = { app, root, popup, hostWindow, dispose };
      this.hoverOverlays.set(doc, overlay);
    }
    overlay.popup.show(detail);
  }

  closeHover(owner) {
    if (owner && owner !== this.hoverOwner) return;
    const doc = this.hoverDocument;
    this.hoverDocument = null;
    this.hoverOwner = null;
    if (!doc || doc === document) {
      window.dispatchEvent(new CustomEvent("qiaomu-english-event-subtitle-close"));
    } else {
      this.hoverOverlays.get(doc)?.popup.close();
    }
  }

  disposeHoverOverlay(doc) {
    const overlay = this.hoverOverlays.get(doc);
    if (!overlay) return;
    this.hoverOverlays.delete(doc);
    if (this.hoverDocument === doc) {
      this.hoverDocument = null;
      this.hoverOwner = null;
    }
    overlay.hostWindow?.removeEventListener("beforeunload", overlay.dispose);
    overlay.app.unmount();
    overlay.root.remove();
  }

  async onunload() {
    for (const doc of this.hoverOverlays.keys()) this.disposeHoverOverlay(doc);
    await super.onunload();
  }
}
