import { ItemView, Notice } from "obsidian";
import { t } from "./vendor/lang/helper.ts";

export const VOCABULARY_VIEW_TYPE = "qiaomu-reader-vocabulary";
const REVIEW_COMMAND = "obsidian-spaced-repetition:srs-review-flashcards-in-note";

export async function openVocabulary(learning, expression = "") {
  const workspace = learning.app.workspace;
  let leaf = workspace.getLeavesOfType(VOCABULARY_VIEW_TYPE)[0];
  if (!leaf) {
    leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VOCABULARY_VIEW_TYPE, active: true });
  }
  workspace.revealLeaf(leaf);
  leaf.view.selectExpression(expression);
  return leaf;
}

export async function startVocabularyReview(learning) {
  try { return await openVocabularyReview(learning); }
  catch { new Notice(t("Vocabulary action failed"), 8000); return false; }
}

async function openVocabularyReview(learning) {
  const { app } = learning;
  if (!app.commands?.commands?.[REVIEW_COMMAND]) {
    new Notice(t("Enable review plugin"), 8000);
    return false;
  }
  if (!await learning.refreshReviewDb()) return false;
  const path = learning.settings.review_database;
  const file = app.vault.getAbstractFileByPath(path);
  if (!file || file.extension !== "md") {
    new Notice(t("Review db path invalid"));
    return false;
  }
  let leaf = app.workspace.getLeavesOfType("markdown").find(item => item.view.file?.path === path);
  if (!leaf) leaf = app.workspace.getLeaf("tab");
  await leaf.openFile(file, { state: { mode: "preview" } });
  app.workspace.setActiveLeaf(leaf, { focus: true });
  // The note-scoped command must run only after its intended file is active.
  return app.commands.executeCommandById(REVIEW_COMMAND) !== false;
}

export class VocabularyView extends ItemView {
  constructor(leaf, learning) {
    super(leaf);
    this.learning = learning;
    this.rows = [];
    this.generation = 0;
  }

  getViewType() { return VOCABULARY_VIEW_TYPE; }
  getDisplayText() { return t("Vocabulary"); }
  getIcon() { return "notebook-pen"; }

  onOpen() {
    this.closed = false;
    this.timerWindow = this.contentEl.ownerDocument.defaultView || window;
    this.contentEl.empty();
    this.contentEl.addClass("qiaomu-reader-vocabulary");
    const header = this.contentEl.createDiv("qrv-header");
    header.createEl("h2", { text: t("Vocabulary") });
    const actions = header.createDiv("qrv-actions");
    actions.createEl("button", { text: t("Add vocabulary"), attr: { type: "button" } })
      .addEventListener("click", () => void this.learning.addVocabulary());
    const review = actions.createEl("button", { text: t("Start vocabulary review"), cls: "mod-cta", attr: { type: "button" } });
    review.addEventListener("click", async () => {
      review.disabled = true;
      try { await startVocabularyReview(this.learning); }
      catch { new Notice(t("Vocabulary action failed")); }
      finally { review.disabled = false; }
    });
    if (!this.app.commands?.commands?.[REVIEW_COMMAND]) {
      const help = this.contentEl.createDiv("qrv-review-help");
      help.createEl("p", { text: t("Enable review plugin") });
      help.createEl("button", { text: t("Open community plugins"), attr: { type: "button" } })
        .addEventListener("click", () => {
          this.app.setting.open();
          this.app.setting.openTabById("community-plugins");
        });
    }
    const label = this.contentEl.createEl("label", { cls: "qrv-search" });
    label.createSpan({ text: t("Search vocabulary") });
    this.input = label.createEl("input", { attr: { type: "search", placeholder: t("Search vocabulary") } });
    this.input.addEventListener("input", () => this.renderRows());
    this.status = this.contentEl.createDiv({ cls: "qrv-status", attr: { role: "status" } });
    this.list = this.contentEl.createDiv({ cls: "qrv-list" });
    this.registerDomEvent(window, "qiaomu-english-event-refresh-stat", () => void this.reload());
    const changed = file => {
      const folder = this.learning.settings.word_folder;
      if (file.path.startsWith(folder + "/")) {
        this.timerWindow.clearTimeout(this.refreshTimer);
        this.refreshTimer = this.timerWindow.setTimeout(() => void this.reload(), 150);
      }
    };
    for (const event of ["create", "modify", "delete", "rename"]) this.registerEvent(this.app.vault.on(event, changed));
    void this.reload();
  }

  selectExpression(expression = "") {
    if (this.input) {
      this.input.value = expression;
      this.renderRows();
    }
    void this.reload();
  }

  async reload() {
    const generation = ++this.generation;
    this.status.setText(t("Loading vocabulary"));
    try {
      const rows = await this.learning.db.getAllExpressionSimple(true);
      if (this.closed || generation !== this.generation) return;
      this.rows = rows.slice().sort((a, b) => b.date - a.date || a.expression.localeCompare(b.expression));
      this.renderRows();
    } catch {
      if (this.closed || generation !== this.generation) return;
      this.status.setText(t("Vocabulary load failed"));
      this.list.empty();
      this.list.createEl("button", { text: t("Retry vocabulary"), attr: { type: "button" } })
        .addEventListener("click", () => void this.reload());
    }
  }

  renderRows() {
    const query = this.input.value.trim().toLowerCase();
    const rows = this.rows.filter(row => !query || `${row.expression} ${row.meaning}`.toLowerCase().includes(query));
    this.list.empty();
    this.status.setText(`${t("Saved vocabulary")}: ${this.rows.length}${query ? ` · ${t("Matches")}: ${rows.length}` : ""}`);
    if (!rows.length) {
      this.list.createEl("p", { text: this.rows.length ? t("Vocabulary no matches") : t("Vocabulary empty") });
      if (query) this.list.createEl("button", { text: t("Clear vocabulary search"), attr: { type: "button" } })
        .addEventListener("click", () => { this.input.value = ""; this.renderRows(); this.input.focus(); });
      return;
    }
    for (const row of rows) {
      const button = this.list.createEl("button", { cls: "qrv-row", attr: { type: "button" } });
      button.createSpan({ cls: "qrv-expression", text: row.expression });
      button.createSpan({ cls: "qrv-meaning", text: row.meaning });
      button.createSpan({ cls: "qrv-word-status", text: [t("Ignore"), t("Learning"), t("Familiar"), t("Known"), t("Learned")][row.status] || "" });
      button.addEventListener("click", async () => {
        try {
          await this.learning.activateView("qiaomu-english-learn-panel", "right");
          await this.learning.lookup(row.expression);
        } catch { new Notice(t("Vocabulary load failed")); }
      });
    }
  }

  onClose() {
    this.closed = true;
    this.generation++;
    this.timerWindow?.clearTimeout(this.refreshTimer);
  }
}
