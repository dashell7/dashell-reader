import { unified, Processor } from "unified";
import retextEnglish from "retext-english";
import { Root, Content, Literal, Parent, Sentence } from "nlcst";
import { modifyChildren } from "unist-util-modify-children";
import { visit } from "unist-util-visit";
import { toString } from "nlcst-to-string";
import { TFile } from "obsidian";

import { Phrase, Word } from "@/db/interface";
import Plugin from "@/plugin";
import { logger } from "@/utils/logger";

const STATUS_MAP = ["ignore", "learning", "familiar", "known", "learned"];
type AnyNode = Root | Content | Content[];
export let state = { loading_flag: false, };

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
    return escapeHtml(value).replace(/`/g, "&#96;");
}

function sanitizeStatusClass(status: string | undefined, fallback = "new"): string {
    if (!status) return fallback;
    return /^[a-z0-9_-]+$/i.test(status) ? status : fallback;
}

export class TextParser {
    // 记录短语位置
    phrases: Phrase[] = [];
    // 记录单词状态
    words: Map<string, Word> = new Map<string, Word>();
    // 记录音频嵌入
    audioEmbeds: Map<string, string> = new Map();
    // 渲染缓存（HTML + 统计结果）
    private htmlCache: Map<string, string> = new Map();
    private countCache: Map<string, [number, number, number]> = new Map();
    private readonly maxCacheSize = 30;
    pIdx: number = 0;
    plugin: Plugin;
    processor: Processor;
    constructor(plugin: Plugin) {
        this.plugin = plugin;
        this.processor = unified()
            .use(retextEnglish)
            .use(this.addPhrases())
            .use(this.addMarkdown())
            .use(this.stringfy2HTML());
    }

    invalidateCache() {
        this.htmlCache.clear();
        this.countCache.clear();
    }

    private touchCache<T>(cache: Map<string, T>, key: string, value: T) {
        if (cache.has(key)) {
            cache.delete(key);
        }
        cache.set(key, value);
        if (cache.size > this.maxCacheSize) {
            const oldestKey = cache.keys().next().value;
            cache.delete(oldestKey);
        }
    }

    async parse(data: string) {
        const trimmed = data.trim();
        if (!trimmed) {
            return "";
        }
        const cached = this.htmlCache.get(trimmed);
        if (cached) {
            this.touchCache(this.htmlCache, trimmed, cached);
            return cached;
        }
        const newHTML = await this.text2HTML(trimmed);
        this.touchCache(this.htmlCache, trimmed, newHTML);
        return newHTML;
    }

    async countWords(text: string): Promise<[number, number, number]> {
        const cleanText = text
            .replace(/!\[\[([^\]]+\.(?:mp3|wav|m4a|ogg|webm|flac))\]\]/gi, "")
            .trim();
        if (!cleanText) {
            return [0, 0, 0];
        }
        const cached = this.countCache.get(cleanText);
        if (cached) {
            this.touchCache(this.countCache, cleanText, cached);
            return cached;
        }
        // 等待数据库就绪，超时 5 秒
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const timeout = new Promise<boolean>((resolve) => {
            timeoutId = setTimeout(() => resolve(false), 5000);
        });
        const ready = this.plugin.db.waitForReady().then(() => true, (error) => {
            logger.warn("Database failed to initialize for countWords", error);
            return false;
        });

        const isReady = await Promise.race([ready, timeout]);
        if (timeoutId !== null) clearTimeout(timeoutId);
        if (!isReady) {
            logger.warn("Database not ready for countWords, returning default values");
            return [0, 0, 0];
        }

        const ast = this.processor.parse(cleanText);
        let wordSet: Set<string> = new Set();
        visit(ast, "WordNode", (word) => {
            let text = toString(word).toLowerCase();
            if (/[0-9\u4e00-\u9fa5]/.test(text)) return;
            wordSet.add(text);
        });
        await this.plugin.checkPath();
        let stored = await this.plugin.db.getStoredWords({
            article: "",
            words: [...wordSet],
        });
        let ignore = 0;
        stored.words.forEach((word) => {
            if (word.status === 0) ignore++;
        });
        let learn = stored.words.length - ignore;
        let unknown = wordSet.size - stored.words.length;
        const result: [number, number, number] = [unknown, learn, ignore];
        this.touchCache(this.countCache, cleanText, result);
        return result;
    }

    // ── Markdown 预处理 ──
    // 用占位符替换 Markdown 语法，避免 retext 将 HTML 标签拆成多个节点。
    // 占位符形如 MKDMARK0, MKDMARK1 …（纯字母数字，retext 视为 WordNode），
    // 在 toHTMLString 的 WordNode 分支中还原为实际 HTML。

    processMarkdownBlocks(text: string): string {
        const lines = text.split('\n');
        const result: string[] = [];
        let inCodeBlock = false;
        let codeLines: string[] = [];
        let codeLang = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // 代码块 ```
            if (trimmed.startsWith('```')) {
                if (inCodeBlock) {
                    inCodeBlock = false;
                    const lang = codeLang ? ` class="language-${escapeAttribute(codeLang)}"` : '';
                    const html = `<pre><code${lang}>${codeLines.map(l => escapeHtml(l)).join('\n')}</code></pre>`;
                    result.push(this.mkdMarker(html));
                    codeLines = [];
                } else {
                    inCodeBlock = true;
                    codeLang = trimmed.slice(3).trim();
                }
                continue;
            }
            if (inCodeBlock) { codeLines.push(line); continue; }

            // 空行
            if (!trimmed) { result.push(line); continue; }

            // 标题 # ~ ######
            const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
            if (headingMatch) {
                const level = headingMatch[1].length;
                const open = this.mkdMarker(`<h${level}>`);
                const close = this.mkdMarker(`</h${level}>`);
                result.push(`${open} ${headingMatch[2]} ${close}`);
                continue;
            }

            // 引用 >
            if (trimmed.startsWith('> ') || trimmed === '>') {
                const content = trimmed.startsWith('> ') ? trimmed.slice(2) : '';
                const open = this.mkdMarker('<blockquote><p>');
                const close = this.mkdMarker('</p></blockquote>');
                result.push(`${open} ${content} ${close}`);
                continue;
            }

            // 图片 ![alt](url)
            const imgMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
            if (imgMatch) {
                let src = imgMatch[2];
                if (!src.startsWith('http://') && !src.startsWith('https://')) {
                    const file = this.resolveVaultFile(src);
                    if (file instanceof TFile) src = this.plugin.app.vault.getResourcePath(file);
                }
                result.push(this.mkdMarker(
                    `<div class="langr-img-wrapper"><img src="${escapeAttribute(src)}" alt="${escapeAttribute(imgMatch[1])}" loading="lazy"></div>`
                ));
                continue;
            }

            // Obsidian 内嵌图片 ![[image.png]]
            const obsImgMatch = trimmed.match(/^!\[\[([^\]]+\.(?:png|jpg|jpeg|gif|svg|webp|bmp))\]\]$/i);
            if (obsImgMatch) {
                const filename = obsImgMatch[1];
                const file = this.resolveVaultFile(filename);
                if (file instanceof TFile) {
                    const src = this.plugin.app.vault.getResourcePath(file);
                    result.push(this.mkdMarker(
                        `<div class="langr-img-wrapper"><img src="${escapeAttribute(src)}" alt="${escapeAttribute(filename)}" loading="lazy"></div>`
                    ));
                } else {
                    result.push(this.mkdMarker(`<div class="langr-img-wrapper"><span class="error">Image not found: ${escapeHtml(filename)}</span></div>`));
                }
                continue;
            }

            result.push(line);
        }
        if (inCodeBlock) {
            const html = `<pre><code>${codeLines.map(l => escapeHtml(l)).join('\n')}</code></pre>`;
            result.push(this.mkdMarker(html));
        }
        return result.join('\n');
    }

    processInlineMarkdown(text: string): string {
        // 行内代码 `code`
        text = text.replace(/`([^`]+)`/g, (_m, code) =>
            this.mkdMarker(`<code>${escapeHtml(code)}</code>`)
        );

        // 粗体 **text** / __text__ (先于斜体)
        text = text.replace(/\*\*(.+?)\*\*/g, (_m, c) =>
            `${this.mkdMarker('<b>')} ${c} ${this.mkdMarker('</b>')}`
        );
        text = text.replace(/__(.+?)__/g, (_m, c) =>
            `${this.mkdMarker('<b>')} ${c} ${this.mkdMarker('</b>')}`
        );

        // 斜体 *text* / _text_
        text = text.replace(/\*(.+?)\*/g, (_m, c) =>
            `${this.mkdMarker('<i>')} ${c} ${this.mkdMarker('</i>')}`
        );
        text = text.replace(/(?<!\w)_(.+?)_(?!\w)/g, (_m, c) =>
            `${this.mkdMarker('<i>')} ${c} ${this.mkdMarker('</i>')}`
        );

        // 删除线 ~~text~~
        text = text.replace(/~~(.+?)~~/g, (_m, c) =>
            `${this.mkdMarker('<del>')} ${c} ${this.mkdMarker('</del>')}`
        );

        // 行内图片 ![alt](url)
        text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => {
            if (!src.startsWith('http://') && !src.startsWith('https://')) {
                const file = this.resolveVaultFile(src);
                if (file instanceof TFile) src = this.plugin.app.vault.getResourcePath(file);
            }
            return this.mkdMarker(`<img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}" class="langr-inline-img" loading="lazy">`);
        });

        // 链接 [text](url) — 链接文本内的单词仍被 retext 解析
        text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, linkText, href) =>
            `${this.mkdMarker(`<a href="${escapeAttribute(href)}" target="_blank" rel="noopener">`)} ${linkText} ${this.mkdMarker('</a>')}`
        );

        return text;
    }

    // Markdown 占位符映射：在 toHTMLString 的 WordNode 分支中还原为 HTML
    markdownMarkers: Map<string, string> = new Map();
    private mkdIdx = 0;

    private mkdMarker(html: string): string {
        const key = `MKDMARK${this.mkdIdx++}`;
        this.markdownMarkers.set(key, html);
        // 用空白前后包裹，避免 retext-english 把占位符与相邻的"单词字符"
        // （含 Unicode 上标 ²³¹⁴-⁹ 等，见 parse-latin 的 word 正则）合并成同一个 WordNode
        return ` ${key} `;
    }

    /**
     * Resolve an embedded Vault file even when Obsidian's metadata cache has
     * not indexed the link yet. Reading mode can render immediately after a
     * note opens, so relying on getFirstLinkpathDest alone produces false
     * "file not found" messages for valid audio and image embeds.
     */
    private resolveVaultFile(linkpath: string): TFile | null {
        let normalized = linkpath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
        try {
            normalized = decodeURIComponent(normalized);
        } catch {
            // Keep the original path when it contains malformed escape text.
        }
        if (!normalized) return null;

        const activePath = this.plugin.app.workspace.getActiveFile()?.path ?? '';
        for (const sourcePath of [activePath, '']) {
            const linked = this.plugin.app.metadataCache.getFirstLinkpathDest(normalized, sourcePath);
            if (linked instanceof TFile) return linked;
        }

        const direct = this.plugin.app.vault.getAbstractFileByPath(normalized);
        if (direct instanceof TFile) return direct;

        const lower = normalized.toLowerCase();
        return this.plugin.app.vault.getFiles().find((file) =>
            file.path.toLowerCase() === lower || file.name.toLowerCase() === lower,
        ) ?? null;
    }

    processAudioEmbeds(text: string): string {
        this.audioEmbeds.clear();
        // 匹配 ![[filename.ext]] 格式的音频文件
        const audioRegex = /!\[\[([^\]]+\.(?:mp3|wav|m4a|ogg|webm|flac))\]\]/gi;
        return text.replace(audioRegex, (match, filename) => {
            // 使用一个特殊的占位符，确保它被解析为一个单词
            const placeholder = `AUDIOEMBEDMARKER${this.audioEmbeds.size}`;
            this.audioEmbeds.set(placeholder, filename);
            return placeholder;
        });
    }

    async text2HTML(text: string) {
        this.pIdx = 0;
        this.words.clear();
        this.markdownMarkers.clear();
        this.mkdIdx = 0;
        await this.plugin.checkPath();

        // 1. Markdown 块级预处理（标题、图片、代码块、引用）→ 占位符
        text = this.processMarkdownBlocks(text);

        // 2. Markdown 行内预处理（粗体、斜体、删除线、链接、行内代码）→ 占位符
        text = this.processInlineMarkdown(text);

        // 3. 处理音频嵌入 → 占位符
        text = this.processAudioEmbeds(text);

        // 查找已知短语，用于构造ast中的PhraseNode
        this.phrases = (
            await this.plugin.db.getStoredWords({
                article: text.toLowerCase(), //文章
                words: [],
            })
        ).phrases;

        const ast = this.processor.parse(text); //将文本 text 解析为抽象语法树（AST）

        // 遍历 AST，标记音频嵌入是 inline 还是 block
        visit(ast, "SentenceNode", (sentence: Sentence) => {
            const children = sentence.children;
            const audioNodes: Content[] = [];
            let hasText = false;

            children.forEach(child => {
                if (child.type === "WordNode") {
                    const text = toString(child);
                    if (this.audioEmbeds.has(text)) {
                        audioNodes.push(child);
                    } else {
                        hasText = true;
                    }
                } else if (child.type !== "WhiteSpaceNode") {
                    // 只要有非空白字符（包括标点），就视为有文本内容，音频应当 inline
                    hasText = true;
                }
            });

            audioNodes.forEach(node => {
                if (!node.data) node.data = {};
                node.data.inline = hasText;
            });
        });

        // 获得文章中去重后的单词
        let wordSet: Set<string> = new Set();
        visit(ast, "WordNode", (word) => {
            let wordText = toString(word);
            // 如果是音频占位符，不计入单词集合
            if (this.audioEmbeds.has(wordText)) return;
            wordSet.add(wordText.toLowerCase());
        });
        // P5: 仅查询 words Map 中尚未缓存的单词，减少 DB 查询
        const unknownWords = [...wordSet].filter(w => !this.words.has(w));
        if (unknownWords.length > 0) {
            let stored = await this.plugin.db.getStoredWords({
                article: "",
                words: unknownWords,
            });
            stored.words.forEach((w) => this.words.set(w.text, w));
        }
        let HTML = this.processor.stringify(ast) as any as string;
        return HTML;
    }

    async getWordsPhrases(text: string) {
        const ast = this.processor.parse(text);
        let words: Set<string> = new Set();
        visit(ast, "WordNode", (word) => {
            words.add(toString(word).toLowerCase());
        });
        let wordsPhrases = await this.plugin.db.getStoredWords({
            article: text.toLowerCase(),
            words: [...words],
        });

        let payload = [] as string[];
        wordsPhrases.phrases.forEach((word) => {
            if (word.status > 0) payload.push(word.text);
        });
        wordsPhrases.words.forEach((word) => {
            if (word.status > 0) payload.push(word.text);
        });
        await this.plugin.checkPath();
        let res = await this.plugin.db.getExpressionsSimple(payload);
        return res;
    }

    // Plugin：在retextEnglish基础上，把AST上一些单词包裹成短语
    addPhrases() {
        let selfThis = this;
        return function (option = {}) {
            const proto = this.Parser.prototype;
            proto.useFirst("tokenizeParagraph", selfThis.phraseModifier);
        };
    }

    phraseModifier = modifyChildren(this.wrapWord2Phrase.bind(this));

    wrapWord2Phrase(node: Content, index: number, parent: Parent) {
        if (!node.hasOwnProperty("children")) return;

        if (
            this.pIdx >= this.phrases.length ||
            node.position.end.offset <= this.phrases[this.pIdx].offset
        )
            return;

        let children = (node as Sentence).children;

        let p: number;
        while (
            (p = children.findIndex(
                (child) =>
                    child.position.start.offset ===
                    this.phrases[this.pIdx].offset
            )) !== -1
        ) {
            let q = children.findIndex(
                (child) =>
                    child.position.end.offset ===
                    this.phrases[this.pIdx].offset +
                    this.phrases[this.pIdx].text.length
            );

            if (q === -1) {
                this.pIdx++;
                return;
            }
            let phrase = children.slice(p, q + 1);
            children.splice(p, q - p + 1, {
                type: "PhraseNode",
                children: phrase,
                position: {
                    start: { ...phrase[0].position.start },
                    end: { ...phrase[phrase.length - 1].position.end },
                },
            } as any);

            this.pIdx++;

            if (
                this.pIdx >= this.phrases.length ||
                node.position.end.offset <= this.phrases[this.pIdx].offset
            )
                return;
        }
    }

    // Plugin: 处理 Markdown 格式（大部分已移至预处理阶段，仅保留分割线）
    addMarkdown() {
        return () => {
            return (tree: Root) => {
                // 分割线 --- / *** / ___
                visit(tree, 'ParagraphNode', (node: any) => {
                    const text = toString(node).trim();
                    if (/^-{3,}$|^\*{3,}$|^_{3,}$/.test(text)) {
                        node.type = 'HorizontalRuleNode';
                        node.children = [];
                    }
                });
            };
        };
    }

    // Compiler部分: 在AST转换为string时包裹上相应标签
    stringfy2HTML() {
        let selfThis = this;

        return function () {
            Object.assign(this, {
                Compiler: selfThis.compileHTML.bind(selfThis),
            });
        };
    }

    compileHTML(tree: Root): string {
        return this.toHTMLString(tree);
    }

    toHTMLString(node: AnyNode): string {
        if (node.hasOwnProperty("value")) {
            return escapeHtml((node as Literal).value ?? "");
        }
        if (node.hasOwnProperty("children")) {
            let n = node as Parent;
            switch (n.type) {
                case "WordNode": {
                    let text = toString(n.children);

                    // 检查是否为 Markdown 占位符
                    if (this.markdownMarkers.has(text)) {
                        return this.markdownMarkers.get(text)!;
                    }

                    // 检查是否为音频嵌入占位符
                    if (this.audioEmbeds.has(text)) {
                        const filename = this.audioEmbeds.get(text);
                        const file = this.resolveVaultFile(filename);
                        if (file instanceof TFile) {
                            const src = this.plugin.app.vault.getResourcePath(file);
                            // 检查是否为人工录音（Scribe 或 Recording_ 开头）
                            const isHumanRecording = filename.toLowerCase().includes('scribe') ||
                                filename.toLowerCase().startsWith('recording_') ||
                                filename.toLowerCase().includes('/recording_');
                            const audioType = isHumanRecording ? 'human' : 'ai';
                            const title = isHumanRecording ? 'Play Recording (Human Voice)' : 'Play Audio (AI Voice)';
                            const safeSrc = escapeAttribute(src);
                            const safeTitle = escapeAttribute(title);

                            // 人工录音总是使用图标模式，其他音频根据 inline 属性决定
                            if (isHumanRecording) {
                                // 为 Scribe 录音使用人像图标 (Human Voice)
                                const icon = `<svg class="play-icon" viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
                                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                                </svg>`;

                                // 如果是块级，添加包装器
                                if (n.data && n.data.inline) {
                                    return `<span class="langr-audio-inline-marker langr-audio-human" data-src="${safeSrc}" title="${safeTitle}">
                                        ${icon}
                                        <svg class="pause-icon" viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
                                            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                                        </svg>
                                    </span>`;
                                } else {
                                    return `<div class="langr-audio-block-wrapper">
                                        <span class="langr-audio-inline-marker langr-audio-human" data-src="${safeSrc}" title="${safeTitle}">
                                            ${icon}
                                            <svg class="pause-icon" viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
                                                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                                            </svg>
                                        </span>
                                    </div>`;
                                }
                            } else {
                                // AI 语音根据 inline 属性决定渲染样式
                                if (n.data && n.data.inline) {
                                    const icon = `<svg class="play-icon" viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
                                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                                    </svg>`;

                                    return `<span class="langr-audio-inline-marker langr-audio-ai" data-src="${safeSrc}" title="${safeTitle}">
                                        ${icon}
                                        <svg class="pause-icon" viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor">
                                            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                                        </svg>
                                    </span>`;
                                } else {
                                    return `<div class="langr-audio-block-wrapper"><audio controls src="${safeSrc}"></audio></div>`;
                                }
                            }
                        }
                        return `<span class="langr-audio-missing" title="Audio file not found: ${escapeAttribute(filename)}">Audio unavailable</span>`;
                    }

                    let textLower = text.toLowerCase();
                    const mappedStatus = this.words.has(textLower)
                        ? STATUS_MAP[this.words.get(textLower)!.status]
                        : "new";
                    const safeStatus = sanitizeStatusClass(mappedStatus, "new");
                    const safeText = escapeHtml(text);

                    return /[0-9\u4e00-\u9fa5]/.test(text) // 不把数字当做单词
                        ? `<span class="other">${safeText}</span>`
                        : `<span class="word ${safeStatus}" role="button" tabindex="0">${safeText}</span>`;
                }
                case "PhraseNode": {
                    let childText = toString(n.children);
                    let text = this.toHTMLString(n.children);
                    // 获取词组的status
                    let phrase = this.phrases.find(
                        (p) => p.text === childText.toLowerCase()
                    );
                    const mappedStatus = phrase && typeof phrase.status === "number"
                        ? STATUS_MAP[phrase.status]
                        : "new";
                    const safeStatus = sanitizeStatusClass(mappedStatus, "new");

                    return `<span class="phrase ${safeStatus}" role="button" tabindex="0">${text}</span>`;
                }
                case "HorizontalRuleNode": {
                    return `<hr>`;
                }
                case "SentenceNode": {
                    return `<span class="stns">${this.toHTMLString(
                        n.children
                    )}</span>`;
                }
                case "ParagraphNode": {
                    return `<p>${this.toHTMLString(n.children)}</p>`;
                }
                default: {
                    return `<div class="article">${this.toHTMLString(
                        n.children
                    )}</div>`;
                }
            }
        }
        if (Array.isArray(node)) {
            let nodes = node as Content[];
            return nodes.map((n) => this.toHTMLString(n)).join("");
        }
        return "";
    }
}
