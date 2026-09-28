import {
    Notice,
    Plugin,
    Menu,
    WorkspaceLeaf,
    ViewState,
    MarkdownView,
    Editor,
    TFile,
    TFolder,
    normalizePath,
    Platform,
    moment,
    MetadataCache,
} from "obsidian";
import { createApp, App as VueApp, getCurrentInstance } from "vue";

import { SearchPanelView, SEARCH_ICON, SEARCH_PANEL_VIEW } from "./views/SearchPanelView";
import { READING_VIEW_TYPE, READING_ICON, ReadingView } from "./views/ReadingView";
import { LearnPanelView, LEARN_ICON, LEARN_PANEL_VIEW } from "./views/LearnPanelView";
// StatView removed
// DataPanel removed — word files are browsable via Obsidian's file explorer

import { t } from "./lang/helper";
import DbProvider from "./db/base";
import { FileDb } from "./db/file_db";
import { TextParser, state } from "./views/parser";
import { FrontMatterManager } from "./utils/frontmatter";

import { MyPluginSettings, SettingTab, normalizeSettings } from "./settings";
import store from "./store";
import { playAudio } from "./utils/helpers";
import { registerMdictDict, unregisterMdictDict } from "./dictionary/list";
import { CryptoUtils } from "./utils/cryptoUtils";
import type { Position } from "./constant";

/** Type-safe interface for Obsidian's FileSystemAdapter internal API */
interface ObsidianFileSystemAdapter {
    basePath?: string;
}
import { InputModal } from "./modals"

import Global from "./views/Global.vue";

import {
    ArticleWords, Word, Phrase, WordsPhrase, Sentence,
    ExpressionInfo, ExpressionInfoSimple, CountInfo, WordCount, Span
} from "./db/interface";
import { ignorableWatch } from "@vueuse/core";
import { logger } from "./utils/logger";
import { buildWordFilePath } from "./utils/wordFile";
import { extractSRProgress, prepareReviewSync, deduplicateWords } from "./utils/reviewDb";
import { resolveEnglishReviewFormat } from "../../english-review.js";
import { planRefluxUpdates } from "./utils/reviewReflux";
import { shouldPersistWordFile } from "./utils/status";
import { mergeWordNote, readWordNote } from "./utils/wordNoteFormat";
import { readingThemeCss } from "./styles/readingThemes";
export const FRONT_MATTER_KEY: string = "langr";

// imgnum 将在插件加载时从 plugin data 中读取
export var imgnum: string = '';


const statusMap = [
    t("Ignore"),
    t("Learning"),
    t("Familiar"),
    t("Known"),
    t("Learned"),
];


export default class LanguageLearner extends Plugin {
    constants: { basePath: string; platform: "mobile" | "desktop"; };
    settings: MyPluginSettings;
    appEl: HTMLElement;
    vueApp: VueApp;
    db: DbProvider;
    // server field removed - self-server feature no longer available
    parser: TextParser;
    markdownButtons: Record<string, HTMLElement> = {};
    frontManager: FrontMatterManager;
    store: typeof store = store;
    private refreshTextDbTimer: number | null = null;
    private refreshTextDbRunning = false;
    private refreshTextDbQueued = false;
    private lastQueryWord = "";
    private lastQueryTime = 0;
    private hoverTimer: number | null = null;
    private reviewRefluxTimer: number | null = null;
    private refluxRunning = false;
    private refluxQueued = false;
    private reviewSyncTail: Promise<unknown> = Promise.resolve();
    private unloaded = false;
    private mdictModule: null | {
        MdictEngine: new (filePath: string, name: string) => { preload: () => void; getStatus: () => string; loadError: string | null };
        getMdictEngine: (id: string) => { getStatus: () => string; loadError: string | null } | undefined;
        registerMdictEngine: (id: string, engine: unknown) => void;
        clearMdictEngines: () => void;
        listMdictEngineIds: () => string[];
    } = null;
    private readonly mdictWindowStatuses = new Map<number, {
        updatedAt: number;
        entries: Array<{ id: string; path: string; state: string; error: string | null }>;
    }>();
    async onload() {
        // console.log("Loading Language Learner Plugin v1.0.0");

        await this.loadSettings();
        this.addSettingTab(new SettingTab(this.app, this));

        this.registerConstants();

        // 打开数据库
        this.db = await this.openDB();
        // this.settings.use_server
        //     ? new WebDb(this.settings.port)
        //     : new LocalDb(this);
        // Vault's file index is incomplete during a cold-start onload. Do not block layout readiness on migration.
        let unloaded = false;
        this.register(() => { unloaded = true; });
        this.app.workspace.onLayoutReady(() => {
            if (unloaded) return;
            void (async () => {
                await this.ensureDefaultTextDbFiles();
                if (!unloaded) await this.db.open();
            })().catch(error => {
                this.db.failInitialization(error);
                logger.error("Vocabulary initialization failed:", error);
                new Notice(`Language Learner could not open vocabulary: ${(error as Error).message}`, 10000);
            });
        });

        // 设置解析器
        this.parser = new TextParser(this);
        this.frontManager = new FrontMatterManager(this.app);

        // Self-server feature removed - no longer initializing server

        // test
        // this.addCommand({
        // 	id: "langr-test",
        // 	name: "Test for langr",
        // 	callback: () => new Notice("hello!")
        // })

        this.initStore();
        this.addCommands();
        this.registerCustomViews();
        if (this.supportsLegacyReadingView()) this.registerReadingToggle();
        this.registerContextMenu();
        this.registerLeftClick();
        this.registerMouseup();
        this.registerSubtitleHover();
        this.registerSubtitleWordHighlight();
        this.registerReviewReflux();

        // Global handler: sync words.md / review.md whenever vocabulary changes
        const globalRefreshHandler = () => {
            if (this.settings.auto_refresh_db) {
                this.scheduleRefreshTextDB(1000);
            }
        };
        window.addEventListener('qiaomu-english-event-refresh', globalRefreshHandler);
        this.register(() => window.removeEventListener('qiaomu-english-event-refresh', globalRefreshHandler));

        this.registerEvent(
            this.app.workspace.on("css-change", () => {
                store.dark = document.body.hasClass("theme-dark");
                store.themeChange = !store.themeChange;
            })
        );

        // 创建全局app用于各种浮动元素
        this.appEl = document.body.createDiv({ cls: "qiaomu-english-app" });
        this.vueApp = createApp(Global);
        this.vueApp.config.globalProperties.plugin = this;
        this.vueApp.mount(this.appEl);

        // 初始化本地 MDict 词典引擎
        await this.initMdictEngines();
        this.registerMdictStatusBridge();
    }

    invalidateParserAllFMCache() {
        if (this.db instanceof FileDb) this.db.invalidate();
    }

    // ── MDict engine management ────────────────────────────────────────────

    /**
     * Initialize (or re-initialize) all MDict engines from current settings.
     * Called on plugin load and whenever the user adds/removes/changes an .mdx file.
     */
    private async ensureMdictModule() {
        if (!Platform.isDesktopApp) return null;
        if (this.mdictModule) return this.mdictModule;
        try {
            this.mdictModule = await import("./dictionary/mdict/engine");
            return this.mdictModule;
        } catch (err) {
            logger.error("[MDict] Failed to load mdict engine module:", err);
            return null;
        }
    }

    async initMdictEngines(): Promise<void> {
        // Tear down any previously registered MDict dicts from the UI registry
        const mdictApi = await this.ensureMdictModule();
        const existingIds = mdictApi
            ? mdictApi.listMdictEngineIds()
            : Object.keys(this.settings.dictionaries).filter(key => key.startsWith("mdict_"));
        for (const id of existingIds) {
            unregisterMdictDict(id);
        }
        mdictApi?.clearMdictEngines();

        // Clean up stale mdict entries from settings.dictionaries
        const validMdictIds = new Set<string>();
        const files = this.settings.mdict_files || [];

        // Mobile (or failed dynamic import): skip mdict initialization entirely
        if (!mdictApi) {
            let dirty = false;
            for (const key of Object.keys(this.settings.dictionaries)) {
                if (key.startsWith("mdict_")) {
                    delete this.settings.dictionaries[key];
                    dirty = true;
                }
            }
            if (dirty) {
                this.saveSettings().catch(() => { });
            }
            this.store.dictsChange = !this.store.dictsChange;
            return;
        }

        files.forEach((entry, idx) => {
            if (!entry.path || !entry.enabled) return;

            const id = `mdict_${idx}`;
            validMdictIds.add(id);
            try {
                const engine = new mdictApi.MdictEngine(entry.path, entry.name || `MDict ${idx + 1}`);
                mdictApi.registerMdictEngine(id, engine);
                registerMdictDict(id, entry.name || `MDict ${idx + 1}`, id);

                // Ensure the dict is in settings.dictionaries (for enable/priority tracking)
                if (!this.settings.dictionaries[id]) {
                    this.settings.dictionaries[id] = { enable: true, priority: idx + 5 };
                }

                // console.log(`[MDict] Registered engine: id=${id}, name=${entry.name}, path=${entry.path}`);

                // Loading an MDict index can be hundreds of MB. Keep startup
                // light and let the dictionary view load it on first lookup.
            } catch (err) {
                logger.error(`[MDict] Failed to register engine for "${entry.path}":`, err);
            }
        });

        // Remove stale mdict_* entries from settings.dictionaries
        let dirty = false;
        for (const key of Object.keys(this.settings.dictionaries)) {
            if (key.startsWith('mdict_') && !validMdictIds.has(key)) {
                // console.log(`[MDict] Removing stale dict entry: ${key}`);
                delete this.settings.dictionaries[key];
                dirty = true;
            }
        }
        if (dirty) {
            this.saveSettings().catch(() => {});
        }

        // Notify Vue components that dict list changed
        this.store.dictsChange = !this.store.dictsChange;
    }

    /**
     * Public alias used by the settings UI to trigger re-initialization
     * after the user adds, removes, or toggles a MDict file.
     */
    reinitMdictEngines(): void {
        void this.initMdictEngines();
    }

    private registerMdictStatusBridge(): void {
        if (!Platform.isDesktopApp) return;
        const electron = (window as any).require?.('electron');
        const ipc = electron?.ipcRenderer;
        const remote = electron?.remote;
        if (!ipc || !remote) return;

        const onRequest = (_event: unknown, request: { vaultPath?: string; replyWindowId?: number }) => {
            if (request?.vaultPath !== this.constants.basePath || !Number.isInteger(request.replyWindowId)) return;
            const entries = this.settings.mdict_files.map((file, index) => ({
                id: `mdict_${index}`,
                path: file.path,
                ...this.getMdictLocalStatus(`mdict_${index}`),
            }));
            try {
                remote.BrowserWindow.fromId(request.replyWindowId)?.webContents.send('qiaomu-reader-english:mdict-status-response', {
                    vaultPath: request.vaultPath,
                    sourceWindowId: remote.getCurrentWindow().id,
                    entries,
                });
            } catch { /* The requesting window may have closed. */ }
        };
        const onResponse = (_event: unknown, response: {
            vaultPath?: string;
            sourceWindowId?: number;
            entries?: Array<{ id: string; path: string; state: string; error: string | null }>;
        }) => {
            if (response?.vaultPath !== this.constants.basePath
                || !Number.isInteger(response.sourceWindowId)
                || !Array.isArray(response.entries)) return;
            this.mdictWindowStatuses.set(response.sourceWindowId!, {
                updatedAt: Date.now(),
                entries: response.entries,
            });
        };
        ipc.on('qiaomu-reader-english:mdict-status-request', onRequest);
        ipc.on('qiaomu-reader-english:mdict-status-response', onResponse);
        this.register(() => {
            ipc.removeListener('qiaomu-reader-english:mdict-status-request', onRequest);
            ipc.removeListener('qiaomu-reader-english:mdict-status-response', onResponse);
            this.mdictWindowStatuses.clear();
        });
    }

    requestMdictWindowStatuses(): void {
        if (!Platform.isDesktopApp) return;
        try {
            const remote = (window as any).require?.('electron')?.remote;
            const currentId = remote?.getCurrentWindow().id;
            if (!currentId) return;
            for (const other of remote.BrowserWindow.getAllWindows()) {
                if (other.id !== currentId) {
                    other.webContents.send('qiaomu-reader-english:mdict-status-request', {
                        vaultPath: this.constants.basePath,
                        replyWindowId: currentId,
                    });
                }
            }
        } catch { /* Cross-window status is optional; local status remains available. */ }
    }

    private getMdictLocalStatus(id: string): { state: string; error: string | null } {
        const engine = this.mdictModule?.getMdictEngine(id);
        return engine ? { state: engine.getStatus(), error: engine.loadError } : { state: 'unavailable', error: null };
    }

    getMdictStatus(id: string): { state: string; error: string | null } | null {
        const index = Number(id.replace(/^mdict_/, ''));
        const file = this.settings.mdict_files[index];
        if (!file) return null;
        let status = this.getMdictLocalStatus(id);
        const rank: Record<string, number> = { unavailable: 0, idle: 1, error: 2, loading: 3, ready: 4 };
        for (const [windowId, snapshot] of this.mdictWindowStatuses) {
            if (Date.now() - snapshot.updatedAt > 3000) {
                this.mdictWindowStatuses.delete(windowId);
                continue;
            }
            const remoteStatus = snapshot.entries.find(entry => entry.id === id && entry.path === file.path);
            if (remoteStatus && (rank[remoteStatus.state] ?? 0) > (rank[status.state] ?? 0)) {
                status = { state: remoteStatus.state, error: remoteStatus.error };
            }
        }
        return status;
    }

    async openDB() {
        return new FileDb(this);
    }

    async onunload() {
        this.unloaded = true;
        this.app.workspace.detachLeavesOfType(SEARCH_PANEL_VIEW);
        this.app.workspace.detachLeavesOfType(LEARN_PANEL_VIEW);
        // DATA_PANEL_VIEW removed
        // STAT_VIEW_TYPE removed
        this.app.workspace.detachLeavesOfType(READING_VIEW_TYPE);

        // Clear pending timers
        if (this.refreshTextDbTimer !== null) {
            window.clearTimeout(this.refreshTextDbTimer);
            this.refreshTextDbTimer = null;
        }
        if (this.hoverTimer !== null) {
            window.clearTimeout(this.hoverTimer);
            this.hoverTimer = null;
        }
        if (this.reviewRefluxTimer !== null) {
            window.clearTimeout(this.reviewRefluxTimer);
            this.reviewRefluxTimer = null;
        }
        this.refreshTextDbQueued = false;
        this.refluxQueued = false;

        // Clean up mdict engines
        if (this.mdictModule) {
            for (const id of this.mdictModule.listMdictEngineIds()) {
                unregisterMdictDict(id);
            }
            this.mdictModule.clearMdictEngines();
        }

        this.db?.close?.();
        // Self-server feature removed - no server to close
        // 注意: 不在 onunload 中调用 registerExtensions，Obsidian 会自动恢复默认处理器

        this.vueApp?.unmount();
        this.appEl?.remove();
        this.appEl = null;
    }

    registerConstants() {
        const adapter = this.app.vault.adapter as unknown as ObsidianFileSystemAdapter;
        const basePath = typeof adapter?.basePath === "string" ? normalizePath(adapter.basePath) : "";
        this.constants = {
            basePath,
            platform: Platform.isMobile ? "mobile" : "desktop",
        };
    }

    private async ensureDefaultTextDbFiles() {
        const defaults: Array<{ key: "word_database" | "review_database"; path: string }> = [
            { key: "word_database", path: "Qiaomu Reader/English Learning Words.md" },
            { key: "review_database", path: "Qiaomu Reader/English Learning Review.md" },
        ];

        let updated = false;
        for (const item of defaults) {
            if (!this.settings[item.key]) {
                const existing = this.app.vault.getAbstractFileByPath(item.path);
                if (!existing) {
                    try {
                        const folder = item.path.slice(0, item.path.lastIndexOf("/"));
                        if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
                        await this.app.vault.create(item.path, "");
                    } catch (error) {
                        logger.error("Failed to create default db file:", item.path, error);
                    }
                }
                this.settings[item.key] = item.path;
                updated = true;
            }
        }

        if (updated) {
            await this.saveSettings().catch(err => logger.error('Failed to save:', err));
        }
    }

    initStore() {
        this.store.dark = document.body.hasClass("theme-dark");
        this.store.themeChange = false;
        this.store.searchPinned = false;
        this.store.dictsChange = false;
        this.syncStoreFromSettings(false);
    }

    /** Apply persisted settings to all reactive views after import or migration. */
    syncStoreFromSettings(notifyDictionaries = true) {
        this.store.fontSize = this.settings.font_size;
        this.store.fontFamily = this.settings.font_family;
        this.store.lineHeight = this.settings.line_height;
        this.store.readingWidthMode = this.settings.reading_width_mode;
        this.store.readingSideSpacing = this.settings.reading_side_spacing;
        this.store.popupSearch = this.settings.popup_search;
        this.store.dictHeight = this.settings.dict_height;
        this.store.dictFontSize = this.settings.dict_font_size || '16px';
        this.store.dictFontFamily = this.settings.dict_font_family || '';
        if (notifyDictionaries) this.store.dictsChange = !this.store.dictsChange;
    }

    protected supportsLegacyReadingView(): boolean {
        return true;
    }

    addCommands() {
        this.addCommand({
            id: "langr-backup-vocabulary",
            name: "Back up vocabulary and review progress",
            callback: async () => {
                try {
                    const path = await (this.db as FileDb).createBackup();
                    new Notice(`Vocabulary backup saved: ${path}`);
                } catch (error) { new Notice(`Backup failed: ${(error as Error).message}`); }
            },
        });
        this.addCommand({
            id: "langr-restore-vocabulary",
            name: "Merge missing vocabulary from a backup",
            callback: () => new InputModal(this.app, async path => {
                try {
                    const prefix = `${this.settings.word_folder}/LanguageLearner/backups/`;
                    if (!path.startsWith(prefix) || path.split(/[\\/]/).includes("..") || !path.endsWith(".json")) {
                        throw new Error("Choose a vocabulary backup inside the vocabulary backups folder");
                    }
                    const file = this.app.vault.getAbstractFileByPath(path);
                    if (!(file instanceof TFile)) throw new Error("Backup file not found");
                    const content = await this.app.vault.read(file);
                    await this.db.importDB(new File([content], "vocabulary.json", { type: "application/json" }));
                    new Notice("Missing vocabulary restored; existing notes and progress were kept");
                } catch (error) { new Notice(`Restore failed: ${(error as Error).message}`); }
            }).open(),
        });
        this.addCommand({
            id: "langr-refresh-word-database",
            name: t("Refresh Word Database"),
            callback: this.refreshWordDb,
        });
        this.addCommand({
            id: "langr-refresh-review-database",
            name: t("Refresh Review Database"),
            callback: this.refreshReviewDb,
        });

        // 注册查词命令
        this.addCommand({
            id: "qiaomu-english-search-word-select",
            name: t("Translate Select"),
            callback: () => {
                let selection = window.getSelection().toString().trim();
                this.queryWord(selection);
            },
        });
        this.addCommand({
            id: "qiaomu-english-search-word-input",
            name: t("Translate Input"),
            callback: () => {
                const modal = new InputModal(this.app, (text) => {
                    this.queryWord(text);
                });
                modal.open();
            },
        });

        if (this.supportsLegacyReadingView()) {
            this.addCommand({
                id: "langr-convert-to-reading",
                name: t("Convert to reading article"),
                hotkeys: [{ modifiers: ["Mod", "Shift"], key: "l" }],
                callback: () => this.convertToReadingArticle(),
            });
        }

        // 标记当前文章为已完成 (Learning Hub 集成)
        this.addCommand({
            id: "langr-mark-learning-completed",
            name: t("Mark as Learning Completed"),
            callback: async () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile) {
                    new Notice("No active file");
                    return;
                }
                await this.markLearningCompleted(activeFile);
            },
        });
    }

    // ===== Learning Hub 集成功能 =====
    async markLearningCompleted(file: TFile) {
        try {
            // 获取当前文件收集的生词数
            const wordsCount = await this.getWordsCountForFile(file.path);
            const today = new Date().toISOString().split('T')[0];
            
            // 使用 frontManager 更新 frontmatter
            await this.frontManager.setFrontMatter(file, 'status', 'completed');
            await this.frontManager.setFrontMatter(file, 'completed', today);
            await this.frontManager.setFrontMatter(file, 'words_collected', String(wordsCount));
            
            new Notice(`✅ Marked as completed! (${wordsCount} words collected)`);
        } catch (e: any) {
            logger.error('Failed to mark as completed:', e);
            new Notice(`Failed to update status: ${e.message}`);
        }
    }

    async getWordsCountForFile(filePath: string): Promise<number> {
        try {
            const abstract = this.app.vault.getAbstractFileByPath(normalizePath(filePath));
            if (!(abstract instanceof TFile)) return 0;

            const text = await this.app.vault.read(abstract);
            const articleStart = text.indexOf("^^^article");
            const wordsStart = articleStart >= 0
                ? text.indexOf("^^^words", articleStart + "^^^article".length)
                : -1;
            const article = articleStart >= 0
                ? text.slice(articleStart + "^^^article".length, wordsStart >= 0 ? wordsStart : text.length)
                : text;

            // 只统计当前文章中 status=1/2 的词，避免把整个词库的数量
            // 错误地写入当前文章的 words_collected 字段。
            const words = await this.parser.getWordsPhrases(article);
            return new Set(
                words
                    .filter((word: ExpressionInfoSimple) => word.status === 1 || word.status === 2)
                    .map(word => word.expression.toLowerCase()),
            ).size;
        } catch (e) {
            logger.warn(`[LanguageLearner] Failed to count words for ${filePath}:`, e);
            return 0;
        }
    }

    registerCustomViews() {
        // 注册查词面板视图
        this.registerView(
            SEARCH_PANEL_VIEW,
            (leaf) => new SearchPanelView(leaf, this)
        );
        this.addRibbonIcon(SEARCH_ICON, t("Open word search panel"), (evt) => {
            this.activateView(SEARCH_PANEL_VIEW, "left");
        });

        // 注册新词面板视图
        this.registerView(
            LEARN_PANEL_VIEW,
            (leaf) => new LearnPanelView(leaf, this)
        );
        this.addRibbonIcon(LEARN_ICON, t("Open new word panel"), (evt) => {
            this.activateView(LEARN_PANEL_VIEW, "right");
        });

        // 注册阅读视图
        this.registerView(
            READING_VIEW_TYPE,
            (leaf) => new ReadingView(leaf, this)
        );

        // 一键转为阅读文章
        this.addRibbonIcon("languages", t("Convert to reading article"), async () => {
            await this.convertToReadingArticle();
        });
    }




    async setMarkdownView(leaf: WorkspaceLeaf, focus: boolean = true) {
        await leaf.setViewState(
            {
                type: "markdown",
                state: leaf.view.getState(),
                //popstate: true,
            } as ViewState,
            { focus }
        );
    }

    async setReadingView(leaf: WorkspaceLeaf) {
        await leaf.setViewState({
            type: READING_VIEW_TYPE,
            state: leaf.view.getState(),
            //popstate: true,
        } as ViewState);

    }

    /** Convert the active markdown file to Language Learner reading format and open ReadingView. */
    async convertToReadingArticle() {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
            new Notice(t("No active markdown file"));
            return;
        }

        const cache = this.app.metadataCache.getFileCache(file);
        const alreadyLangr = !!(cache?.frontmatter?.[FRONT_MATTER_KEY]);

        if (!alreadyLangr) {
            // Normalize \r\n → \n so the frontmatter regex works on all platforms
            let text = (await this.app.vault.read(file)).replace(/\r\n/g, '\n');

            // Separate existing frontmatter from body (tolerant of trailing spaces on --- lines)
            const fmMatch = text.match(/^(\n*---[ \t]*\n[\s\S]+?\n---[ \t]*)([\s\S]*)$/);

            let frontmatter: string;
            let body: string;

            if (fmMatch) {
                // Has frontmatter — only inject keys that don't already exist
                const fmBlock = fmMatch[1];
                body = fmMatch[2];
                let newProps = '';
                if (!fmBlock.includes('langr:'))        newProps += '\nlangr: xxx';
                if (!fmBlock.includes('langr-audio:'))   newProps += '\nlangr-audio:';
                if (!fmBlock.includes('langr-origin:'))  newProps += '\nlangr-origin:';
                frontmatter = fmBlock.replace(
                    /\n---[ \t]*$/,
                    newProps + '\n---',
                );
            } else {
                // No frontmatter — create one
                body = text;
                frontmatter = '---\nlangr: xxx\nlangr-audio:\nlangr-origin:\n---';
            }

            // Only add section markers if not already present
            const hasArticleMarker = body.includes("^^^article");
            if (!hasArticleMarker) {
                const trimmedBody = body.trim();
                body = `\n\n^^^article\n\n${trimmedBody}\n\n^^^words\n\n^^^notes\n`;
            }

            await this.app.vault.modify(file, frontmatter + body);

            // Wait for metadataCache to pick up the new frontmatter
            await new Promise<void>((resolve) => {
                const ref = this.app.metadataCache.on("changed", (changedFile) => {
                    if (changedFile.path === file.path) {
                        this.app.metadataCache.offref(ref);
                        resolve();
                    }
                });
                // Safety timeout
                setTimeout(() => { this.app.metadataCache.offref(ref); resolve(); }, 2000);
            });
        }

        // Open ReadingView
        const leaf = this.app.workspace.getMostRecentLeaf();
        if (leaf) {
            processContent();
            await this.setReadingView(leaf);
            await fetchData();
            processContent();
        }
    }

    async refreshTextDB() {
        logger.info("[TextDB] refreshTextDB called, word_database:", this.settings.word_database, "review_database:", this.settings.review_database);
        await this.refreshWordDb();
        await this.refreshReviewDb();
        (this.app as any).commands.executeCommandById(
            "various-complements:reload-custom-dictionaries"
        );
    }

    scheduleRefreshTextDB(delay = 500) {
        if (this.refreshTextDbTimer !== null) {
            window.clearTimeout(this.refreshTextDbTimer);
        }
        this.refreshTextDbTimer = window.setTimeout(() => {
            this.refreshTextDbTimer = null;
            this.runRefreshTextDB();
        }, delay);
    }

    private async runRefreshTextDB() {
        if (this.refreshTextDbRunning) {
            this.refreshTextDbQueued = true;
            return;
        }
        this.refreshTextDbRunning = true;
        try {
            await this.refreshTextDB();
        } finally {
            this.refreshTextDbRunning = false;
            if (this.refreshTextDbQueued) {
                this.refreshTextDbQueued = false;
                this.runRefreshTextDB();
            }
        }
    }

    refreshWordDb = async () => {
        logger.info("[TextDB] refreshWordDb called, path:", this.settings.word_database);
        if (!this.settings.word_database) { logger.warn("[TextDB] word_database is empty, skipping"); return; }
        try {
            let dataBase = this.app.vault.getAbstractFileByPath(this.settings.word_database);
            if (!dataBase || dataBase instanceof TFolder) {
                logger.warn("[TextDB] Invalid word_database path:", this.settings.word_database);
                new Notice("Invalid refresh database path");
                return;
            }
            let words = await this.db.getAllExpressionSimple(false);
            logger.info("[TextDB] Got", words.length, "words from DB");
            let classified: number[][] = Array(5).fill(0).map((): number[] => []);
            words.forEach((word, i) => { classified[word.status].push(i); });
            let del = this.settings.col_delimiter;
            let classified_texts = classified.map((w, idx) => {
                return `#### ${statusMap[idx]}\n` +
                    w.map((i) => `${words[i].expression}${del}    ${words[i].meaning}`).join("\n") + "\n";
            });
            classified_texts.shift();
            let word2Meaning = classified_texts.join("\n");
            let meaning2Word = classified.flat()
                .map((i) => `${words[i].meaning}  ${del}  ${words[i].expression}`).join("\n");
            let text = word2Meaning + "\n\n" + "#### 反向查询\n" + meaning2Word;
            const hash = `${words.length}-${text.length}-${text.slice(0, 256)}-${text.slice(-256)}`;
            if (this.settings.last_word_db_hash === hash) { logger.info("[TextDB] word_db hash unchanged, skipping write"); return; }
            let db = dataBase as TFile;
            await this.app.vault.modify(db, text);
            this.settings.last_word_db_hash = hash;
            await this.saveSettings();
        } catch (error) {
            logger.error("refreshWordDb failed:", error);
        }
    };

    private isReviewTarget(file: TFile): boolean {
        return !this.unloaded && !!this.settings.review_database
            && file.path === normalizePath(this.settings.review_database)
            && this.app.vault.getAbstractFileByPath(file.path) === file;
    }

    refreshReviewDb = async (): Promise<void> => { await this.syncReviewDatabase(); };

    private activeSpacedRepetition(): unknown {
        // Obsidian has no public API for another plugin's settings. Keep this
        // optional integration at one boundary and validate its shape below.
        const plugins = (this.app as typeof this.app & {
            plugins?: { plugins?: Record<string, unknown> }
        }).plugins?.plugins;
        return plugins?.["obsidian-spaced-repetition"];
    }

    private syncReviewDatabase(): Promise<void> {
        const path = this.settings.review_database ? normalizePath(this.settings.review_database) : "";
        const sync = this.reviewSyncTail.then(() => this.writeReviewDatabase(path));
        this.reviewSyncTail = sync.catch((): void => undefined);
        return sync;
    }

    private async backupLegacyReview(content: string): Promise<string> {
        // Keep personal review backups outside the installable plugin folder.
        const folder = normalizePath(`${this.app.vault.configDir}/qiaomu-reader-english-review-backups`);
        const adapter = this.app.vault.adapter;
        if (!await adapter.exists(folder)) await this.app.vault.createFolder(folder);
        const path = normalizePath(`${folder}/legacy-review-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.md.bak`);
        if (await adapter.exists(path)) throw new Error(t("Review migration backup failed"));
        await adapter.write(path, content);
        if (await adapter.read(path) !== content) throw new Error(t("Review migration backup failed"));
        return path;
    }

    private async writeReviewDatabase(path: string): Promise<void> {
        if (this.unloaded) return;
        if (!path) {
            new Notice(t("Review db path not set"));
            return;
        }
        const dataBase = this.app.vault.getAbstractFileByPath(path);
        if (!(dataBase instanceof TFile) || dataBase.extension !== "md") {
            new Notice(t("Review db path invalid"));
            return;
        }
        const srPlugin = this.activeSpacedRepetition();
        const srFormat = resolveEnglishReviewFormat(srPlugin) as { tag: string; delimiter: string } | null;
        if (srPlugin && !srFormat) {
            new Notice(t("Review SR format unavailable"));
            return;
        }
        // Without SR, retain the user's manual export format for later use.
        // Once SR is active its configured tag and separator are authoritative.
        const format = srFormat || { tag: "#flashcards", delimiter: this.settings.review_delimiter.trim() };
        if (!format.delimiter || /[\r\n]/.test(format.delimiter)) {
            new Notice(t("Review SR format unavailable"));
            return;
        }
        const stillCurrent = () => {
            if (!this.isReviewTarget(dataBase)) return false;
            const active = this.activeSpacedRepetition();
            if (!srPlugin) return !active && this.settings.review_delimiter.trim() === format.delimiter;
            const current = resolveEnglishReviewFormat(active);
            return !!current && current.tag === format.tag && current.delimiter === format.delimiter;
        };
        try {
            if (!stillCurrent()) {
                new Notice(t("Review context changed"));
                return;
            }
            // Fetch all words regardless of last_sync.
            // Read inside the shared queue so a late older snapshot cannot win.
            const allData = await this.db.getExpressionAfter("1970-01-01T00:00:00Z");
            const data = deduplicateWords(allData).filter(w => w.status > 0);
            if (!stillCurrent()) {
                if (!this.unloaded) new Notice(t("Review context changed"));
                return;
            }
            if (data.length === 0) {
                new Notice(t("Review db no words"));
                return;
            }
            const before = await this.app.vault.read(dataBase);
            if (!stillCurrent()) throw new Error(t("Review context changed"));
            const legacyFormats = [format, { tag: "#flashcards", delimiter: this.settings.review_delimiter.trim() }];
            const plan = await prepareReviewSync(before, data, format, legacyFormats);
            if (plan.status === "conflict") {
                const message = plan.reason === "managed-edited" ? "Review managed section edited"
                    : plan.reason === "duplicate" ? "Review duplicate card conflict"
                    : plan.reason === "markers" ? "Review markers invalid"
                    : "Review unowned content";
                new Notice(t(message), 12000);
                return;
            }
            if (!stillCurrent()) throw new Error(t("Review context changed"));
            let backupPath = "";
            if (plan.status === "migrated") backupPath = await this.backupLegacyReview(before);
            if (plan.status !== "unchanged") {
                await this.app.vault.process(dataBase, current => {
                    if (!stillCurrent() || current !== before) throw new Error(t("Review context changed"));
                    return plan.text;
                });
            }
            if (!stillCurrent()) return;
            this.settings.last_sync = moment.utc().toISOString();
            await this.saveSettings();
            if (!stillCurrent()) return;
            if (backupPath) new Notice(`${t("Review legacy backup saved")}：${backupPath}`, 8000);
            const srNote = plan.preservedSR > 0 ? `，${plan.preservedSR} ${t("Review db sr preserved")}` : "";
            const offlineNote = srPlugin ? "" : `。${t("Review SR inactive export")}`;
            new Notice(`${t("Review db synced")} ${data.length} ${t("words count")}${srNote}${offlineNote}`);
        } catch (error) {
            logger.error("refreshReviewDb failed:", error);
            if (!this.unloaded) new Notice(`${t("Review db sync failed")}：${(error as Error).message || String(error)}`);
            return;
        }
    }

    // ── Review reflux: SR scheduling → word status ─────────────────────────
    //
    // After each Spaced Repetition session, the SR plugin updates the
    // <!--SR:...--> scheduling tags inside review.md. We watch that file and
    // upgrade word statuses once card intervals mature (e.g. interval ≥ 14d
    // → Known). Upgrades only — never downgrades, never touches Ignore.
    // Evidence-based idempotence makes our own rewrites a no-op. A time-based
    // suppression window would discard answers given immediately after launch.

    registerReviewReflux() {
        this.registerEvent(
            this.app.vault.on("modify", (file) => {
                if (!this.settings.review_reflux_enabled) return;
                const reviewPath = this.settings.review_database;
                if (!reviewPath || !file || file.path !== normalizePath(reviewPath)) return;
                this.scheduleReviewReflux(2000);
            })
        );

        // Catch-up pass on startup: reviews done while Obsidian was closed
        // still leave updated SR tags in review.md.
        this.app.workspace.onLayoutReady(() => {
            if (this.settings.review_reflux_enabled) {
                this.scheduleReviewReflux(5000);
            }
        });
    }

    scheduleReviewReflux(delay = 2000) {
        if (this.reviewRefluxTimer !== null) {
            window.clearTimeout(this.reviewRefluxTimer);
        }
        this.reviewRefluxTimer = window.setTimeout(() => {
            this.reviewRefluxTimer = null;
            this.runReviewReflux();
        }, delay);
    }

    async runReviewReflux(): Promise<void> {
        if (!this.settings.review_reflux_enabled || !this.settings.review_database) return;
        if (this.refluxRunning) {
            this.refluxQueued = true;
            return;
        }
        this.refluxRunning = true;
        try {
            const reviewPath = normalizePath(this.settings.review_database);
            const abstract = this.app.vault.getAbstractFileByPath(reviewPath);
            if (!abstract || abstract instanceof TFolder) return;

            const text = await this.app.vault.read(abstract as TFile);
            const srProgress = await extractSRProgress(text);
            if (Object.keys(srProgress).length === 0) return;

            const words = await this.db.getAllExpressionSimple(false);
            const changes = planRefluxUpdates(words, srProgress, {
                familiarDays: this.settings.reflux_familiar_days,
                knownDays: this.settings.reflux_known_days,
                learnedDays: this.settings.reflux_learned_days,
            }, reviewPath);
            if (changes.length === 0) return;

            let applied = 0;
            for (const change of changes) {
                try {
                    const full = await this.db.getExpression(change.expression);
                    // Skip if the word vanished or its status changed since
                    // the plan was computed (e.g. user edited it meanwhile).
                    const planned = words.find(word => word.expression === change.expression);
                    if (!full || full.status !== change.from || !planned?.revision || full.revision !== planned.revision) continue;
                    full.status = change.to;
                    const result = await this.db.postExpression(full, { source: "review", evidence: change.evidence,
                        reviewPath, intervalDays: change.intervalDays });
                    if (result === 200) applied++;
                } catch (err) {
                    logger.error(`[Reflux] Failed to update "${change.expression}":`, err);
                }
            }

            if (applied > 0) {
                // Hover cards listen for this event and must discard cached
                // status after a review updates the vocabulary in the background.
                window.dispatchEvent(new CustomEvent("qiaomu-english-event-refresh"));
                logger.info(`[Reflux] ${applied} word status(es) upgraded from SR progress`);
                new Notice(`${t("Review reflux applied")} ${applied} ${t("Review reflux words")}`);
                // Keep words.md in sync with the upgraded statuses
                if (this.settings.auto_refresh_db) {
                    this.scheduleRefreshTextDB(1000);
                }
            }
        } catch (error) {
            logger.error("[Reflux] runReviewReflux failed:", error);
        } finally {
            this.refluxRunning = false;
            if (this.refluxQueued) {
                this.refluxQueued = false;
                this.scheduleReviewReflux(1000);
            }
        }
    }

    // 注册「转为阅读模式」的菜单项和工具栏按钮
    // ST1 fix: 使用官方 Obsidian workspace 事件，替代 monkey-patch
    registerReadingToggle = () => {
        // ── 1. 三点菜单：file-menu 官方事件 ─────────────────────────────────
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file, _source, leaf) => {
                if (!file || !(file instanceof TFile)) return;
                const cache = this.app.metadataCache.getFileCache(file);
                if (!cache?.frontmatter?.[FRONT_MATTER_KEY]) return;

                const targetLeaf = leaf ?? this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
                if (!targetLeaf) return;

                menu.addItem((item) => {
                    item.setTitle(t("Open as Reading View"))
                        .setIcon(READING_ICON)
                        .onClick(async () => {
                            processContent();
                            await this.setReadingView(targetLeaf);
                            await fetchData();
                            processContent();
                        });
                });
            })
        );

        // ── 2. 工具栏按钮：active-leaf-change 官方事件 ───────────────────────
        const updateReadingButton = (leaf: WorkspaceLeaf | null) => {
            if (!leaf) return;
            const view = leaf.view;
            if (!(view instanceof MarkdownView)) return;
            const file = view.file;
            if (!file) return;

            const cache = this.app.metadataCache.getFileCache(file);
            const isLangrFile = !!(cache?.frontmatter?.[FRONT_MATTER_KEY]);

            // Check whether this view already has a reading button
            const actionsEl = (view as unknown as { actionsEl?: HTMLElement }).actionsEl;
            const existingBtn = actionsEl?.querySelector?.(".change-to-reading");

            if (isLangrFile && !existingBtn && typeof view.addAction === 'function') {
                const btn = view.addAction(
                    "view",
                    t("Open as Reading View"),
                    async () => {
                        processContent();
                        await this.setReadingView(leaf);
                        await fetchData();
                        processContent();
                    }
                );
                btn.addClass("change-to-reading");
                this.markdownButtons["reading"] = btn;
            } else if (!isLangrFile && existingBtn) {
                (existingBtn as HTMLElement).remove();
                this.markdownButtons["reading"] = null;
            }
        };

        this.registerEvent(
            this.app.workspace.on('active-leaf-change', updateReadingButton)
        );

        // Also scan when metadata cache updates (e.g. user adds langr frontmatter)
        this.registerEvent(
            this.app.metadataCache.on('changed', () => {
                updateReadingButton(this.app.workspace.getMostRecentLeaf());
            })
        );

        // Initial check after layout is ready
        this.app.workspace.onLayoutReady(() => {
            updateReadingButton(this.app.workspace.getMostRecentLeaf());
        });
    };

    /** Best-effort sentence context for a clicked/selected word: subtitle data
     *  attributes → reading-mode .stns container → enclosing paragraph. Lets the
     *  LearnPanel auto-fill the example sentence without fragile DOM walking. */
    private extractSentence(target?: HTMLElement | null): string {
        if (!target) return "";
        const sub = target.closest(".lf-clickable-text, .lp-clickable-text") as HTMLElement | null;
        if (sub) {
            const s = sub.getAttribute("data-sentence-en");
            if (s && s.trim()) return s.trim();
        }
        const stns = target.closest(".stns") as HTMLElement | null;
        if (stns) return stns.textContent?.trim() || "";
        const para = target.closest("p, div.langr-p, span.stns") as HTMLElement | null;
        return para?.textContent?.trim() || "";
    }

    async queryWord(word: string, target?: HTMLElement, evtPosition?: Position, sentenceOverride?: string, readerWord = false): Promise<void> {
        if (!word) return;
        // Deduplicate: skip if the exact same word is queried within 300ms
        const now = Date.now();
        if (word === this.lastQueryWord && now - this.lastQueryTime < 300) return;
        this.lastQueryWord = word;
        this.lastQueryTime = now;
        const sentence = sentenceOverride || this.extractSentence(target);

        if (!this.settings.popup_search) {
            await this.activateView(SEARCH_PANEL_VIEW, "left");
        }

        const isSubtitleWordTarget = !!target &&
            (target.classList?.contains("lf-word") || target.classList?.contains("lp-word") ||
                !!target.closest(".lf-clickable-text") || !!target.closest(".lp-clickable-text"));
        const isReadingWordTarget = !!target &&
            (target.classList?.contains("word") ||
                target.classList?.contains("phrase") ||
                target.classList?.contains("select") ||
                !!target.closest(".stns"));
        const shouldOpenLearnPanel = !!target &&
            !(this.settings.subtitle_click_lookup_only && (isSubtitleWordTarget || isReadingWordTarget || readerWord));

        if (shouldOpenLearnPanel) {
            await this.activateView(LEARN_PANEL_VIEW, "right");
        }

        dispatchEvent(new CustomEvent('qiaomu-english-event-search', {
            detail: { selection: word, target, evtPosition, sentence }
        }));

        if (this.settings.auto_pron) {
            // Youdao voice API uses 1=British and 2=American, while the
            // setting uses 1/0 for British/American.
            const accent = this.settings.review_prons === "1" ? 1 : 2;
            let wordUrl =
                `https://dict.youdao.com/dictvoice?type=${accent}&audio=` +
                encodeURIComponent(word);
            playAudio(wordUrl);
        }
    }

    // 管理所有的右键菜单
    registerContextMenu() {
        let addMemu = (mu: Menu, selection: string) => {
            mu.addItem((item) => {
                item.setTitle(t("Search word"))
                    .setIcon("info")
                    .onClick(async () => {
                        this.queryWord(selection);
                    });
            });
        };
        // markdown 编辑模式 右键菜单
        this.registerEvent(
            this.app.workspace.on(
                "editor-menu",
                (menu: Menu, editor: Editor, view: MarkdownView) => {
                    let selection = editor.getSelection();
                    if (selection && selection.trim()) {
                        addMemu(menu, selection);
                    }
                }
            )
        );
        // markdown 预览模式 右键菜单
        this.registerDomEvent(document.body, "contextmenu", (evt) => {
            if ((evt.target as HTMLElement).matchParent(".markdown-preview-view")) {
                const selection = window.getSelection().toString().trim();
                if (!selection) return;

                evt.preventDefault();
                let menu = new Menu();

                addMemu(menu, selection);

                menu.showAtMouseEvent(evt);
            }
        });
    }

    // 管理所有的左键抬起
    registerMouseup() {
        this.registerDomEvent(document.body, "pointerup", (evt) => {
            const target = evt.target as HTMLElement;
            if (!target.matchParent(".stns")) {
                // 处理普通模式
                const funcKey = this.settings.function_key;
                // Touch devices have no modifier keys (ctrl/alt/meta), so a plain
                // selection must be honored — otherwise select-to-lookup never
                // fires on mobile. Still respect an explicit "disable". Keeping
                // `evt[funcKey]` after the "disable" check preserves TS narrowing.
                if ((funcKey === "disable" || (!Platform.isMobile && evt[funcKey] === false))
                    && !(this.store.searchPinned && !target.matchParent("#qiaomu-english-search,#qiaomu-english-learn-panel"))
                ) return;

                let selection = window.getSelection().toString().trim();
                if (!selection) return;

                evt.stopImmediatePropagation();
                this.queryWord(selection, null, { x: evt.pageX, y: evt.pageY });
                return;
            }
        });
    }

    // 管理所有的鼠标左击
    registerLeftClick() {
        this.registerDomEvent(document.body, "click", (evt) => {
            let target = evt.target as HTMLElement;

            if (
                target.tagName === "H4" &&
                target.matchParent(".sr-modal-content")
            ) {
                let word = target.textContent;
                const accent = this.settings.review_prons === "1" ? 1 : 2;
                let wordUrl =
                    `https://dict.youdao.com/dictvoice?type=${accent}&audio=` +
                    encodeURIComponent(word);
                playAudio(wordUrl);
            }
        });
    }

    // 悬浮查词：支持 LinguaFlow 字幕 (.lf-word)、LangPlayer 字幕 (.lp-word) 和阅读模式 (.word / .phrase)
    registerSubtitleHover() {
        // Use class property this.hoverTimer so it can be cleaned up in onunload

        const isHoverTarget = (el: HTMLElement): boolean => {
            return el.hasClass("lf-word") || el.hasClass("lp-word") || el.hasClass("word") || el.hasClass("phrase");
        };

        this.registerDomEvent(document.body, "mouseover", (evt) => {
            if (!this.settings.hover_definition_enabled) return;
            const target = evt.target as HTMLElement;
            if (!isHoverTarget(target)) return;

            const word = target.textContent?.trim();
            if (!word || !/[A-Za-z]/.test(word)) return;

            // 延迟 200ms 触发，避免快速扫过时频繁弹窗
            if (this.hoverTimer) window.clearTimeout(this.hoverTimer);
            this.hoverTimer = window.setTimeout(() => {
                this.hoverTimer = null;

                // 确认鼠标还在这个单词上
                if (!target.matches(":hover")) return;

                // 获取句子上下文
                let sentenceEn = "";
                let sentenceZh = "";

                // 1. LinguaFlow / LangPlayer 字幕：从 data 属性获取
                const subtitleContainer = target.closest(".lf-clickable-text, .lp-clickable-text") as HTMLElement;
                if (subtitleContainer) {
                    sentenceEn = subtitleContainer.getAttribute("data-sentence-en") || "";
                    sentenceZh = subtitleContainer.getAttribute("data-sentence-zh") || "";
                }

                // 2. 阅读模式：从所在的 <p> 或 .stns 容器提取句子
                if (!sentenceEn) {
                    const stns = target.closest(".stns") as HTMLElement;
                    if (stns) {
                        // 阅读模式的句子容器 .stns，提取纯文本作为原句
                        sentenceEn = stns.textContent?.trim() || "";
                        // 翻译可能在相邻的翻译行中（通常没有，留空）
                    }
                }
                // 3. 回退：取父段落文本
                if (!sentenceEn) {
                    const para = target.closest("p, div.langr-p, span.stns") as HTMLElement;
                    if (para) {
                        sentenceEn = para.textContent?.trim() || "";
                    }
                }

                const rect = target.getBoundingClientRect();

                logger.info('[LanguageLearner] hover dispatching subtitle-popup for:', word);
                dispatchEvent(new CustomEvent("qiaomu-english-event-subtitle-popup", {
                    detail: {
                        word,
                        sentenceEn,
                        sentenceZh,
                        x: rect.left + rect.width / 2,
                        y: rect.top, // popup shows ABOVE the word
                    },
                }));
            }, 200);
        });

        // 鼠标离开单词时清除定时器
        this.registerDomEvent(document.body, "mouseout", (evt) => {
            const target = evt.target as HTMLElement;
            if (!isHoverTarget(target)) return;
            if (this.hoverTimer) {
                window.clearTimeout(this.hoverTimer);
                this.hoverTimer = null;
            }
        });
    }

    /**
     * Highlight .lf-word (LinguaFlow) / .lp-word (LangPlayer) elements in subtitles
     * based on vocabulary status from the database.
     * Uses MutationObserver to detect new subtitle elements.
     */
    registerSubtitleWordHighlight() {
        // Cache of word statuses: word -> status (0-4, or -1 for unknown)
        let wordCache = new Map<string, number>();
        let cacheReady = false;
        let cacheRequestId = 0;

        const loadCache = async () => {
            const requestId = ++cacheRequestId;
            try {
                // Load all known words from database
                const allWords = await this.db.getAllExpressionSimple(false);
                if (requestId !== cacheRequestId) return;
                wordCache.clear();
                if (allWords) {
                    for (const w of allWords) {
                        wordCache.set(w.expression.toLowerCase(), w.status);
                    }
                }
                cacheReady = true;
            } catch (e) {
                logger.warn('[LanguageLearner] DB not ready yet for word cache, will retry later:', e);
            }
        };

        // Color a single .lf-word / .lp-word element
        const colorWord = (el: HTMLElement) => {
            if (!cacheReady) return;
            const text = el.textContent?.trim()?.toLowerCase()?.replace(/[^a-z'-]/g, '');
            if (!text) return;
            const status = wordCache.get(text);
            // Remove old classes
            el.classList.remove('langr-w-ignore', 'langr-w-learning', 'langr-w-familiar', 'langr-w-known', 'langr-w-learned');
            if (status === 0) el.classList.add('langr-w-ignore');
            else if (status === 1) el.classList.add('langr-w-learning');
            else if (status === 2) el.classList.add('langr-w-familiar');
            else if (status === 3) el.classList.add('langr-w-known');
            else if (status === 4) el.classList.add('langr-w-learned');
        };

        // Scan all .lf-word / .lp-word elements and color them
        const scanAll = () => {
            if (!cacheReady) return;
            document.querySelectorAll('.lf-word, .lp-word').forEach(el => colorWord(el as HTMLElement));
        };

        // Initial load
        loadCache().then(scanAll);

        // Re-scan when vocabulary changes. The onload handler owns optional
        // automatic file sync and respects auto_refresh_db.
        // Use window.addEventListener directly for custom events (Obsidian types don't include custom event names)
        const refreshHandler = () => {
            loadCache().then(scanAll);
        };
        window.addEventListener('qiaomu-english-event-refresh', refreshHandler);
        this.register(() => window.removeEventListener('qiaomu-english-event-refresh', refreshHandler));

        // MutationObserver: detect new .lf-word / .lp-word elements
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (!(node instanceof HTMLElement)) continue;
                    if (node.classList?.contains('lf-word') || node.classList?.contains('lp-word')) {
                        colorWord(node);
                    } else {
                        node.querySelectorAll?.('.lf-word, .lp-word')?.forEach(el => colorWord(el as HTMLElement));
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        this.register(() => observer.disconnect());

        // Inject CSS for word status colors (subtitle overlay)
        const style = document.createElement('style');
        style.id = 'qiaomu-english-word-highlight-css';
        style.textContent = `
            .lf-word.langr-w-learning, .lp-word.langr-w-learning { color: var(--interactive-accent) !important; }
            .lf-word.langr-w-familiar, .lp-word.langr-w-familiar { color: #e8a735 !important; }
        `;
        document.head.appendChild(style);
        this.register(() => style.remove());

        // Apply word color theme for reading view
        this.applyWordColorTheme();
    }

    applyWordColorTheme() {
        const theme = this.settings.word_color_theme || 'vivid';
        logger.info('[WordColorTheme] Applying theme:', theme);

        let el = document.getElementById('qiaomu-english-word-color-theme') as HTMLStyleElement;
        if (!el) {
            el = document.createElement('style');
            el.id = 'qiaomu-english-word-color-theme';
            document.head.appendChild(el);
            this.register(() => el.remove());
        }
        el.textContent = readingThemeCss(theme);

        // Word colors normally animate for hover feedback. During a theme
        // switch that animation would leave the previous palette on screen
        // briefly, which makes the selected setting appear incorrect. Disable
        // the transition for the next paint, then restore the normal behavior.
        document.querySelectorAll<HTMLElement>('#qiaomu-english-reading').forEach((root) => {
            root.classList.add('langr-theme-switching');
            void root.offsetWidth;
            window.setTimeout(() => root.classList.remove('langr-theme-switching'), 0);
        });
    }

    async loadSettings() {
        let data = (await this.loadData()) || {};
        const settings = normalizeSettings(data);

        // 解密 API Key
        if (settings.ai?.api_key && CryptoUtils.isAvailable() && CryptoUtils.isEncrypted(settings.ai.api_key)) {
            try {
                settings.ai.api_key = await CryptoUtils.decrypt(settings.ai.api_key, 'obsidian-language-learner');
            } catch (e) {
                logger.warn('[LanguageLearner] Failed to decrypt API key, resetting:', e);
                settings.ai.api_key = '';
            }
        }
        this.settings = settings;
    }

    async saveSettings() {
        this.settings = normalizeSettings(this.settings, this.settings);
        this.syncStoreFromSettings(false);
        const dataToSave = JSON.parse(JSON.stringify(this.settings));
        // 加密 API Key
        if (dataToSave.ai?.api_key && !CryptoUtils.isEncrypted(dataToSave.ai.api_key)) {
            if (!CryptoUtils.isAvailable()) {
                dataToSave.ai.api_key = '';
                new Notice('无法安全保存 API Key，已跳过持久化。');
            } else {
                try {
                    dataToSave.ai.api_key = await CryptoUtils.encrypt(dataToSave.ai.api_key, 'obsidian-language-learner');
                } catch (e) {
                    dataToSave.ai.api_key = '';
                    logger.error('[LanguageLearner] Failed to encrypt API key; refusing plaintext persistence:', e);
                    new Notice('API Key 加密失败，未保存 API Key。');
                }
            }
        }
        await this.saveData(dataToSave);
    }

    async activateView(VIEW_TYPE: string, side: "left" | "right" | "tab") {
        if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length === 0) {
            let leaf;
            switch (side) {
                case "left":
                    leaf = this.app.workspace.getLeftLeaf(false);
                    break;
                case "right":
                    leaf = this.app.workspace.getRightLeaf(false);
                    break;
                case "tab":
                    leaf = this.app.workspace.getLeaf("tab");
                    break;
            }
            await leaf.setViewState({
                type: VIEW_TYPE,
                active: true,
            });
        }
        this.app.workspace.revealLeaf(
            this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]
        );
    }


    async checkPath() {
        if (this.settings.word_folder) {
            try {
                await this.app.vault.createFolder(this.settings.word_folder);
            } catch (err) {
                // Folder already exists — expected, ignore
            }
        }
    }

    async createWordfiles(words: string[]) {
        if (!(this.db instanceof FileDb)) return;
        for (const record of await this.db.getExprall(words)) {
            if (record.sourcePath || shouldPersistWordFile(record.status)) {
                await this.db.notes.save(record, true);
            }
        }
        this.invalidateParserAllFMCache();
    }

    async createFM(record: ExpressionInfo) {
        return mergeWordNote("", record, this.settings.foreign);
    }

    async updateWordfiles() {
        let wordsinfo = await this.db.getAllExpressionSimple(false);
        let words: string[] = wordsinfo.map(item => item.expression);
        await this.createWordfiles(words);
    }

    async updateIndexDB() {
        // Compatibility entry point: rebuilding an index must never delete durable vocabulary.
        this.invalidateParserAllFMCache();
        this.parser?.invalidateCache();
        await this.db.getAllExpressionSimple(true);
    }

    async parserFM(filePath: string): Promise<ExpressionInfo> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile) || file.extension !== "md") return null;
        return readWordNote(await this.app.vault.read(file), this.settings.foreign, file.path,
            Math.floor(file.stat.ctime / 1000));
    }

    async parserAllFM(): Promise<ExpressionInfo[]> {
        return this.db instanceof FileDb ? this.db.notes.readAll() : [];
    }

}



export function processContent() {
    const textArea = document.querySelector('.text-area');

    if (textArea) {
        // 1. 处理 Markdown 图片语法 ![alt](url) — 使用 DOM API 替代 regex+innerHTML
        const paragraphs = textArea.querySelectorAll('p');
        paragraphs.forEach(p => {
            const text = p.textContent || '';
            const pattern = /!\[(.*?)\]\((.*?)\)/;
            const match = pattern.exec(text);
            if (!match) return;

            const altText = match[1];
            const srcUrl = match[2];
            const img = document.createElement('img');
            img.alt = altText;
            img.src = /^https?:\/\//.test(srcUrl) ? srcUrl : mergeStrings(imgnum, srcUrl);

            const imgWrapper = document.createElement('div');
            imgWrapper.style.textAlign = 'center';
            imgWrapper.appendChild(img);

            const imgContainer = document.createElement('div');
            imgContainer.style.textAlign = 'center';
            imgContainer.appendChild(imgWrapper);

            p.replaceWith(imgContainer);
        });

        // 2. 处理 Markdown 标题/粗体/斜体/删除线 — 遍历 span.stns 节点
        const stnsSpans = textArea.querySelectorAll('span.stns');
        stnsSpans.forEach(span => {
            const spanText = span.textContent || '';
            const parentP = span.closest('p');
            if (!parentP) return;

            // 标题: # ~ ######
            const headingMatch = spanText.match(/^(#{1,6})\s+(.*)/);
            if (headingMatch) {
                const level = headingMatch[1].length;
                span.textContent = headingMatch[2];
                const heading = document.createElement(`h${level}`);
                heading.appendChild(span.cloneNode(true));
                parentP.replaceWith(heading);
                return;
            }
        });

        // 3. 处理内联格式 (粗体/斜体/删除线) — 在已有 span 上操作
        const allSpans = textArea.querySelectorAll('span');
        allSpans.forEach(span => {
            const text = span.textContent || '';
            let newText = text;
            let wrapper: HTMLElement | null = null;

            // 粗体: **text** 或 __text__
            if (/^\*\*(.+)\*\*$/.test(newText) || /^__(.+)__$/.test(newText)) {
                newText = newText.slice(2, -2);
                wrapper = document.createElement('b');
            }
            // 删除线: ~~text~~
            else if (/^~~(.+)~~$/.test(newText)) {
                newText = newText.slice(2, -2);
                wrapper = document.createElement('del');
            }
            // 斜体: *text* 或 _text_
            else if (/^\*(.+)\*$/.test(newText) || /^_(.+)_$/.test(newText)) {
                newText = newText.slice(1, -1);
                wrapper = document.createElement('i');
            }

            if (wrapper) {
                span.textContent = newText;
                const cloned = span.cloneNode(true);
                wrapper.appendChild(cloned);
                span.replaceWith(wrapper);
            }
        });
    } else {
        // 查找页面中的 img 元素并提取 imgnum 并存储到 localStorage 中
        const imgElements = document.getElementsByTagName('img');
        for (let i = 0; i < imgElements.length; i++) {
            if (imgElements[i].getAttribute('src')) {
                imgnum = imgElements[i].getAttribute('src');

                if (!imgnum.includes('http')) {
                    try { localStorage.setItem('imgnum', imgnum); } catch (_e) { /* private browsing / storage full */ }
                    break;
                }
            }
        }
    }
}

function mergeStrings(str1: string, str2: string) {
    // 获取 str2 的前 3 个字符
    let prefix = str2.substring(0, 3);
    // 在 str1 中查找 prefix 的位置
    let index = str1.indexOf(prefix);

    // 如果找到匹配的前缀
    if (index !== -1 && index !== 0 && str1.charAt(index - 1) === '/') {
        // 截断 str1 并与 str2 相连
        let firstPart = str1.substring(0, index);
        return firstPart + str2;
    } else {
        // 如果没有找到匹配的前缀，则返回 str1 和 str2 原样相连
        return str1 + str2;
    }
}

async function fetchData() {
    let previousContent = ''; // 上一次抓取到的内容
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 100; // 最多轮询 10 秒
        let intervalId = setInterval(() => {
            attempts++;
            let textArea = document.querySelector('.text-area');

            if (textArea) {
                let currentContent = textArea.innerHTML.trim();

                // 检查 textArea 中是否包含 class 为 'article' 的元素
                let hasArticleClass = textArea.querySelector('.article') !== null;

                if (hasArticleClass) {
                    clearInterval(intervalId);
                    resolve(currentContent);
                } else if (attempts >= maxAttempts) {
                    clearInterval(intervalId);
                    logger.debug('fetchData timeout: .article not found after 10s');
                    resolve(currentContent); // 超时后返回当前内容
                } else {
                    previousContent = currentContent;
                }
            } else {
                clearInterval(intervalId);
                logger.debug('.text-area element not found');
                resolve('');
            }
        }, 100);
    });
}
