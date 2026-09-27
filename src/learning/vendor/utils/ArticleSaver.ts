/**
 * ArticleSaver — 将 HTML/文本内容清洗为 Language Learner 可识别的 Markdown 文件
 *
 * 清洗 Pipeline（参考 Obsidian Clipper 逻辑）：
 *   1. HTML 解析（原生 DOMParser，Electron 环境可用）
 *   2. 懒加载图片修复（data-src → src）
 *   3. 相对 URL → 绝对 URL
 *   4. 主内容提取（@mozilla/readability，Firefox Reader View 同款）
 *   5. HTML → Markdown（turndown + turndown-plugin-gfm）
 *      - 自定义规则：追踪像素、base64图片、figure/figcaption、代码块语言
 *   6. Markdown 后处理（折叠空行、清理残留 HTML）
 *   7. 组装 Language Learner 格式（frontmatter + ^^^article）
 */

import { App, TFile, normalizePath } from "obsidian";
import { logger } from './logger';
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

// ─── 公共类型 ─────────────────────────────────────────────────────────────────

export interface ArticleMeta {
    title: string;
    author?: string;
    description?: string;
    publishDate?: string;   // ISO 日期字符串
    sourceUrl?: string;
    feedName?: string;
    coverImage?: string;
}

export interface SaveArticleResult {
    file: TFile;
    path: string;
}

// ─── 保存入口 ─────────────────────────────────────────────────────────────────

/**
 * 将 HTML 文章保存为 Language Learner 格式的 Markdown 文件
 */
export async function saveArticleAsLangr(
    app: App,
    html: string,
    meta: ArticleMeta,
    saveFolder: string = "Language Learner/Articles"
): Promise<SaveArticleResult> {
    // 1. 清洗 HTML → Markdown
    const markdown = htmlToMarkdown(html, meta.sourceUrl);

    // 2. 组装 Language Learner 格式
    const content = buildLangrContent(markdown, meta);

    // 3. 生成安全文件名
    const datePrefix = meta.publishDate
        ? meta.publishDate.slice(0, 10)
        : new Date().toISOString().slice(0, 10);
    const safeName = safeFilename(meta.title || "article");
    const filename = `${datePrefix}-${safeName}.md`;
    const filePath = normalizePath(`${saveFolder}/${filename}`);

    // 4. 确保目录存在
    await ensureFolder(app, saveFolder);

    // 5. 写入文件（存在则追加时间戳避免覆盖）
    let finalPath = filePath;
    if (app.vault.getAbstractFileByPath(filePath)) {
        const ts = new Date().toISOString().replace(/[:.]/g, "").slice(8, 14);
        finalPath = normalizePath(`${saveFolder}/${datePrefix}-${safeName}-${ts}.md`);
    }

    const file = await app.vault.create(finalPath, content);
    return { file, path: finalPath };
}

// ─── 格式组装 ─────────────────────────────────────────────────────────────────

function buildLangrContent(markdown: string, meta: ArticleMeta): string {
    const fm = buildFrontmatter(meta);
    return `${fm}\n^^^article\n\n${markdown.trim()}\n\n^^^words\n\n^^^notes\n`;
}

function buildFrontmatter(meta: ArticleMeta): string {
    const lines: string[] = ["---", "langr: true", "langr-pos: 0"];

    const add = (key: string, value: string | undefined) => {
        if (value && value.trim()) {
            // 含特殊字符时用双引号包裹
            const needsQuote = /[:#\[\]{}|>&!*'`]/.test(value) || value.includes('"');
            const escaped = needsQuote ? `"${value.replace(/"/g, '\\"')}"` : value;
            lines.push(`${key}: ${escaped}`);
        }
    };

    add("title", meta.title);
    add("author", meta.author);
    add("source", meta.sourceUrl);
    add("date", meta.publishDate ? meta.publishDate.slice(0, 10) : undefined);
    add("feed", meta.feedName);
    add("description", meta.description ? meta.description.slice(0, 200) : undefined);
    add("cover", meta.coverImage);
    add("saved", new Date().toISOString().slice(0, 10));

    lines.push("---");
    return lines.join("\n");
}

// ─── HTML 解析 & 清洗 ─────────────────────────────────────────────────────────

/**
 * 完整的 HTML → Markdown 转换管道
 */
export function htmlToMarkdown(html: string, baseUrl?: string): string {
    if (!html || !html.trim()) return "";

    // 纯文本（没有 HTML 标签）直接返回
    if (!/<[a-zA-Z]/.test(html)) {
        return postProcessMarkdown(html);
    }

    // 1. 解析 HTML
    const doc = new DOMParser().parseFromString(html, "text/html");

    // 2. 懒加载图片修复（在 Readability 运行前，确保图片 src 真实可用）
    fixLazyImages(doc.body);

    // 3. 相对 URL 转绝对（在 Readability 运行前处理，保证输出链接可用）
    if (baseUrl) {
        absolutifyUrls(doc.body, baseUrl);
    }

    // 4. 使用 Readability 提取主内容（Firefox Reader View 同款算法）
    let contentHtml: string;
    try {
        const reader = new Readability(doc.cloneNode(true) as Document, {
            keepClasses: false,   // 移除 class 属性（避免引入原网站样式）
            serializer: (el: HTMLElement) => el.innerHTML,
        });
        const article = reader.parse();
        contentHtml = article?.content || doc.body.innerHTML;
    } catch (e) {
        logger.warn('[ArticleSaver] Readability parse failed, falling back to body:', e);
        contentHtml = doc.body.innerHTML;
    }

    // 5. HTML → Markdown（Turndown + GFM 插件）
    const td = createTurndownService();
    const md = td.turndown(contentHtml);

    // 6. 后处理
    return postProcessMarkdown(md);
}

// ─── Turndown 实例工厂 ─────────────────────────────────────────────────────────

function createTurndownService(): TurndownService {
    const td = new TurndownService({
        headingStyle: "atx",           // # 号风格标题（Obsidian 推荐）
        bulletListMarker: "-",          // 使用 - 作为列表符
        codeBlockStyle: "fenced",       // ``` 围栏代码块
        fence: "```",
        emDelimiter: "*",               // *斜体*
        strongDelimiter: "**",          // **粗体**
        linkStyle: "inlined",           // 行内链接 [text](url)
    });

    // GFM 插件：表格、删除线、任务列表
    td.use(gfm);

    // 自定义规则1：追踪像素（1×1 图片）→ 移除
    td.addRule("tracking-pixel", {
        filter: (node: Node) => {
            if (node.nodeName !== "IMG") return false;
            const img = node as HTMLImageElement;
            const w = parseInt(img.getAttribute("width") || "999");
            const h = parseInt(img.getAttribute("height") || "999");
            return w <= 1 || h <= 1;
        },
        replacement: () => "",
    });

    // 自定义规则2：base64 内联图片 → 移除（过大，污染 Markdown）
    td.addRule("base64-image", {
        filter: (node: Node) => {
            if (node.nodeName !== "IMG") return false;
            const src = (node as HTMLImageElement).getAttribute("src") || "";
            return src.startsWith("data:");
        },
        replacement: () => "",
    });

    // 自定义规则3：<figure> 只保留 img 和 figcaption（作为 alt）
    td.addRule("figure", {
        filter: "figure",
        replacement: (_content: string, node: Node) => {
            const el = node as HTMLElement;
            const img = el.querySelector("img");
            if (!img) return "";
            const src = img.getAttribute("src") || "";
            if (!src || src.startsWith("data:")) return "";
            const caption = el.querySelector("figcaption");
            const alt = caption?.textContent?.trim() || img.getAttribute("alt") || "";
            return `\n\n![${alt}](${src})\n\n`;
        },
    });

    // 自定义规则4：代码块保留语言标识
    td.addRule("fenced-code-block", {
        filter: (node: Node) => {
            return node.nodeName === "PRE" && !!(node as HTMLElement).querySelector("code");
        },
        replacement: (_content: string, node: Node) => {
            const pre = node as HTMLElement;
            const code = pre.querySelector("code");
            const langClass = code?.className || "";
            const lang = langClass.replace(/language-|hljs\s*/g, "").split(" ")[0] || "";
            const text = (code?.textContent ?? pre.textContent ?? "").trimEnd();
            return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
        },
    });

    return td;
}

// ─── DOM 预处理工具 ───────────────────────────────────────────────────────────

/** data-src / data-lazy-src 等懒加载属性 → src（在 Readability 前执行） */
function fixLazyImages(root: Element): void {
    const LAZY_ATTRS = ["data-src", "data-lazy-src", "data-original", "data-url", "data-img"];
    root.querySelectorAll("img").forEach(img => {
        for (const attr of LAZY_ATTRS) {
            const val = img.getAttribute(attr);
            if (val && !val.startsWith("data:")) {
                img.src = val;
                img.removeAttribute(attr);
                break;
            }
        }
    });
}

/** 相对 URL 转绝对 URL */
function absolutifyUrls(root: Element, baseUrl: string): void {
    try {
        const base = new URL(baseUrl);
        root.querySelectorAll("a[href]").forEach(a => {
            try { (a as HTMLAnchorElement).href = new URL(a.getAttribute("href")!, base).href; } catch (_e) { /* invalid href, skip */ }
        });
        root.querySelectorAll("img[src]").forEach(img => {
            try {
                const src = img.getAttribute("src")!;
                if (!src.startsWith("data:")) {
                    img.setAttribute("src", new URL(src, base).href);
                }
            } catch (_e) { /* invalid src, skip */ }
        });
    } catch (e) { logger.warn('[ArticleSaver] absolutifyUrls failed for baseUrl:', baseUrl, e); }
}

// ─── Markdown 后处理 ──────────────────────────────────────────────────────────

function postProcessMarkdown(md: string): string {
    return md
        // 移除残留 HTML 标签（<div class="..."> 等）
        .replace(/<[a-zA-Z][^>]*>/g, "")
        .replace(/<\/[a-zA-Z]+>/g, "")
        // 解码常见 HTML 实体（Turndown 通常已处理，保留作为兜底）
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
        // Markdown 链接内换行修复
        .replace(/\[([^\]]*)\n([^\]]*)\]/g, (_, a, b) => `[${a} ${b}]`)
        // 折叠 3 个以上连续空行 → 最多 2 个
        .replace(/\n{3,}/g, "\n\n")
        // 移除行尾空格
        .replace(/ +$/gm, "")
        // 头尾空白
        .trim();
}

// ─── 文件名安全化 ─────────────────────────────────────────────────────────────

/**
 * 生成文件名安全的字符串：
 * - 移除 Windows/macOS 保留字符：< > : " / \ | ? *
 * - 空格 → 连字符
 * - 限制最长 80 字符
 * - 全小写（便于排序和跨平台）
 */
export function safeFilename(title: string, maxLen = 80): string {
    return title
        .replace(/[<>:"\/\\|?*\x00-\x1f]/g, "")    // 移除保留字符
        .replace(/\s+/g, "-")                        // 空格 → -
        .replace(/-+/g, "-")                         // 合并连续 -
        .replace(/^-+|-+$/g, "")                     // 去首尾 -
        .slice(0, maxLen)
        .toLowerCase() || "article";
}

// ─── 元数据提取 ───────────────────────────────────────────────────────────────

/**
 * 从 HTML 字符串提取文章元数据
 * 优先级：Open Graph > Twitter Card > Schema.org > HTML meta > DOM 启发式
 */
export function extractMeta(html: string, sourceUrl?: string): ArticleMeta {
    if (!html) return { title: "", sourceUrl };

    const doc = new DOMParser().parseFromString(html, "text/html");

    // 尝试用 Readability 提取作者、发布日期（比 meta 标签更准确）
    let readabilityMeta: { byline?: string | null; excerpt?: string | null } = {};
    try {
        const reader = new Readability(doc.cloneNode(true) as Document);
        const article = reader.parse();
        if (article) {
            readabilityMeta = { byline: article.byline, excerpt: article.excerpt };
        }
    } catch (e) { logger.warn('[ArticleSaver] Readability metadata extraction failed:', e); }

    const get = (sel: string, attr?: string): string => {
        const el = doc.querySelector(sel);
        if (!el) return "";
        return attr ? (el.getAttribute(attr) || "") : (el.textContent || "");
    };

    // 标题（优先级从高到低）
    const title =
        get("meta[property='og:title']", "content") ||
        get("meta[name='twitter:title']", "content") ||
        doc.title ||
        get("h1") ||
        "";

    // 作者（Readability byline 最准确）
    const author =
        readabilityMeta.byline?.trim() ||
        get("meta[name='author']", "content") ||
        get("meta[property='article:author']", "content") ||
        get("[rel='author']") ||
        get(".author") ||
        get(".byline") ||
        get("[itemprop='author']") ||
        "";

    // 发布日期
    const publishDate =
        get("meta[property='article:published_time']", "content") ||
        get("meta[name='date']", "content") ||
        get("time[datetime]", "datetime") ||
        get("[itemprop='datePublished']", "content") ||
        "";

    // 描述（Readability excerpt 通常比 meta description 更精准）
    const description =
        get("meta[property='og:description']", "content") ||
        get("meta[name='description']", "content") ||
        get("meta[name='twitter:description']", "content") ||
        readabilityMeta.excerpt?.trim() ||
        "";

    // 封面图
    const coverImage =
        get("meta[property='og:image']", "content") ||
        get("meta[name='twitter:image']", "content") ||
        get("meta[name='twitter:image:src']", "content") ||
        (() => {
            const imgs = doc.querySelectorAll("img[src]");
            for (const img of imgs) {
                const src = img.getAttribute("src") || "";
                const w = parseInt(img.getAttribute("width") || "999");
                const h = parseInt(img.getAttribute("height") || "999");
                if (!src.startsWith("data:") && w > 1 && h > 1) {
                    return src;
                }
            }
            return "";
        })();

    return {
        title: title.trim(),
        author: author.trim(),
        publishDate: normalizeDate(publishDate),
        description: description.trim(),
        coverImage: coverImage.trim(),
        sourceUrl,
    };
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

async function ensureFolder(app: App, folderPath: string): Promise<void> {
    const parts = folderPath.split("/");
    let current = "";
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!app.vault.getAbstractFileByPath(current)) {
            try {
                await app.vault.createFolder(current);
            } catch (_e) { /* folder already exists */ }
        }
    }
}

function normalizeDate(raw: string): string {
    if (!raw) return "";
    try {
        const d = new Date(raw);
        if (isNaN(d.getTime())) return raw;
        return d.toISOString().slice(0, 10);
    } catch (e) {
        logger.warn('[ArticleSaver] normalizeDate failed for:', raw, e);
        return raw;
    }
}
