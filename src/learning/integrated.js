import LanguageLearner from "./vendor/plugin.ts";
import { SearchPanelView, SEARCH_ICON, SEARCH_PANEL_VIEW } from "./vendor/views/SearchPanelView.ts";
import { LearnPanelView, LEARN_ICON, LEARN_PANEL_VIEW } from "./vendor/views/LearnPanelView.ts";
import { t } from "./vendor/lang/helper.ts";

export class QiaomuEnglishLearning extends LanguageLearner {
  constructor(host) {
    super(host.app, { ...host.manifest, id: `${host.manifest.id}-learning`, name: "Qiaomu Reader English Learning" });
    this.host = host;
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

  registerReadingToggle() {}
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
    return this.queryWord(word, target, position, context.sentence);
  }

  hover(word, context = {}) {
    window.dispatchEvent(new CustomEvent("qiaomu-english-event-subtitle-popup", {
      detail: {
        word,
        sentenceEn: context.sentence || "",
        sentenceZh: "",
        x: context.position?.x || 0,
        y: context.position?.y || 0,
      },
    }));
  }

  closeHover() {
    window.dispatchEvent(new CustomEvent("qiaomu-english-event-subtitle-close"));
  }
}
