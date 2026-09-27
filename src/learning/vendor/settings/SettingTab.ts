// ── settings/SettingTab.ts ───────────────────────────────────────────────
// Settings UI — renders the tabbed plugin settings panel.

import { App, Notice, PluginSettingTab, Setting, Modal, FuzzySuggestModal, DropdownComponent, setIcon, moment, debounce, requestUrl, TFolder, Platform } from 'obsidian';
import LanguageLearner from '../plugin';
import { t } from '../lang/helper';
import { dicts } from '@dict/list';
import store from '../store';
import type { MyPluginSettings, HoverTranslationProvider, ReadingWidthMode } from './types';
import { AI_PROVIDERS } from './types';
import {
    normalizeDictionaryFontSize,
    normalizeDictionaryHeight,
    normalizeLineHeight,
    normalizeReadingFontSize,
    normalizeReadingSideSpacing,
} from './validation';
import { normalizeRefluxDays } from '../utils/reviewReflux';
import { withTimeout } from '../dictionary/helpers';
import '../styles/settings.css';

const SYSTEM_READING_FONT = '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif';

const READING_FONT_CANDIDATES = [
    { name: 'Segoe UI', label: 'Segoe UI' },
    { name: 'Microsoft YaHei', label: '微软雅黑 / Microsoft YaHei' },
    { name: 'Microsoft JhengHei', label: '微软正黑 / Microsoft JhengHei' },
    { name: 'Noto Sans SC', label: 'Noto Sans SC' },
    { name: 'Noto Serif SC', label: 'Noto Serif SC' },
    { name: 'Source Han Sans SC', label: '思源黑体 / Source Han Sans SC' },
    { name: 'Source Han Serif SC', label: '思源宋体 / Source Han Serif SC' },
    { name: 'PingFang SC', label: '苹方 / PingFang SC' },
    { name: 'Roboto', label: 'Roboto' },
    { name: 'Inter', label: 'Inter' },
    { name: 'Arial', label: 'Arial' },
    { name: 'Verdana', label: 'Verdana' },
    { name: 'Georgia', label: 'Georgia' },
    { name: 'Times New Roman', label: 'Times New Roman' },
];

const FONT_NAME_SUFFIX = /\s+\((?:Regular|Bold|Italic|Light|Medium|Semibold|SemiBold|Black|Book|広東|简体中文|繁體中文)\)$/i;

function fontCssValue(name: string): string {
    return `"${name.replace(/"/g, '\\"')}"`;
}

function cleanFontName(raw: string): string {
    return raw
        .replace(FONT_NAME_SUFFIX, '')
        .split(/\s*&\s*/)[0]
        .trim();
}

function canUseFont(name: string): boolean {
    try {
        const fontSet = (document as any).fonts;
        return typeof fontSet?.check === 'function'
            ? fontSet.check(`16px ${fontCssValue(name)}`, 'Aa汉字')
            : true;
    } catch {
        return true;
    }
}

function getInitialFontOptions(current: string, systemValue: string, systemLabel = '系统默认 / System') {
    const options = [{ value: systemValue, label: systemLabel }];
    const detected = READING_FONT_CANDIDATES.filter((font) => canUseFont(font.name));
    const visible = detected.length > 0 ? detected : READING_FONT_CANDIDATES;

    for (const font of visible) {
        options.push({ value: fontCssValue(font.name), label: font.label });
    }
    if (current && !options.some((option) => option.value === current)) {
        options.push({ value: current, label: '当前字体 / Current' });
    }
    return options;
}

function getInitialReadingFontOptions(current: string) {
    return getInitialFontOptions(current, SYSTEM_READING_FONT);
}

let desktopFontNamesPromise: Promise<string[]> | null = null;

function discoverDesktopFontNames(): Promise<string[]> {
    if (desktopFontNamesPromise) return desktopFontNamesPromise;
    if (!Platform.isDesktopApp) return Promise.resolve([]);

    desktopFontNamesPromise = new Promise((resolve) => {
        try {
        const nodeRequire = (window as any).require;
        const childProcess = nodeRequire?.('child_process');
        const os = nodeRequire?.('os');
        const platform = os?.platform?.() || '';
            if (!childProcess?.execFile) {
                resolve([]);
                return;
            }

        if (platform === 'win32') {
            const script = [
                "$roots=@('HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts','HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts')",
                'foreach($root in $roots){if(Test-Path $root){$p=Get-ItemProperty $root;$p.PSObject.Properties|Where-Object{$_.Name -notmatch \"^PS\"}|ForEach-Object{$_.Name}}}',
            ].join(';');
            childProcess.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
                    windowsHide: true,
                    maxBuffer: 1024 * 1024,
                }, (_error: unknown, stdout: string) => {
                    resolve(String(stdout || '').split(/\r?\n/).map(cleanFontName).filter(Boolean));
                });
                return;
        }

        if (platform === 'linux') {
            childProcess.execFile('fc-list', [':', 'family'], {
                    maxBuffer: 1024 * 1024,
                }, (_error: unknown, stdout: string) => {
                    resolve(String(stdout || '').split(/\r?\n/).flatMap((line) => line.split(',')).map(cleanFontName).filter(Boolean));
                });
                return;
        }
            resolve([]);
        } catch {
            // Mobile and locked-down desktop builds simply use the safe candidate list.
            resolve([]);
        }
    });
    return desktopFontNamesPromise;
}

class VaultPathSuggestModal extends FuzzySuggestModal<string> {
    constructor(
        app: App,
        private readonly items: string[],
        title: string,
        emptyText: string,
        private readonly onChoose: (path: string) => void,
    ) {
        super(app);
        this.titleEl.setText(title);
        this.setPlaceholder(title);
        this.emptyStateText = emptyText;
    }

    getItems(): string[] {
        return this.items;
    }

    getItemText(item: string): string {
        return item;
    }

    onChooseItem(item: string): void {
        this.onChoose(item);
    }
}

function addPresetOptions(dropdown: DropdownComponent, values: string[], current: string): void {
    values.forEach((value) => dropdown.addOption(value, value));
    if (!values.includes(current)) {
        dropdown.addOption(current, `${t("Current")}: ${current}`);
    }
    dropdown.setValue(current);
}

export class SettingTab extends PluginSettingTab {
    plugin: LanguageLearner;
    private activeTab: string;
    private mdictStatusTimer: number | null = null;

    constructor(app: App, plugin: LanguageLearner) {
        super(app, plugin);
        this.plugin = plugin;
        let storedTab = "";
        try {
            storedTab = window.localStorage.getItem("qiaomu-english-settings-tab") || "";
        } catch {
            // Private/locked-down webviews can deny localStorage; use General.
        }
        const tabs = this.isQiaomuIntegration()
            ? ["general", "dictionaries", "database"]
            : ["general", "dictionaries", "reading", "database", "ai"];
        this.activeTab = storedTab && tabs.includes(storedTab)
            ? storedTab
            : "general";
    }

    private isQiaomuIntegration(): boolean {
        return !!(this.plugin as LanguageLearner & { host?: unknown }).host;
    }

    display() {
        this.stopMdictStatusRefresh();
        const { containerEl } = this;
        containerEl.empty();
        const integrated = this.isQiaomuIntegration();

        // Add custom CSS
        this.addStyles(containerEl);

        // Main Container
        const mainContainer = containerEl.createDiv({ cls: "ll-settings-container" });

        const tabLabels: Record<string, string> = {
            general: t("General settings"),
            dictionaries: t("Dictionary settings"),
            reading: t("Reading settings"),
            database: t("Vocabulary and review settings"),
            ai: t("AI settings"),
        };
        // (No plugin-name heading — Obsidian shows it in the tab title already.)

        // Create tab container
        const tabContainer = mainContainer.createDiv({ cls: "ll-tab-container" });

        // Create tab headers
        const tabHeaders = tabContainer.createDiv({ cls: "ll-tab-headers" });
        tabHeaders.setAttribute("role", "tablist");
        this.createTabHeader(tabHeaders, "general", tabLabels.general);
        this.createTabHeader(tabHeaders, "dictionaries", tabLabels.dictionaries);
        if (!integrated) this.createTabHeader(tabHeaders, "reading", tabLabels.reading);
        this.createTabHeader(tabHeaders, "database", tabLabels.database);
        if (!integrated) this.createTabHeader(tabHeaders, "ai", tabLabels.ai);

        // Create tab contents wrapper for card effect
        const contentWrapper = tabContainer.createDiv({ cls: "ll-content-wrapper" });
        const tabContents = contentWrapper.createDiv({ cls: "ll-tab-contents" });

        // Tab 1: General
        const generalTab = tabContents.createDiv({ cls: "ll-tab-content", attr: { "data-tab": "general", id: "ll-panel-general", role: "tabpanel", "aria-labelledby": "ll-tab-general", tabindex: "0" } });
        this.queryGeneralSettings(generalTab);

        // Tab 2: Dictionaries
        const dictsTab = tabContents.createDiv({ cls: "ll-tab-content", attr: { "data-tab": "dictionaries", id: "ll-panel-dictionaries", role: "tabpanel", "aria-labelledby": "ll-tab-dictionaries", tabindex: "0" } });
        this.dictionarySettings(dictsTab);

        if (!integrated) {
            const readingTab = tabContents.createDiv({ cls: "ll-tab-content", attr: { "data-tab": "reading", id: "ll-panel-reading", role: "tabpanel", "aria-labelledby": "ll-tab-reading", tabindex: "0" } });
            this.readingSettings(readingTab);
        }

        // Tab 4: Vocabulary & Review
        const dbTab = tabContents.createDiv({ cls: "ll-tab-content", attr: { "data-tab": "database", id: "ll-panel-database", role: "tabpanel", "aria-labelledby": "ll-tab-database", tabindex: "0" } });
        this.fileDBSettings(dbTab);
        this.textDBSettings(dbTab);
        this.reviewSettings(dbTab);

        if (!integrated) {
            const aiTab = tabContents.createDiv({ cls: "ll-tab-content", attr: { "data-tab": "ai", id: "ll-panel-ai", role: "tabpanel", "aria-labelledby": "ll-tab-ai", tabindex: "0" } });
            this.aiSettings(aiTab);
        }

        // Show active tab
        this.switchTab(this.activeTab);
        this.plugin.requestMdictWindowStatuses();
        this.mdictStatusTimer = window.setInterval(() => {
            this.plugin.requestMdictWindowStatuses();
            this.refreshMdictStatuses();
        }, 1000);
    }

    hide(): void {
        this.stopMdictStatusRefresh();
        super.hide();
    }

    private stopMdictStatusRefresh(): void {
        if (this.mdictStatusTimer !== null) {
            window.clearInterval(this.mdictStatusTimer);
            this.mdictStatusTimer = null;
        }
    }

    private refreshMdictStatuses(): void {
        const fs = Platform.isDesktopApp ? (window as any).require?.('fs') : null;
        this.containerEl.querySelectorAll<HTMLElement>('.ll-mdict-row').forEach((row) => {
            const index = Number(row.dataset.mdictIndex);
            const entry = this.plugin.settings.mdict_files[index];
            const statusEl = row.querySelector<HTMLElement>('.ll-mdict-status');
            const recoverEl = row.querySelector<HTMLButtonElement>('.ll-mdict-recover');
            if (!entry || !statusEl) return;

            let label: string;
            let state: string;
            let fileMissing = false;
            if (!Platform.isDesktopApp) {
                label = t('MDict desktop status');
                state = 'disabled';
            } else if (!entry.enabled) {
                label = t('MDict disabled');
                state = 'disabled';
            } else if (fs && !fs.existsSync(entry.path)) {
                label = t('MDict file missing');
                state = 'error';
                fileMissing = true;
            } else {
                const status = this.plugin.getMdictStatus(`mdict_${index}`);
                state = status?.state || 'unavailable';
                const labels: Record<string, string> = {
                    idle: t('MDict waiting'),
                    loading: t('MDict loading'),
                    ready: t('MDict ready'),
                    error: t('MDict load failed'),
                    unavailable: t('MDict registering'),
                };
                label = labels[state] || labels.unavailable;
                if (state === 'error' && status?.error) label += `: ${status.error}`;
            }
            if (statusEl.textContent !== label || statusEl.dataset.state !== state) {
                statusEl.setText(label);
                statusEl.dataset.state = state;
            }
            recoverEl?.classList.toggle('is-visible', fileMissing);
        });
    }

    private createTabHeader(container: HTMLElement, id: string, label: string) {
        const tab = container.createEl("button", {
            cls: "ll-tab-header",
            attr: {
                type: "button",
                role: "tab",
                "aria-selected": "false",
                tabindex: "-1",
            },
        });
        tab.createSpan({ text: label, cls: "ll-tab-label" });

        tab.dataset.tab = id;
        tab.id = `ll-tab-${id}`;
        tab.setAttribute("aria-controls", `ll-panel-${id}`);

        tab.addEventListener("click", () => {
            this.switchTab(id);
        });
        tab.addEventListener("keydown", (event) => {
            const headers = Array.from(this.containerEl.querySelectorAll<HTMLElement>('[role="tab"]'));
            const currentIndex = headers.indexOf(tab);
            if (currentIndex < 0) return;

            let nextIndex = currentIndex;
            if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % headers.length;
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + headers.length) % headers.length;
            if (event.key === "Home") nextIndex = 0;
            if (event.key === "End") nextIndex = headers.length - 1;
            if (nextIndex === currentIndex) return;

            event.preventDefault();
            const next = headers[nextIndex];
            this.switchTab(next.dataset.tab || "general");
            next.focus();
        });
    }

    private switchTab(tabId: string) {
        this.activeTab = tabId;
        try {
            window.localStorage.setItem("qiaomu-english-settings-tab", tabId);
        } catch {
            // Tab state is a convenience; settings must still work without storage.
        }

        // Update headers
        const headers = this.containerEl.querySelectorAll(".ll-tab-header");
        headers.forEach(header => {
            if ((header as HTMLElement).dataset.tab === tabId) {
                header.addClass("active");
                header.setAttribute("aria-selected", "true");
                header.setAttribute("tabindex", "0");
            } else {
                header.removeClass("active");
                header.setAttribute("aria-selected", "false");
                header.setAttribute("tabindex", "-1");
            }
        });

        // Update contents
        const contents = this.containerEl.querySelectorAll(".ll-tab-content");
        contents.forEach(content => {
            if ((content as HTMLElement).dataset.tab === tabId) {
                (content as HTMLElement).style.display = "block";
                (content as HTMLElement).addClass("active");
                content.setAttribute("aria-hidden", "false");
            } else {
                (content as HTMLElement).style.display = "none";
                (content as HTMLElement).removeClass("active");
                content.setAttribute("aria-hidden", "true");
            }
        });
    }

    private addStyles(containerEl: HTMLElement) {
        // CSS is now loaded from external file via import
        // Just ensure the container has proper class for styling
        containerEl.addClass("ll-settings-root");
    }

    private refreshDisplayPreservingScroll(): void {
        const scrollEl = this.containerEl.closest<HTMLElement>(".vertical-tab-content") || this.containerEl.parentElement;
        const scrollTop = scrollEl?.scrollTop || 0;
        this.display();
        window.requestAnimationFrame(() => {
            const nextScrollEl = this.containerEl.closest<HTMLElement>(".vertical-tab-content") || this.containerEl.parentElement;
            if (nextScrollEl) nextScrollEl.scrollTop = scrollTop;
        });
    }

    private getMarkdownFilePaths(currentValue?: string): string[] {
        const files = this.app.vault.getMarkdownFiles()
            .map((file) => file.path)
            .sort((a, b) => a.localeCompare(b));

        return currentValue && !files.includes(currentValue) ? [currentValue, ...files] : files;
    }

    private getFolderPaths(currentValue?: string): string[] {
        const folders = this.app.vault.getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder)
            .map((folder) => folder.path)
            .filter((path) => path)
            .sort((a, b) => a.localeCompare(b));

        return currentValue && !folders.includes(currentValue) ? [currentValue, ...folders] : folders;
    }

    private createPathPickerSetting(
        containerEl: HTMLElement,
        name: string,
        description: string,
        currentValue: string,
        paths: string[],
        title: string,
        onChange: (path: string) => Promise<void>,
    ) {
        let selectedPath = currentValue || "";
        const setting = new Setting(containerEl).setName(name).setDesc(description);
        const currentEl = setting.descEl.createDiv({ cls: "ll-setting-current" });
        const renderCurrent = () => {
            currentEl.textContent = `${t("Current")}: ${selectedPath || t("Not set")}`;
        };
        renderCurrent();

        setting.addButton(button => button
            .setButtonText(t("Choose"))
            .onClick(() => {
                new VaultPathSuggestModal(
                    this.app,
                    paths,
                    title,
                    t("No matching items"),
                    async (path) => {
                        selectedPath = path;
                        await onChange(path);
                        renderCurrent();
                    },
                ).open();
            }));
        return setting;
    }

    private getDictionaryOrder(): string[] {
        return Object.keys(this.plugin.settings.dictionaries)
            .filter((id) => !!dicts[id])
            .sort((a, b) => (this.plugin.settings.dictionaries[a].priority - this.plugin.settings.dictionaries[b].priority) || a.localeCompare(b));
    }

    private async moveDictionary(id: string, direction: -1 | 1): Promise<void> {
        const order = this.getDictionaryOrder();
        const index = order.indexOf(id);
        const targetIndex = index + direction;
        if (index < 0 || targetIndex < 0 || targetIndex >= order.length) return;

        const targetId = order[targetIndex];
        const currentPriority = this.plugin.settings.dictionaries[id].priority;
        this.plugin.settings.dictionaries[id].priority = this.plugin.settings.dictionaries[targetId].priority;
        this.plugin.settings.dictionaries[targetId].priority = currentPriority;
        this.plugin.store.dictsChange = !this.plugin.store.dictsChange;
        await this.plugin.saveSettings();
        this.refreshDisplayPreservingScroll();
    }

    learningAiPromptSettings(containerEl: HTMLElement) {
        const promptAdvanced = containerEl.createEl("details", { cls: "qiaomu-reader-settings-disclosure" });
        promptAdvanced.createEl("summary", { text: t("English learning prompts") });
        const body = promptAdvanced.createDiv({ cls: "qiaomu-reader-settings-disclosure-body" });
        new Setting(body)
            .setName(t("System Prompt"))
            .setDesc(t("Prompt for dictionary definition"))
            .addTextArea(text => {
                const apply = async (value: string) => {
                    this.plugin.settings.ai.prompt = value;
                    await this.plugin.saveSettings();
                };
                const delayedApply = debounce(apply, 600);
                text.setValue(this.plugin.settings.ai.prompt).onChange(value => delayedApply(value));
                text.inputEl.addEventListener("blur", () => { void apply(text.inputEl.value); });
                text.inputEl.addClass("ll-prompt-input");
            });
        new Setting(body)
            .setName(t("Translation Prompt"))
            .setDesc(t("Prompt for sentence translation"))
            .addTextArea(text => {
                const apply = async (value: string) => {
                    this.plugin.settings.ai.trans_prompt = value;
                    await this.plugin.saveSettings();
                };
                const delayedApply = debounce(apply, 600);
                text.setValue(this.plugin.settings.ai.trans_prompt).onChange(value => delayedApply(value));
                text.inputEl.addEventListener("blur", () => { void apply(text.inputEl.value); });
                text.inputEl.addClass("ll-prompt-input");
            });
    }

    aiSettings(containerEl: HTMLElement) {
        new Setting(containerEl).setName(t("AI Settings")).setHeading();

        new Setting(containerEl)
            .setName(t("Provider"))
            .setDesc(t("Select AI Provider"))
            .addDropdown(dropdown => {
                Object.keys(AI_PROVIDERS).forEach(key => {
                    dropdown.addOption(key, AI_PROVIDERS[key as keyof typeof AI_PROVIDERS].label);
                });
                dropdown.setValue(this.plugin.settings.ai.provider)
                    .onChange(async (value) => {
                        this.plugin.settings.ai.provider = value;
                        const provider = AI_PROVIDERS[value as keyof typeof AI_PROVIDERS];
                        if (value !== 'custom') {
                            this.plugin.settings.ai.api_url = provider.url;
                            if (provider.models.length > 0) {
                                this.plugin.settings.ai.model = provider.models[0];
                            }
                        }
                        await this.plugin.saveSettings();
                        this.refreshDisplayPreservingScroll();
                    });
            });

        const connectionAdvanced = containerEl.createEl("details", { cls: "ll-collapsible-settings" });
        connectionAdvanced.createEl("summary", { text: t("Advanced connection settings") });

        let apiUrlInput: HTMLInputElement | null = null;
        new Setting(connectionAdvanced)
            .setName(t("API URL"))
            .setDesc(t("API Endpoint URL"))
            .addText(text => {
                apiUrlInput = text.inputEl;
                const apply = async (value: string) => {
                    this.plugin.settings.ai.api_url = value.trim();
                    await this.plugin.saveSettings();
                };
                const delayedApply = debounce(apply, 600);
                text.setValue(this.plugin.settings.ai.api_url)
                    .onChange((value) => { delayedApply(value); });
                text.inputEl.addClass("ll-wide-input");
                text.inputEl.addEventListener("blur", () => { void apply(text.inputEl.value); });
            });

        let apiKeyInput: HTMLInputElement | null = null;
        const apiKeySetting = new Setting(containerEl)
            .setName(t("API Key"))
            .setDesc(t("Enter your API Key"))
            .addText(text => {
                apiKeyInput = text.inputEl;
                text.setPlaceholder("sk-... / AIza...")
                    .setValue(this.plugin.settings.ai.api_key)
                    .onChange((value) => {
                        // API Key 格式校验提示
                        const inputEl = text.inputEl;
                        const trimmed = value.trim();
                        if (trimmed && !trimmed.startsWith("sk-") && !trimmed.startsWith("AIza") && trimmed.length < 20) {
                            inputEl.style.borderColor = "var(--text-error)";
                            inputEl.title = t("API Key format may be invalid");
                        } else {
                            inputEl.style.borderColor = "var(--background-modifier-border)";
                            inputEl.title = "";
                        }
                        delayedSaveApiKey(trimmed);
                    });
                // 密码模式隐藏 API Key
                text.inputEl.type = "password";
                text.inputEl.addClass("ll-wide-input");
            });
        apiKeySetting.settingEl.addClass('ll-ai-key-setting');
        const applyApiKey = async (value: string) => {
            this.plugin.settings.ai.api_key = value.trim();
            await this.plugin.saveSettings();
        };
        const delayedSaveApiKey = debounce(applyApiKey, 600);
        apiKeyInput?.addEventListener("blur", () => {
            if (apiKeyInput) void applyApiKey(apiKeyInput.value);
        });
        apiKeySetting.addExtraButton(button => button
            .setIcon("eye")
            .setTooltip(t("Show or hide API Key"))
            .onClick(() => {
                if (!apiKeyInput) return;
                apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
            }));

        // Add dropdown for model selection if provider has models
        const currentProvider = AI_PROVIDERS[this.plugin.settings.ai.provider as keyof typeof AI_PROVIDERS];
        if (currentProvider && currentProvider.models.length > 0) {
            new Setting(containerEl)
                .setName(t("Select Model"))
                .setDesc(t("Choose from available models"))
                .addDropdown(dropdown => {
                    currentProvider.models.forEach(model => {
                        dropdown.addOption(model, model);
                    });
                    // Handle case where current model is not in the list
                    if (!currentProvider.models.includes(this.plugin.settings.ai.model)) {
                        dropdown.addOption(this.plugin.settings.ai.model, `${t("Current")}: ${this.plugin.settings.ai.model}`);
                    }

                    dropdown.setValue(this.plugin.settings.ai.model)
                        .onChange(async (value) => {
                            this.plugin.settings.ai.model = value;
                            await this.plugin.saveSettings();
                        });
                });
        } else {
            new Setting(containerEl)
                .setName(t("Model Name"))
                .setDesc(t("Enter the model name"))
                .addText(text => text
                    .setValue(this.plugin.settings.ai.model)
                    .onChange(async (value) => {
                        this.plugin.settings.ai.model = value;
                        await this.plugin.saveSettings();
                    })
                );
        }

        const promptAdvanced = containerEl.createEl("details", { cls: "ll-collapsible-settings" });
        promptAdvanced.createEl("summary", { text: t("Prompt customization") });

        new Setting(promptAdvanced)
            .setName(t("System Prompt"))
            .setDesc(t("Prompt for dictionary definition"))
            .addTextArea(text => {
                const apply = async (value: string) => {
                    this.plugin.settings.ai.prompt = value;
                    await this.plugin.saveSettings();
                };
                const delayedApply = debounce(apply, 600);
                text.setValue(this.plugin.settings.ai.prompt)
                    .onChange((value) => { delayedApply(value); });
                text.inputEl.addEventListener("blur", () => { void apply(text.inputEl.value); });
                text.inputEl.addClass("ll-prompt-input");
            });

        new Setting(promptAdvanced)
            .setName(t("Translation Prompt"))
            .setDesc(t("Prompt for sentence translation"))
            .addTextArea(text => {
                const apply = async (value: string) => {
                    this.plugin.settings.ai.trans_prompt = value;
                    await this.plugin.saveSettings();
                };
                const delayedApply = debounce(apply, 600);
                text.setValue(this.plugin.settings.ai.trans_prompt)
                    .onChange((value) => { delayedApply(value); });
                text.inputEl.addEventListener("blur", () => { void apply(text.inputEl.value); });
                text.inputEl.addClass("ll-prompt-input");
            });

        let testFeedback: HTMLElement | null = null;
        const showTestFeedback = (message: string, state: 'loading' | 'success' | 'error') => {
            if (!testFeedback) return;
            testFeedback.setText(message);
            testFeedback.dataset.state = state;
        };
        new Setting(containerEl)
            .setName(t("Test Connection"))
            .setDesc(t("Test if the API configuration is correct"))
            .addButton(button => button
                .setButtonText(t("Test"))
                .onClick(async () => {
                    button.setButtonText(t("Testing..."));
                    button.setDisabled(true);
                    showTestFeedback(t("Testing..."), 'loading');
                    try {
                        const { model } = this.plugin.settings.ai;
                        const apiKey = (apiKeyInput?.value ?? this.plugin.settings.ai.api_key).trim();
                        const url = (apiUrlInput?.value ?? this.plugin.settings.ai.api_url).trim();

                        if (!apiKey) {
                            showTestFeedback(t("Please enter API Key first"), 'error');
                            apiKeyInput?.focus();
                            return;
                        }

                        let parsedUrl: URL;
                        try {
                            parsedUrl = new URL(url);
                        } catch {
                            connectionAdvanced.open = true;
                            showTestFeedback(t("API URL must use HTTPS"), 'error');
                            return;
                        }
                        const isLocalDev = parsedUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsedUrl.hostname);
                        if (parsedUrl.protocol !== 'https:' && !isLocalDev) {
                            connectionAdvanced.open = true;
                            showTestFeedback(t("API URL must use HTTPS"), 'error');
                            return;
                        }
                        const headers: Record<string, string> = {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${apiKey}`
                        };
                        const body = {
                            model: model,
                            messages: [{ role: "user", content: "Hi" }],
                            max_tokens: 5
                        };

                        const response = await withTimeout(requestUrl({
                            url: url,
                            method: "POST",
                            headers: headers,
                            body: JSON.stringify(body)
                        }), 15000);

                        if (response.status === 200) {
                            showTestFeedback(t("Connection successful!"), 'success');
                        } else {
                            showTestFeedback(`${t("Connection failed")}: ${response.status}`, 'error');
                        }
                    } catch (error: any) {
                        let msg = t("Connection failed");
                        if (error.status) {
                            switch (error.status) {
                                case 401: msg = t("Invalid API Key (401)"); break;
                                case 403: msg = t("Permission denied (403)"); break;
                                case 404: msg = t("Invalid API URL (404)"); break;
                                case 429: msg = t("Rate limit exceeded (429)"); break;
                                case 500: msg = t("Server error (500)"); break;
                                case 503: msg = t("Service unavailable (503)"); break;
                            }
                        }
                        showTestFeedback(msg, 'error');
                    } finally {
                        button.setButtonText(t("Test"));
                        button.setDisabled(false);
                    }
                }));
        testFeedback = containerEl.createDiv({
            cls: 'll-ai-test-feedback',
            attr: { role: 'status', 'aria-live': 'polite' },
        });
        containerEl.appendChild(connectionAdvanced);
        containerEl.appendChild(promptAdvanced);
        containerEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((input) => {
            input.addEventListener('input', () => {
                if (testFeedback) testFeedback.empty();
            });
        });
    }

    // Backend server feature removed

    queryGeneralSettings(containerEl: HTMLElement) {
        new Setting(containerEl).setName(t("Lookup")).setHeading();

        new Setting(containerEl)
            .setName(t("Popup Search Panel"))
            .setDesc(t("Use a popup search panel"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.popup_search)
                .onChange(async (value) => {
                    this.plugin.settings.popup_search = value;
                    this.plugin.store.popupSearch = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("Auto pronounce"))
            .setDesc(t("Auto pronounce when searching"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.auto_pron)
                .onChange(async (value) => {
                    this.plugin.settings.auto_pron = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("Pronunciation Accent"))
            .setDesc(t("Pronunciation Accent Desc"))
            .addDropdown(d => d
                .addOption("us", `${t("American")} (American)`)
                .addOption("uk", `${t("British")} (British)`)
                .setValue(this.plugin.settings.hover_pron_accent || "us")
                .onChange(async (value) => {
                    this.plugin.settings.hover_pron_accent = value as "us" | "uk";
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("Word Select"))
            .setDesc(t("Press function key and select text to translate"))
            .addDropdown(funcKey => funcKey
                .addOption("ctrlKey", "Ctrl")
                .addOption("altKey", "Alt")
                .addOption("metaKey", "Meta")
                .addOption("disable", t("Disable"))
                .setValue(this.plugin.settings.function_key)
                .onChange(async (value: "ctrlKey" | "altKey" | "metaKey" | "disable") => {
                    this.plugin.settings.function_key = value;
                    await this.plugin.saveSettings();
                })
            );
    }

    dictionarySettings(containerEl: HTMLElement) {
        new Setting(containerEl).setName(t("Dictionaries")).setHeading();

        let createDictSetting = (id: string, name: string, description: string) => {
            const setting = new Setting(containerEl)
                .setName(name)
                .setDesc(`${description} · ${t("Lower number appears earlier")}`)
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.dictionaries[id].enable)
                    .onChange(async (value) => {
                        this.plugin.settings.dictionaries[id].enable = value;
                        this.plugin.store.dictsChange = !this.plugin.store.dictsChange;
                        await this.plugin.saveSettings();
                    }))
                .addDropdown(num => num
                    .addOption("1", "1")
                    .addOption("2", "2")
                    .addOption("3", "3")
                    .addOption("4", "4")
                    .addOption("5", "5")
                    .addOption("6", "6")
                    .addOption("7", "7")
                    .addOption("8", "8")
                    .addOption("9", "9")
                    .addOption("10", "10")
                    .setValue(this.plugin.settings.dictionaries[id].priority.toString())
                    .onChange(async (value: string) => {
                        this.plugin.settings.dictionaries[id].priority = parseInt(value);
                        this.plugin.store.dictsChange = !this.plugin.store.dictsChange;
                        await this.plugin.saveSettings();
                    })
                );
            const order = this.getDictionaryOrder();
            const index = order.indexOf(id);
            setting.addExtraButton(button => button
                .setIcon("arrow-up")
                .setTooltip(t("Move up"))
                .setDisabled(index <= 0)
                .onClick(() => { void this.moveDictionary(id, -1); }));
            setting.addExtraButton(button => button
                .setIcon("arrow-down")
                .setTooltip(t("Move down"))
                .setDisabled(index < 0 || index >= order.length - 1)
                .onClick(() => { void this.moveDictionary(id, 1); }));
        };

        Object.keys(dicts)
            .filter((id) => !id.startsWith("mdict_"))
            .filter((id) => !!this.plugin.settings.dictionaries[id])
            .sort((a, b) => (this.plugin.settings.dictionaries[a].priority - this.plugin.settings.dictionaries[b].priority) || a.localeCompare(b))
            .forEach((dict: keyof typeof dicts) => {
            createDictSetting(dict, dicts[dict].name, dicts[dict].description);
            });

        const applyDictHeight = async (raw: string) => {
            const value = normalizeDictionaryHeight(raw, this.plugin.settings.dict_height || "300px");
            this.plugin.settings.dict_height = value;
            store.dictHeight = value;
            await this.plugin.saveSettings();
        };

        new Setting(containerEl)
            .setName(t("Dictionary Height"))
            .setDesc(t("Dictionary Height Desc"))
            .addSlider(slider => slider
                .setLimits(200, 600, 10)
                .setValue(parseInt(this.plugin.settings.dict_height, 10) || 300)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    await applyDictHeight(`${value}px`);
                })
            );

        new Setting(containerEl)
            .setName(t("Dict Font Size"))
            .setDesc(t("Dict Font Size Desc"))
            .addDropdown(dropdown => {
                const current = this.plugin.settings.dict_font_size || "16px";
                for (let size = 12; size <= 20; size++) {
                    dropdown.addOption(`${size}px`, `${size}px`);
                }
                if (!Array.from(dropdown.selectEl.options).some((option) => option.value === current)) {
                    dropdown.addOption(current, `${t("Current")}: ${current}`);
                }
                dropdown.setValue(current).onChange(async (value) => {
                    const normalized = normalizeDictionaryFontSize(value, "16px");
                    this.plugin.settings.dict_font_size = normalized;
                    store.dictFontSize = normalized;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName(t("Dict Font Family"))
            .setDesc(t("Dict Font Family Desc"))
            .addDropdown(dropdown => {
                const current = this.plugin.settings.dict_font_family || "";
                const options = getInitialFontOptions(current, "");
                const known = new Set<string>();
                for (const option of options) {
                    dropdown.addOption(option.value, option.label);
                    known.add(option.value);
                }
                dropdown.setValue(current);
                dropdown.selectEl.style.fontFamily = current || SYSTEM_READING_FONT;

                void discoverDesktopFontNames().then((fontNames) => {
                    const sorted = [...new Set(fontNames)]
                        .filter((name) => name.length > 1 && canUseFont(name))
                        .sort((a, b) => a.localeCompare(b));
                    for (const name of sorted) {
                        const value = fontCssValue(name);
                        if (known.has(value)) continue;
                        dropdown.addOption(value, name);
                        known.add(value);
                    }
                });

                dropdown.onChange(async (value) => {
                    this.plugin.settings.dict_font_family = value;
                    store.dictFontFamily = value;
                    dropdown.selectEl.style.fontFamily = value || SYSTEM_READING_FONT;
                    await this.plugin.saveSettings();
                });
            });

        // ── MDict local dictionaries ────────────────────────────────────────
        new Setting(containerEl).setName(t("Local MDict Dictionaries")).setHeading();
        containerEl.createEl("p", {
            text: t("MDict description"),
            cls: "setting-item-description ll-mdict-description"
        });

        const renderMdictList = () => {
            // Clear and re-render the mdict list
            const listContainer = containerEl.querySelector('.ll-mdict-list') as HTMLElement;
            if (!listContainer) return;
            listContainer.empty();

            const files = this.plugin.settings.mdict_files;
            if (files.length === 0) {
                listContainer.createEl("div", {
                    text: t("No local dictionaries"),
                    cls: "setting-item-description"
                });
            }

            files.forEach((entry, idx) => {
                const row = listContainer.createDiv({ cls: "ll-mdict-row" });
                row.dataset.mdictIndex = String(idx);
                // Toggle
                const toggleEl = row.createEl("input", { type: "checkbox" }) as HTMLInputElement;
                toggleEl.checked = entry.enabled;
                toggleEl.setAttribute("aria-label", `${t("Enable dictionary")}: ${entry.name}`);
                toggleEl.addEventListener("change", async () => {
                    this.plugin.settings.mdict_files[idx].enabled = toggleEl.checked;
                    await this.plugin.saveSettings();
                    (this.plugin as any).reinitMdictEngines?.();
                    this.refreshMdictStatuses();
                });

                // Name label
                row.createEl("span", { text: entry.name, cls: "ll-mdict-name" });

                // Path (truncated)
                const shortPath = entry.path.length > 50
                    ? "..." + entry.path.slice(-47)
                    : entry.path;
                row.createEl("span", { text: shortPath, cls: "ll-mdict-path", title: entry.path });
                row.createEl("span", { cls: "ll-mdict-status", attr: { role: "status" } });
                const recoverBtn = row.createEl("button", {
                    text: t("Replace MDX File"),
                    cls: "ll-mdict-recover",
                    attr: { type: "button" },
                });
                recoverBtn.addEventListener("click", () => {
                    void this.replaceMdictFile(idx, renderMdictList);
                });

                // Priority (position in dict panel)
                const priEl = row.createEl("select", { cls: "ll-mdict-priority" }) as HTMLSelectElement;
                priEl.setAttribute("aria-label", `${t("Priority")}: ${entry.name}`);
                for (let p = 1; p <= 10; p++) {
                    const opt = priEl.createEl("option", { text: String(p), value: String(p) });
                    const dictId = `mdict_${idx}`;
                    const current = this.plugin.settings.dictionaries[dictId]?.priority ?? (idx + 5);
                    if (p === current) opt.selected = true;
                }
                priEl.addEventListener("change", async () => {
                    const dictId = `mdict_${idx}`;
                    if (!this.plugin.settings.dictionaries[dictId]) {
                        this.plugin.settings.dictionaries[dictId] = { enable: entry.enabled, priority: parseInt(priEl.value) };
                    } else {
                        this.plugin.settings.dictionaries[dictId].priority = parseInt(priEl.value);
                    }
                    this.plugin.store.dictsChange = !this.plugin.store.dictsChange;
                    await this.plugin.saveSettings();
                });

                const order = this.getDictionaryOrder();
                const dictId = `mdict_${idx}`;
                const orderIndex = order.indexOf(dictId);
                const upBtn = row.createEl("button", { cls: "ll-mdict-order-btn", attr: { type: "button", "aria-label": t("Move up") } });
                setIcon(upBtn, "arrow-up");
                upBtn.disabled = orderIndex <= 0;
                upBtn.addEventListener("click", () => { void this.moveDictionary(dictId, -1); });
                const downBtn = row.createEl("button", { cls: "ll-mdict-order-btn", attr: { type: "button", "aria-label": t("Move down") } });
                setIcon(downBtn, "arrow-down");
                downBtn.disabled = orderIndex < 0 || orderIndex >= order.length - 1;
                downBtn.addEventListener("click", () => { void this.moveDictionary(dictId, 1); });

                // Delete button
                const delBtn = row.createEl("button", { cls: "ll-mdict-del", attr: { type: "button", "aria-label": `${t("Delete dictionary")}: ${entry.name}` } });
                setIcon(delBtn, "trash-2");
                delBtn.addEventListener("click", async () => {
                    const mdictSettings = this.plugin.settings.mdict_files.map((_, index) =>
                        this.plugin.settings.dictionaries[`mdict_${index}`]
                            ? { ...this.plugin.settings.dictionaries[`mdict_${index}`] }
                            : undefined
                    );
                    this.plugin.settings.mdict_files.splice(idx, 1);
                    Object.keys(this.plugin.settings.dictionaries)
                        .filter((id) => id.startsWith("mdict_"))
                        .forEach((id) => delete this.plugin.settings.dictionaries[id]);
                    this.plugin.settings.mdict_files.forEach((_, nextIndex) => {
                        const oldIndex = nextIndex >= idx ? nextIndex + 1 : nextIndex;
                        this.plugin.settings.dictionaries[`mdict_${nextIndex}`] = mdictSettings[oldIndex]
                            || { enable: true, priority: nextIndex + 5 };
                    });
                    await this.plugin.saveSettings();
                    (this.plugin as any).reinitMdictEngines?.();
                    renderMdictList();
                });
            });
            this.refreshMdictStatuses();
        };

        // List container
        const listContainer = containerEl.createDiv({ cls: "ll-mdict-list" });
        renderMdictList();

        // "Add .mdx file" button
        const mdictAddSetting = new Setting(containerEl)
            .setName(t("Add MDict Dictionary"));
        if (Platform.isMobileApp) {
            mdictAddSetting
                .setDesc(t("MDict desktop only"))
                .addButton(btn => btn
                    .setButtonText(t("Desktop only"))
                    .setDisabled(true));
        } else {
            mdictAddSetting
                .setDesc(t("Select local .mdx files; multiple supported"))
                .addButton(btn => btn
                .setButtonText(t("Select MDX File"))
                .onClick(async () => {
                    // Use Electron's dialog to pick files
                    try {
                        const electron = (window as any).require?.('electron');
                        if (!electron) {
                            new Notice(t("MDict desktop only"));
                            return;
                        }
                        const { remote } = electron;
                        const { dialog } = remote || electron.ipcRenderer;
                        if (!dialog) {
                            // Fallback: manual path input
                            this.showMdictPathInputModal(async (path: string, name: string) => {
                                await this.addMdictFile(path, name);
                                renderMdictList();
                            });
                            return;
                        }
                        const result = await dialog.showOpenDialog({
                            title: t("Select MDX File"),
                            filters: [{ name: "MDict", extensions: ["mdx"] }],
                            properties: ["openFile", "multiSelections"],
                        });
                        if (!result.canceled && result.filePaths.length > 0) {
                            for (const filePath of result.filePaths) {
                                const pathModule = (window as any).require('path');
                                const fileName = pathModule.basename(filePath, '.mdx');
                                await this.addMdictFile(filePath, fileName);
                            }
                            renderMdictList();
                        }
                    } catch (e) {
                        // Fallback: modal input
                        this.showMdictPathInputModal(async (path: string, name: string) => {
                            await this.addMdictFile(path, name);
                            renderMdictList();
                        });
                    }
                }));
        }
        if (this.isQiaomuIntegration()) this.lookupSettings(containerEl);
    }

    private async addMdictFile(path: string, name: string): Promise<void> {
        const idx = this.plugin.settings.mdict_files.length;
        this.plugin.settings.mdict_files.push({ path, name, enabled: true });
        const dictId = `mdict_${idx}`;
        this.plugin.settings.dictionaries[dictId] = { enable: true, priority: idx + 5 };
        await this.plugin.saveSettings();
        (this.plugin as any).reinitMdictEngines?.();
        // Note: reinitMdictEngines already flips dictsChange once; do NOT flip again here
        new Notice(`${t("Dictionary added")}: ${name}`);
    }

    private async replaceMdictFile(index: number, onDone: () => void): Promise<void> {
        if (Platform.isMobileApp) {
            new Notice(t("MDict desktop only"));
            return;
        }

        const current = this.plugin.settings.mdict_files[index];
        if (!current) return;

        const apply = async (path: string, name: string) => {
            const normalizedPath = path.trim();
            if (!normalizedPath.toLowerCase().endsWith(".mdx")) {
                new Notice(t("MDict path must end with mdx"));
                return;
            }
            try {
                const fs = (window as any).require?.('fs');
                if (!fs?.statSync(normalizedPath).isFile()) throw new Error('not a file');
            } catch {
                new Notice(t("MDict replacement file unavailable"));
                return;
            }
            this.plugin.settings.mdict_files[index] = {
                ...current,
                path: normalizedPath,
                name: name.trim() || current.name,
            };
            try {
                await this.plugin.saveSettings();
            } catch {
                this.plugin.settings.mdict_files[index] = current;
                new Notice(t("MDict replacement failed"));
                return;
            }
            (this.plugin as any).reinitMdictEngines?.();
            onDone();
            new Notice(`${t("Dictionary replaced")}: ${this.plugin.settings.mdict_files[index].name}`);
        };

        let result: { canceled?: boolean; filePaths?: string[] };
        try {
            const electron = (window as any).require?.("electron");
            const { remote } = electron || {};
            const dialog = remote?.dialog || electron?.dialog;
            if (!dialog) throw new Error("dialog unavailable");
            result = await dialog.showOpenDialog({
                title: t("Replace MDX File"),
                filters: [{ name: "MDict", extensions: ["mdx"] }],
                properties: ["openFile"],
            });
        } catch {
            this.showMdictPathInputModal((path, name) => { void apply(path, name); });
            return;
        }
        if (!result.canceled && result.filePaths?.[0]) {
            await apply(result.filePaths[0], current.name);
        }
    }

    private showMdictPathInputModal(onConfirm: (path: string, name: string) => void): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText(t("Enter MDX Path"));

        const pathSetting = new Setting(modal.contentEl)
            .setName(t("Absolute file path"))
            .setDesc(t("MDict path example"));
        let pathVal = "";
        pathSetting.addText(t => t.setPlaceholder("/path/to/dict.mdx").onChange(v => { pathVal = v; }));

        const nameSetting = new Setting(modal.contentEl)
            .setName(t("Dictionary display name"));
        let nameVal = "";
        nameSetting.addText(t => t.setPlaceholder("OALD").onChange(v => { nameVal = v; }));

        new Setting(modal.contentEl)
            .addButton(btn => btn
                .setButtonText(t("Confirm Add"))
                .setCta()
                .onClick(() => {
                    if (!pathVal.endsWith(".mdx")) {
                        new Notice(t("MDict path must end with mdx"));
                        return;
                    }
                    modal.close();
                    onConfirm(pathVal.trim(), (nameVal.trim() || pathVal.split(/[\\/]/).pop()?.replace('.mdx', '') || 'MDict'));
                }))
            .addButton(btn => btn.setButtonText(t("Cancel")).onClick(() => modal.close()));

        modal.open();
    }


    fileDBSettings(containerEl: HTMLElement) {
        new Setting(containerEl).setName(t("Word File Vocabulary")).setHeading();

        this.createPathPickerSetting(
            containerEl,
            t("Word Files Database Path"),
            t("Choose a folder as word files for saving"),
            this.plugin.settings.word_folder,
            this.getFolderPaths(this.plugin.settings.word_folder),
            t("Choose word files folder"),
            async (path) => {
                this.plugin.settings.word_folder = path;
                await this.plugin.saveSettings();
                new Notice("词汇目录已更改，请重新加载 Language Learner 后继续使用。原目录的数据不会被移动或删除。");
            },
        );
    }

    textDBSettings(containerEl: HTMLElement) {
        new Setting(containerEl).setName(t("Vocabulary Database Sync")).setHeading();

        new Setting(containerEl)
            .setName(t("Auto refresh"))
            .setDesc(t("Auto refresh database when submitting"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.auto_refresh_db)
                .onChange(async (value) => {
                    this.plugin.settings.auto_refresh_db = value;
                    await this.plugin.saveSettings();
                })
            );

        this.createPathPickerSetting(
            containerEl,
            t("Word Database Path"),
            t("Choose a md file as word database for auto-completion"),
            this.plugin.settings.word_database,
            this.getMarkdownFilePaths(this.plugin.settings.word_database),
            t("Choose word database file"),
            async (path) => {
                this.plugin.settings.word_database = path;
                await this.plugin.saveSettings();
            },
        );

        this.createPathPickerSetting(
            containerEl,
            t("Review Database Path"),
            t("Choose a md file as review database for spaced-repetition"),
            this.plugin.settings.review_database,
            this.getMarkdownFilePaths(this.plugin.settings.review_database),
            t("Choose review database file"),
            async (path) => {
                this.plugin.settings.review_database = path;
                await this.plugin.saveSettings();
            },
        );
    }

    readingSettings(containerEl: HTMLElement) {
        new Setting(containerEl).setName(t("Reading Mode")).setHeading();

        new Setting(containerEl)
            .setName(t("Word Color Theme"))
            .setDesc(t("Choose how vocabulary status is displayed in reading mode"))
            .addDropdown(dropdown => dropdown
                .addOption("vivid", t("Soft") + " / Soft")
                .addOption("underline", t("Lines") + " / Lines")
                .addOption("background", t("Highlight") + " / Highlight")
                .addOption("minimal", t("Minimal") + " / Minimal")
                .addOption("lingq", "LingQ")
                .addOption("night", t("Night") + " / Night")
                .setValue(this.plugin.settings.word_color_theme || "vivid")
                .onChange(async (value) => {
                    this.plugin.settings.word_color_theme = value as any;
                    await this.plugin.saveSettings();
                    this.plugin.applyWordColorTheme();
                })
            );

        new Setting(containerEl)
            .setName(t("Font Size"))
            .setDesc(t("Reading Font Size Desc"))
            .addDropdown(dropdown => {
                const current = this.plugin.settings.font_size || "16px";
                addPresetOptions(dropdown, ["12px", "14px", "15px", "16px", "17px", "18px", "20px", "22px", "24px"], current);
                dropdown.onChange(async (value) => {
                    const normalized = normalizeReadingFontSize(value, "16px");
                    this.plugin.settings.font_size = normalized;
                    this.plugin.store.fontSize = normalized;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName(t("Font Family"))
            .setDesc(t("Choose a font available on this device; System uses the default"))
            .addDropdown(dropdown => {
                const current = this.plugin.settings.font_family || SYSTEM_READING_FONT;
                const options = getInitialReadingFontOptions(current);
                const known = new Set<string>();

                for (const option of options) {
                    dropdown.addOption(option.value, option.label);
                    known.add(option.value);
                }
                dropdown.setValue(current);
                dropdown.selectEl.style.fontFamily = current;

                void discoverDesktopFontNames().then((fontNames) => {
                    const sorted = [...new Set(fontNames)]
                        .filter((name) => name.length > 1 && canUseFont(name))
                        .sort((a, b) => a.localeCompare(b));
                    for (const name of sorted) {
                        const value = fontCssValue(name);
                        if (known.has(value)) continue;
                        dropdown.addOption(value, name);
                        known.add(value);
                    }
                });

                dropdown.onChange(async (value) => {
                    this.plugin.settings.font_family = value || SYSTEM_READING_FONT;
                    this.plugin.store.fontFamily = this.plugin.settings.font_family;
                    dropdown.selectEl.style.fontFamily = this.plugin.settings.font_family;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName(t("Line Height"))
            .setDesc(t("Line Height Desc"))
            .addDropdown(dropdown => {
                const current = this.plugin.settings.line_height || "1.8em";
                addPresetOptions(dropdown, ["1.4em", "1.5em", "1.6em", "1.7em", "1.8em", "2em", "2.2em"], current);
                dropdown.onChange(async (value) => {
                    const normalized = normalizeLineHeight(value, "1.8em");
                    this.plugin.settings.line_height = normalized;
                    this.plugin.store.lineHeight = normalized;
                    await this.plugin.saveSettings();
                });
            });

        let widthMode = this.plugin.settings.reading_width_mode || "comfortable";
        let sideSpacingSetting: Setting;

        new Setting(containerEl)
            .setName(t("Reading Width"))
            .setDesc(t("Choose a comfortable column, fill the pane, or set equal left and right spacing"))
            .addDropdown(dropdown => dropdown
                .addOption("comfortable", t("Comfortable") + " / Comfortable")
                .addOption("full", t("Full width") + " / Full")
                .addOption("manual", t("Manual") + " / Manual")
                .setValue(widthMode)
                .onChange(async (value) => {
                    widthMode = value as ReadingWidthMode;
                    this.plugin.settings.reading_width_mode = widthMode;
                    this.plugin.store.readingWidthMode = widthMode;
                    sideSpacingSetting.setDisabled(widthMode !== "manual");
                    await this.plugin.saveSettings();
                })
            );

        sideSpacingSetting = new Setting(containerEl)
            .setName(t("Side Spacing"))
            .setDesc(t("Manual mode: set the same left and right spacing as a percentage of the reading pane"))
            .addSlider(slider => slider
                .setLimits(0, 24, 1)
                .setValue(normalizeReadingSideSpacing(this.plugin.settings.reading_side_spacing, 5))
                .setDynamicTooltip()
                .onChange(async (value) => {
                    const spacing = normalizeReadingSideSpacing(value, 5);
                    this.plugin.settings.reading_side_spacing = spacing;
                    this.plugin.store.readingSideSpacing = spacing;
                    await this.plugin.saveSettings();
                })
            );
        sideSpacingSetting.setDisabled(widthMode !== "manual");

        new Setting(containerEl)
            .setName(t("Default Paragraphs"))
            .setDesc(t("How many paragraphs per page"))
            .addDropdown(num => num
                .addOption("2", `1 ${t("paragraph")}`)
                .addOption("4", `2 ${t("paragraph")}`)
                .addOption("8", `4 ${t("paragraph")}`)
                .addOption("16", `8 ${t("paragraph")}`)
                .addOption("32", `16 ${t("paragraph")}`)
                .addOption("all", t("All"))
                .setValue(this.plugin.settings.default_paragraphs)
                .onChange(async (value: string) => {
                    this.plugin.settings.default_paragraphs = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("Open count bar"))
            .setDesc(t("Count the word number of different type of article"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.word_count)
                .onChange(async (value) => {
                    this.plugin.settings.word_count = value;
                    await this.plugin.saveSettings();
                })
            );

        this.lookupSettings(containerEl);
    }

    private lookupSettings(containerEl: HTMLElement) {
        if (this.isQiaomuIntegration()) new Setting(containerEl).setName(t("Lookup")).setHeading();

        new Setting(containerEl)
            .setName(t("Use Machine Translation"))
            .setDesc(t("Auto translate sentences"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.use_machine_trans)
                .onChange(async (use_machine_trans) => {
                    this.plugin.settings.use_machine_trans = use_machine_trans;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("Click words only look up"))
            .setDesc(t("Click words only look up Desc"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.subtitle_click_lookup_only)
                .onChange(async (value) => {
                    this.plugin.settings.subtitle_click_lookup_only = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl).setName(t("Hover Definition")).setHeading();

        new Setting(containerEl)
            .setName(t("Show hover explanation"))
            .setDesc(t("Display a short explanation above the word when hovering"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.hover_definition_enabled)
                .onChange(async (value) => {
                    this.plugin.settings.hover_definition_enabled = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("Explanation language"))
            .setDesc(t("Language code for hover definition (e.g., zh, en, ja)"))
            .addDropdown(dropdown => dropdown
                .addOption("zh", "中文")
                .addOption("en", "English (英英释义)")
                .addOption("ja", "日本語")
                .addOption("ko", "한국어")
                .addOption("fr", "Français")
                .addOption("de", "Deutsch")
                .addOption("es", "Español")
                .addOption("pt", "Português")
                .addOption("ru", "Русский")
                .setValue(this.plugin.settings.hover_definition_lang)
                .onChange(async (value) => {
                    this.plugin.settings.hover_definition_lang = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("Hover Translation Provider"))
            .setDesc(t("Choose translation provider for hover definition"))
            .addDropdown(dropdown => dropdown
                .addOption("auto", t("Auto (Google → MyMemory)"))
                .addOption("bing", t("Bing Dictionary"))
                .addOption("youdao", t("Youdao"))
                .addOption("google", t("Google Translate"))
                .addOption("mymemory", "MyMemory")
                .setValue(this.plugin.settings.hover_definition_provider || "auto")
                .onChange(async (value: HoverTranslationProvider) => {
                    this.plugin.settings.hover_definition_provider = value;
                    await this.plugin.saveSettings();
                })
            );
    }

    reviewSettings(containerEl: HTMLElement) {
        new Setting(containerEl).setName(t("Review Preferences")).setHeading();

        new Setting(containerEl)
            .setName(t("Accent"))
            .setDesc(t("Choose your preferred accent"))
            .addDropdown(accent => accent
                .addOption("0", t("American"))
                .addOption("1", t("British"))
                .setValue(this.plugin.settings.review_prons)
                .onChange(async (value: "0" | "1") => {
                    this.plugin.settings.review_prons = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerEl)
            .setName(t("Delimiter"))
            .addText(text => text
                .setValue(this.plugin.settings.review_delimiter)
                .onChange(async (value) => {
                    this.plugin.settings.review_delimiter = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("Review Reflux"))
            .setDesc(t("Review reflux desc"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.review_reflux_enabled)
                .onChange(async (value) => {
                    this.plugin.settings.review_reflux_enabled = value;
                    await this.plugin.saveSettings();
                    refluxSettingsEl.style.display = value ? "" : "none";
                    if (value) refluxSettingsEl.open = true;
                })
            );

        const refluxSettingsEl = containerEl.createEl('details', { cls: 'll-collapsible-settings ll-reflux-settings' });
        refluxSettingsEl.createEl('summary', { text: t('Review thresholds') });
        refluxSettingsEl.style.display = this.plugin.settings.review_reflux_enabled ? "" : "none";

        const addThreshold = (
            nameKey: Parameters<typeof t>[0],
            get: () => number,
            set: (days: number) => void,
        ) => {
            new Setting(refluxSettingsEl)
                .setName(t(nameKey))
                .setDesc(t("Reflux threshold desc"))
                .addText(text => {
                    text.inputEl.type = "number";
                    text.inputEl.min = "1";
                    text.inputEl.max = "365";
                    text.setValue(String(get()))
                        .onChange(async (value) => {
                            const days = normalizeRefluxDays(value, get());
                            set(days);
                            text.setValue(String(days));
                            await this.plugin.saveSettings();
                        });
                });
        };

        addThreshold(
            "Reflux familiar days",
            () => this.plugin.settings.reflux_familiar_days,
            (days) => { this.plugin.settings.reflux_familiar_days = days; },
        );
        addThreshold(
            "Reflux known days",
            () => this.plugin.settings.reflux_known_days,
            (days) => { this.plugin.settings.reflux_known_days = days; },
        );
        addThreshold(
            "Reflux learned days",
            () => this.plugin.settings.reflux_learned_days,
            (days) => { this.plugin.settings.reflux_learned_days = days; },
        );
    }

    // Self-server feature removed

}
