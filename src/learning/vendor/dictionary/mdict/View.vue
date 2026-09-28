<template>
    <div v-if="!word"></div>
    <div class="mdict-view" v-else-if="result.html">
        <!-- Plain text mode -->
        <pre v-if="result.isPlainText" class="mdict-plain">{{ result.html }}</pre>
        <!-- HTML mode: rendered in an isolated container -->
        <div v-else ref="htmlContainer" class="mdict-html"></div>
    </div>
    <div v-else-if="!loaded" class="mdict-loading">
        <span class="mdict-loading-text">正在加载词典...</span>
    </div>
    <div v-else-if="loadError" class="mdict-load-error" :title="loadError">⚠ 词典加载失败</div>
    <div v-else class="mdict-no-result">未找到释义</div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { getMdictEngine } from './engine';
import { useLoading } from '@dict/uses';
import type LanguageLearner from '@/plugin';

// ─── props & emits ──────────────────────────────────────────────────────────

const props = defineProps<{
    word: string;
    /** The mdict dict id, e.g. "mdict_0" — passed via the dicts registry */
    dictId: string;
}>();

const emits = defineEmits<{
    (event: 'loading', status: { id: string; loading: boolean; result: boolean }): void;
}>();

// ─── state ──────────────────────────────────────────────────────────────────

const result = ref({ html: '', isPlainText: false });
const loaded = ref(false);
const loadError = ref<string | null>(null);
const htmlContainer = ref<HTMLElement | null>(null);
// A per-view selector keeps dictionary CSS and duplicate entry IDs local to this result.
const mdictScopeId = `qre-mdict-${Math.random().toString(36).slice(2)}`;

// ─── search ─────────────────────────────────────────────────────────────────

async function onSearch(): Promise<boolean> {
    const query = props.word;
    loaded.value = false;
    loadError.value = null;
    result.value = { html: '', isPlainText: false };
    if (!query.trim()) {
        loaded.value = true;
        return false;
    }

    const engine = getMdictEngine(props.dictId);
    if (!engine) {
        loaded.value = true;
        loadError.value = '词典引擎未就绪';
        return false;
    }

    const res = await engine.search(query);
    if (query !== props.word) return false;
    loaded.value = true;
    loadError.value = engine.loadError;

    if (!res?.result) return false;

    result.value = res.result;

    // Render HTML into the container (after DOM update)
    if (!res.result.isPlainText) {
        await nextTick();
        renderHtml(res.result.html);
    }
    return true;
}

useLoading(() => props.word, props.dictId, onSearch, emits, true);

// ─── HTML rendering ──────────────────────────────────────────────────────────

/** Dictionary content is untrusted even when the MDX was selected locally. */
const allowedTags = new Set([
    'a', 'abbr', 'article', 'b', 'big', 'blockquote', 'br', 'center', 'code',
    'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure',
    'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img',
    'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'rp', 'rt', 'ruby', 's',
    'samp', 'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup',
    'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'var'
]);
const forbiddenTags = new Set([
    'base', 'button', 'canvas', 'embed', 'form', 'iframe', 'input', 'link',
    'math', 'meta', 'object', 'option', 'script', 'select', 'source', 'svg',
    'template', 'textarea', 'video'
]);
function mddResourceUrl(path: string, engine: any, kind: 'image' | 'font'): string | null {
    if (/^data:/i.test(path)) {
        const mime = path.match(/^data:(image\/(?:png|jpe?g|gif|webp|svg\+xml)|font\/(?:woff2?|ttf|otf|opentype));base64,[A-Za-z0-9+/]*={0,2}$/i)?.[1];
        return mime && (kind === 'image' ? mime.startsWith('image/') : mime.startsWith('font/')) ? path : null;
    }
    if (/^[a-z][\w+.-]*:/i.test(path) || path.startsWith('//') || !engine?.hasMdd()) return null;
    const clean = path.split(/[?#]/, 1)[0].replace(/^[./\\]+/, '');
    if (!clean) return null;
    const ext = clean.split('.').pop()?.toLowerCase() || '';
    const mime = kind === 'image'
        ? ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' } as Record<string, string>)[ext]
        : ({ woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/opentype' } as Record<string, string>)[ext];
    if (!mime) return null;
    const buf = engine.lookupResource('\\' + clean);
    return buf ? `data:${mime};base64,${buf.toString('base64')}` : null;
}

function splitCssList(input: string): string[] {
    const result: string[] = [];
    let start = 0, depth = 0, quote = '';
    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        if (quote) {
            if (char === '\\') i++;
            else if (char === quote) quote = '';
        } else if (char === '"' || char === "'") quote = char;
        else if (char === '(' || char === '[') depth++;
        else if (char === ')' || char === ']') depth--;
        else if (char === ',' && depth === 0) {
            result.push(input.slice(start, i).trim());
            start = i + 1;
        }
    }
    result.push(input.slice(start).trim());
    return result;
}

function safeDeclarations(style: CSSStyleDeclaration, engine: any, fontNames: Map<string, string>): string {
    const declarations: string[] = [];
    for (let i = 0; i < style.length; i++) {
        const name = style.item(i).toLowerCase();
        let value = style.getPropertyValue(name);
        if (!name || /^(?:behavior|-moz-binding|filter|backdrop-filter|z-index|pointer-events)$/i.test(name)) continue;
        if (name === 'position' && /^(?:fixed|sticky|absolute)$/i.test(value.trim())) continue;
        if (/(?:expression|image-set)\s*\(/i.test(value)) continue;
        if (/url\s*\(/i.test(value)) {
            let valid = true;
            let replaced = 0;
            const urls = value.match(/url\s*\(/gi)?.length || 0;
            value = value.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_match, _quote, path: string) => {
                replaced++;
                const resolved = mddResourceUrl(path.trim(), engine, 'image');
                if (!resolved) valid = false;
                return resolved ? `url("${resolved}")` : '';
            });
            if (!valid || replaced !== urls) continue;
        }
        if (name === 'font-family') {
            value = splitCssList(value).map(family => {
                const original = family.replace(/^['"]|['"]$/g, '').toLowerCase();
                return fontNames.has(original) ? `"${fontNames.get(original)}"` : family;
            }).join(', ');
        }
        declarations.push(`${name}:${value}${style.getPropertyPriority(name) ? ' !important' : ''}`);
    }
    return declarations.join(';');
}

/** Parse with the browser CSS parser, then emit only scoped, supported rules. */
function sanitizeCss(css: string, engine: any, ids: Map<string, string>): string {
    if (typeof CSSStyleSheet === 'undefined') return ''; // old WebKit: fail closed, definitions still render
    let rules: CSSRuleList;
    try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        rules = sheet.cssRules;
    } catch { return ''; }
    const fontNames = new Map<string, string>();
    let fontIndex = 0;
    const collectFonts = (list: CSSRuleList): void => {
        for (const rule of Array.from(list)) {
            if (rule.type === 5) {
                const family = (rule as CSSFontFaceRule).style.getPropertyValue('font-family').replace(/^['"]|['"]$/g, '').toLowerCase();
                if (family && !fontNames.has(family)) fontNames.set(family, `${mdictScopeId}-font-${fontIndex++}`);
            } else if (rule.type === 4 || rule.type === 12) collectFonts((rule as CSSGroupingRule).cssRules);
        }
    };
    collectFonts(rules);
    const scope = `#${mdictScopeId}`;
    const emit = (list: CSSRuleList): string => Array.from(list).map(rule => {
        if (rule.type === 1) {
            const cssRule = rule as CSSStyleRule;
            const declarations = safeDeclarations(cssRule.style, engine, fontNames);
            if (!declarations) return '';
            const selectors = splitCssList(cssRule.selectorText).map(selector => {
                selector = selector.replace(/#([A-Za-z_][\w-]*)/g, (match, id: string) => ids.has(id) ? `#${ids.get(id)}` : match);
                const rooted = selector.match(/^(?:(?:html|body|:root)\s*)+(.*)$/i);
                if (rooted) selector = rooted[1];
                return selector ? `${scope} :is(${selector})` : scope;
            }).join(',');
            return `${selectors}{${declarations}}`;
        }
        if (rule.type === 4 || rule.type === 12) {
            const group = rule as CSSMediaRule | CSSSupportsRule;
            const nested = emit(group.cssRules);
            return nested ? `@${rule.type === 4 ? 'media' : 'supports'} ${group.conditionText}{${nested}}` : '';
        }
        if (rule.type === 5) {
            const face = (rule as CSSFontFaceRule).style;
            const original = face.getPropertyValue('font-family').replace(/^['"]|['"]$/g, '').toLowerCase();
            const alias = fontNames.get(original);
            const src = face.getPropertyValue('src');
            const url = src.match(/url\(\s*(['"]?)(.*?)\1\s*\)/i)?.[2];
            const data = url && mddResourceUrl(url.trim(), engine, 'font');
            if (!alias || !data) return '';
            const weight = face.getPropertyValue('font-weight');
            const fontStyle = face.getPropertyValue('font-style');
            return `@font-face{font-family:"${alias}";src:url("${data}")${/^(?:normal|bold|[1-9]00)$/i.test(weight) ? `;font-weight:${weight}` : ''}${/^(?:normal|italic|oblique)$/i.test(fontStyle) ? `;font-style:${fontStyle}` : ''}}`;
        }
        return ''; // @import, @namespace, @keyframes and all unknown global at-rules
    }).join('');
    return emit(rules);
}

function sanitizeDictionaryMarkup(doc: Document, engine: any): Map<string, string> {
    const ids = new Map<string, string>();
    let nextId = 0;
    doc.body.querySelectorAll('[id]').forEach(el => {
        const oldId = el.id;
        if (!ids.has(oldId)) ids.set(oldId, `${mdictScopeId}-id-${nextId++}`);
        el.setAttribute('data-mdict-original-id', oldId);
        el.id = ids.get(oldId)!;
    });
    const clean = (node: Node): void => {
        if (node.nodeType !== 1) return;
        const el = node as HTMLElement;
        const tag = el.localName.toLowerCase();
        if (forbiddenTags.has(tag)) { el.remove(); return; }
        Array.from(el.childNodes).forEach(clean);
        if (!allowedTags.has(tag)) { el.replaceWith(...Array.from(el.childNodes)); return; }
        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            const common = ['class', 'id', 'lang', 'dir', 'title', 'style', 'data-mdict-original-id'].includes(name);
            const tagSpecific = (tag === 'a' && name === 'href')
                || (tag === 'img' && ['src', 'alt', 'width', 'height'].includes(name))
                || (['td', 'th'].includes(tag) && ['colspan', 'rowspan'].includes(name))
                || (tag === 'font' && ['color', 'face', 'size'].includes(name))
                || (tag === 'ol' && ['start', 'type'].includes(name));
            if (!common && !tagSpecific) el.removeAttribute(attr.name);
        }
        if (el.hasAttribute('style')) {
            const safe = safeDeclarations(el.style, engine, new Map());
            if (safe) el.setAttribute('style', safe);
            else el.removeAttribute('style');
        }
        if (tag === 'a') {
            const href = el.getAttribute('href') || '';
            if (/^(?:entry|sound):\/\//i.test(href)) return;
            if (href.startsWith('#')) {
                const target = ids.get(href.slice(1));
                if (target) el.setAttribute('href', `#${target}`);
                else el.removeAttribute('href');
            } else if (/^https?:\/\//i.test(href)) {
                el.setAttribute('target', '_blank');
                el.setAttribute('rel', 'noopener noreferrer');
            } else el.removeAttribute('href');
        }
        if (tag === 'img' && !mddResourceUrl(el.getAttribute('src') || '', engine, 'image')) el.remove();
    };
    Array.from(doc.body.childNodes).forEach(clean);
    return ids;
}

function renderHtml(html: string): void {
    if (!htmlContainer.value) return;

    const container = htmlContainer.value;
    container.replaceChildren();
    container.id = mdictScopeId;

    // Pre-process: convert <br> sequences to proper block structure
    const processed = html;

    // Get engine early — needed for MDD resource resolution throughout
    const engine = getMdictEngine(props.dictId);

    // Parse the HTML fragment
    const parser = new DOMParser();
    const doc = parser.parseFromString(
        `<html><body>${processed}</body></html>`,
        'text/html'
    );

    // Strip inline styles that conflict with Obsidian theme, keep semantic ones
    doc.querySelectorAll('[style]').forEach(el => {
        const htmlEl = el as HTMLElement;
        const style = htmlEl.getAttribute('style') || '';

        // Remove hard-coded font-size on body-level elements (we control sizing via CSS)
        // Keep color hints — we'll override selectively via CSS
        // Remove font-face declarations that won't load
        if (style.includes('font-size:150%')) {
            htmlEl.classList.add('mdict-headword');
            htmlEl.removeAttribute('style');
        }
    });

    // Transform old <FONT> elements into styled spans
    doc.querySelectorAll('font, FONT').forEach(font => {
        const htmlFont = font as HTMLElement;
        const color = htmlFont.getAttribute('color')?.toLowerCase() || '';
        const face = htmlFont.getAttribute('face') || '';

        // Phonetic transcription (Kingsoft Phonetic font)
        if (face.toLowerCase().includes('phonetic')) {
            htmlFont.classList.add('mdict-phonetic');
        }
        // Chinese translation (orange #FF5000)
        else if (color === '#ff5000') {
            htmlFont.classList.add('mdict-translation');
        }
        // Example sentences (blue #0044FF)
        else if (color === '#0044ff') {
            htmlFont.classList.add('mdict-example');
        }
        // Example translations (dark blue, smaller)
        else if (color === '#039' || color.includes('039') || (htmlFont.getAttribute('style') || '').includes('color=#039')) {
            htmlFont.classList.add('mdict-example-trans');
        }
        // Part of speech marker (red ◙)
        else if (color === 'red') {
            htmlFont.classList.add('mdict-pos-marker');
        }
    });

    // Handle elements with style="color=#039" (non-standard but used in this dict)
    doc.querySelectorAll('[style*="color=#039"]').forEach(el => {
        (el as HTMLElement).classList.add('mdict-example-trans');
    });

    // Style part-of-speech labels
    doc.querySelectorAll('b[style*="darkred"]').forEach(el => {
        (el as HTMLElement).classList.add('mdict-pos');
    });

    // Style blue headword-like bold entries (idioms, phrases)
    doc.querySelectorAll('b[style*="color:blue"]').forEach(el => {
        const htmlEl = el as HTMLElement;
        if (!htmlEl.classList.contains('mdict-headword')) {
            htmlEl.classList.add('mdict-phrase');
        }
    });

    // Style grammar labels (darkgreen italic)
    doc.querySelectorAll('i[style*="darkgreen"]').forEach(el => {
        (el as HTMLElement).classList.add('mdict-grammar');
    });

    // Style section headers (IDIOMS, 语源, etc.)
    doc.querySelectorAll('div[style*="font-weight:bold"]').forEach(el => {
        (el as HTMLElement).classList.add('mdict-section-header');
    });

    // Improve <hr> appearance
    doc.querySelectorAll('hr').forEach(hr => {
        hr.removeAttribute('color');
        hr.removeAttribute('noshade');
        (hr as HTMLElement).classList.add('mdict-hr');
    });

    // Resolve images only from MDD or embedded image data. External URLs would
    // otherwise make a network request as soon as a local dictionary is opened.
    doc.querySelectorAll('img[src]').forEach(img => {
        const src = img.getAttribute('src') || '';
        const resolved = mddResourceUrl(src, engine, 'image');
        if (resolved) img.setAttribute('src', resolved);
        else img.remove();
    });

    // Resolve CSS from MDD (link[rel="stylesheet"])
    if (engine?.hasMdd()) {
        doc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
            const href = link.getAttribute('href') || '';
            if (href && !href.startsWith('http')) {
                const key = '\\' + href.replace(/^[./\\]+/, '');
                const buf = engine.lookupResource(key);
                if (buf) {
                    const style = doc.createElement('style');
                    style.textContent = buf.toString('utf8');
                    link.replaceWith(style);
                    return;
                }
            }
            link.remove();
        });
    }

    // Inject standalone CSS (dict.css) if available
    const standaloneCss = engine?.getStandaloneCss();
    if (standaloneCss) {
        const style = doc.createElement('style');
        style.textContent = standaloneCss;
        doc.body.prepend(style);
    }

    // Remove remaining unresolved stylesheet links (no MDD available)
    if (!engine?.hasMdd()) {
        doc.querySelectorAll('link[rel="stylesheet"]').forEach(el => el.remove());
    }

    // Collect all dictionary styles (including rules parsed into <head>) before
    // stripping markup. Only the scoped CSS generated below enters the live DOM.
    const dictionaryCss = Array.from(doc.querySelectorAll('style')).map(style => style.textContent || '').join('\n');
    doc.querySelectorAll('style').forEach(style => style.remove());
    const ids = sanitizeDictionaryMarkup(doc, engine);
    const safeCss = sanitizeCss(dictionaryCss, engine, ids);
    if (safeCss) {
        const style = document.createElement('style');
        style.textContent = safeCss;
        container.appendChild(style);
    }

    // Handle sound:// links — convert to clickable audio players
    doc.querySelectorAll('a[href^="sound://"]').forEach(a => {
        const soundFile = (a.getAttribute('href') || '').replace('sound://', '');
        a.setAttribute('href', '#');
        a.setAttribute('data-sound', soundFile);
        (a as HTMLElement).classList.add('mdict-sound-btn');
    });

    // Handle entry:// links
    doc.querySelectorAll('a[href^="entry://"]').forEach(a => {
        const word = (a.getAttribute('href') || '').replace('entry://', '');
        a.setAttribute('href', '#');
        a.setAttribute('data-entry', word);
        (a as HTMLElement).classList.add('mdict-entry-link');
    });

    // Append all body children into our container
    const bodyChildren = Array.from(doc.body.childNodes);
    bodyChildren.forEach(child => container.appendChild(document.importNode(child, true)));

    // Attach sound click handlers (after DOM insertion)
    container.querySelectorAll('.mdict-sound-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const soundFile = (btn as HTMLElement).getAttribute('data-sound');
            if (soundFile) playMddSound(soundFile);
        });
    });

    // Attach entry link click handlers
    container.querySelectorAll('.mdict-entry-link').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const entry = (btn as HTMLElement).getAttribute('data-entry');
            if (entry) {
                window.dispatchEvent(new CustomEvent('qiaomu-english-event-search', {
                    detail: { selection: entry }
                }));
            }
        });
    });

    // Keep a dictionary's in-entry anchors from changing the Obsidian window URL.
    container.querySelectorAll(`a[href^="#${mdictScopeId}-id-"]`).forEach(link => {
        link.addEventListener('click', event => {
            event.preventDefault();
            const target = container.querySelector((link as HTMLAnchorElement).getAttribute('href') || '');
            target?.scrollIntoView({ block: 'nearest' });
        });
    });

    // Collapsible sections: OALDPE uses <div class="collapse"> with <span class="unbox">
    // Other dicts may use similar patterns. Make them toggle on click.
    container.querySelectorAll('.collapse').forEach(collapseDiv => {
        const div = collapseDiv as HTMLElement;
        // Find the clickable title (.box_title or first .unbox child)
        const titleEl = div.querySelector('.box_title') as HTMLElement | null;
        const unboxEl = div.querySelector('.unbox') as HTMLElement | null;

        // Initially collapse the content (hide everything after the title)
        div.classList.add('mdict-collapsed');

        const clickTarget = titleEl || unboxEl;
        if (clickTarget) {
            clickTarget.style.cursor = 'pointer';
            clickTarget.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                div.classList.toggle('mdict-collapsed');
            });
        }
    });

    // Also handle generic unbox sections that are not inside .collapse
    container.querySelectorAll('.unbox[unbox]').forEach(el => {
        const unbox = el as HTMLElement;
        if (unbox.closest('.collapse')) return; // already handled above
        const body = unbox.querySelector('.body') as HTMLElement | null;
        if (!body) return;

        const titleEl = unbox.querySelector('.box_title') as HTMLElement | null;
        if (!titleEl) return;

        body.style.display = 'none';
        titleEl.style.cursor = 'pointer';
        titleEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            body.style.display = body.style.display === 'none' ? '' : 'none';
        });
    });

    // Image zoom: click on any image or nearby zoom button to show fullsize overlay
    container.querySelectorAll('img').forEach(img => {
        const imgEl = img as HTMLImageElement;
        if (imgEl.style.display === 'none') return; // skip hidden images
        const declaredWidth = Number(imgEl.getAttribute('width'));
        if (!imgEl.src || (declaredWidth > 0 && declaredWidth < 20)) return;  // skip tiny icons

        // Make images clickable for zoom
        imgEl.style.cursor = 'zoom-in';
        imgEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showImageOverlay(imgEl.src);
        });
    });

    // Also handle explicit zoom/fullsize buttons (common patterns in MDX dicts)
    container.querySelectorAll('[class*="zoom"], [class*="fullsize"], [class*="enlarge"], [class*="magnify"]').forEach(btn => {
        (btn as HTMLElement).style.cursor = 'zoom-in';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const parent = (btn as HTMLElement).closest('div, td, span') || btn.parentElement;
            const img = parent?.querySelector('img') as HTMLImageElement | null;
            if (img?.src) {
                const fullsizeSrc = img.src.replace(/thumb_/i, 'fullsize_');
                if (fullsizeSrc !== img.src && engine?.hasMdd()) {
                    const fname = fullsizeSrc.split('/').pop() || '';
                    const buf = engine.lookupResource('\\' + fname);
                    if (buf) {
                        const ext = fname.split('.').pop()?.toLowerCase() || 'png';
                        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
                        const blob = new Blob([buf], { type: mime });
                        showImageOverlay(URL.createObjectURL(blob));
                        return;
                    }
                }
                showImageOverlay(img.src);
            }
        });
    });

    // Dictionary scripts are NOT executed for security reasons.
    // MDict JS files could contain arbitrary code with full Node.js access.
    // Interactive features (collapsible sections, image zoom) are implemented
    // natively above instead.
}

/** Show a fullscreen image overlay (safe DOM construction) */
function showImageOverlay(src: string): void {
    const overlay = document.createElement('div');
    overlay.className = 'mdict-img-overlay';
    const img = document.createElement('img');
    img.src = src;
    img.className = 'mdict-img-overlay-img';
    overlay.appendChild(img);
    overlay.addEventListener('click', () => {
        overlay.remove();
        if (src.startsWith('blob:')) URL.revokeObjectURL(src);
    });
    document.body.appendChild(overlay);
}

/** Play an audio file from MDD */
function playMddSound(filename: string): void {
    const engine = getMdictEngine(props.dictId);
    if (!engine?.hasMdd()) return;

    // Try to find the audio file in MDD
    const key = '\\' + filename;
    const buf = engine.lookupResource(key);
    if (!buf) return;

    // Determine MIME type
    const ext = filename.split('.').pop()?.toLowerCase() || 'mp3';
    const mime = ext === 'wav' ? 'audio/wav'
        : ext === 'ogg' ? 'audio/ogg'
        : ext === 'spx' ? 'audio/ogg'
        : 'audio/mpeg';

    // Create blob URL and play
    const blob = new Blob([buf], { type: mime });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    audio.onerror = () => URL.revokeObjectURL(url);
    audio.play().catch(() => URL.revokeObjectURL(url));
}

// Rendering is handled in onSearch() directly after nextTick.
// No separate watcher needed — avoids double-rendering.
</script>

<style scoped>
.mdict-view {
    padding: 10px 14px 14px;
    line-height: 1.7;
}

.mdict-html {
    color: var(--text-normal);
    word-break: break-word;
    overflow-wrap: anywhere;
    position: relative;
    isolation: isolate;
    contain: paint;
}

/* ─── Headword ─────────────────────────────────────────── */
.mdict-html :deep(.mdict-headword) {
    display: block;
    font-size: 1.5em;
    font-weight: 700;
    color: var(--text-accent);
    margin-bottom: 2px;
    line-height: 1.3;
}

/* ─── Phonetic ─────────────────────────────────────────── */
.mdict-html :deep(.mdict-phonetic) {
    font-family: "Segoe UI", "Lucida Sans Unicode", "Arial Unicode MS", sans-serif;
    color: var(--text-muted);
    font-size: 0.95em;
    letter-spacing: 0.5px;
}

/* ─── Separator line ───────────────────────────────────── */
.mdict-html :deep(.mdict-hr),
.mdict-html :deep(hr) {
    border: none;
    height: 2px;
    background: linear-gradient(to right, var(--interactive-accent), transparent);
    margin: 8px 0 10px;
    opacity: 0.6;
}

/* ─── Part of speech ───────────────────────────────────── */
.mdict-html :deep(.mdict-pos-marker) {
    color: var(--text-error, #e74c3c) !important;
    font-size: 0.85em;
}

.mdict-html :deep(.mdict-pos) {
    color: var(--text-error, #c0392b) !important;
    font-weight: 700;
    font-size: 0.95em;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

/* ─── Grammar labels ───────────────────────────────────── */
.mdict-html :deep(.mdict-grammar) {
    color: var(--text-faint) !important;
    font-style: italic;
    font-size: 0.9em;
}

/* ─── Chinese translation ──────────────────────────────── */
.mdict-html :deep(.mdict-translation) {
    color: var(--text-accent) !important;
    font-weight: 500;
}

/* ─── Example sentences ────────────────────────────────── */
.mdict-html :deep(.mdict-example) {
    color: var(--text-muted) !important;
    font-style: italic;
    padding-left: 4px;
}

.mdict-html :deep(.mdict-example-trans) {
    color: var(--text-faint) !important;
    font-size: 0.9em;
    padding-left: 8px;
}

/* ─── Phrases / Idiom headwords ────────────────────────── */
.mdict-html :deep(.mdict-phrase) {
    color: var(--text-accent) !important;
    font-weight: 600;
}

/* ─── Section headers (IDIOMS, 语源) ──────────────────── */
.mdict-html :deep(.mdict-section-header) {
    color: var(--text-error, #e74c3c) !important;
    font-weight: 700;
    font-size: 0.95em;
    margin-top: 12px;
    margin-bottom: 4px;
    padding: 4px 8px;
    background: var(--background-secondary-alt, var(--background-modifier-hover));
    border-radius: 4px;
    border-left: 3px solid var(--text-error, #e74c3c);
}

/* ─── Links ────────────────────────────────────────────── */
.mdict-html :deep(a) {
    color: var(--text-accent);
    text-decoration: none;
    cursor: pointer;
    border-bottom: 1px dotted var(--text-accent);
    transition: opacity 0.15s;
}
.mdict-html :deep(a:hover) {
    opacity: 0.7;
    text-decoration: none;
}

.mdict-html :deep(.mdict-entry-link) {
    font-weight: 600;
}

/* ─── Definition numbers ───────────────────────────────── */
.mdict-html :deep(b) {
    color: var(--text-normal);
}

/* ─── Tables ───────────────────────────────────────────── */
.mdict-html :deep(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 6px 0;
}
.mdict-html :deep(td),
.mdict-html :deep(th) {
    padding: 4px 8px;
    border: 1px solid var(--background-modifier-border);
}

/* ─── Reduce excessive <br> spacing ────────────────────── */
.mdict-html :deep(br + br) {
    display: none;
}

/* ─── Force single-column layout for narrow sidebar ────── */
.mdict-html :deep(.definition-columns),
.mdict-html :deep(.content-wrapper),
.mdict-html :deep(.centeredContent),
.mdict-html :deep(.pageContent),
.mdict-html :deep([data-mdict-original-id="page"]),
.mdict-html :deep([data-mdict-original-id="pageContent"]) {
    display: block !important;
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    float: none !important;
    columns: unset !important;
    column-count: unset !important;
}

.mdict-html :deep(.col-1),
.mdict-html :deep(.col-2),
.mdict-html :deep(.col-3) {
    display: block !important;
    width: 100% !important;
    max-width: 100% !important;
    float: none !important;
    position: relative !important;
}

/* Hide ad placeholders, subscription boxes etc. */
.mdict-html :deep(.box-ads-bowl-subscription),
.mdict-html :deep(.ads),
.mdict-html :deep([class*="ad-"]),
.mdict-html :deep([class*="subscription"]) {
    display: none !important;
}

/* Force all containers to respect panel width */
.mdict-html :deep(div),
.mdict-html :deep(span),
.mdict-html :deep(section) {
    max-width: 100% !important;
    box-sizing: border-box !important;
}

/* Reset any fixed/absolute positioning from dict CSS */
.mdict-html :deep([style*="position: fixed"]),
.mdict-html :deep([style*="position: absolute"]),
.mdict-html :deep([style*="position:fixed"]),
.mdict-html :deep([style*="position:absolute"]) {
    position: relative !important;
}

/* Ensure overflow doesn't create horizontal scroll */
.mdict-html {
    overflow-x: hidden !important;
}

/* ─── General font overrides ───────────────────────────── */
.mdict-html :deep(font),
.mdict-html :deep(FONT) {
    font-family: inherit;
}

/* ─── Plain text mode ──────────────────────────────────── */
.mdict-plain {
    font-family: var(--font-text);
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-normal);
    margin: 0;
}

/* ─── Status messages ──────────────────────────────────── */
.mdict-loading {
    padding: 12px;
    text-align: center;
}
.mdict-loading-text {
    color: var(--text-muted);
    font-size: 0.9em;
}

.mdict-no-result {
    padding: 12px;
    color: var(--text-faint);
    text-align: center;
    font-size: 0.9em;
}

.mdict-load-error {
    padding: 12px;
    color: var(--text-error, #e74c3c);
    text-align: center;
    font-size: 0.9em;
    cursor: help;
}

/* ─── Collapsible sections ─────────────────────────────── */
.mdict-html :deep(.collapse) {
    margin: 6px 0;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    padding: 6px 10px;
    background: var(--background-secondary);
}

.mdict-html :deep(.collapse .box_title),
.mdict-html :deep(.unbox[unbox] .box_title) {
    cursor: pointer;
    font-weight: 600;
    color: var(--text-accent);
    user-select: none;
}

.mdict-html :deep(.collapse .box_title)::before,
.mdict-html :deep(.unbox[unbox] .box_title)::before {
    content: '⊕ ';
    font-size: 0.85em;
}

.mdict-html :deep(.collapse:not(.mdict-collapsed) .box_title)::before {
    content: '⊖ ';
}

.mdict-html :deep(.mdict-collapsed .body),
.mdict-html :deep(.mdict-collapsed .examples),
.mdict-html :deep(.mdict-collapsed .collocs_list),
.mdict-html :deep(.mdict-collapsed .p),
.mdict-html :deep(.mdict-collapsed ul),
.mdict-html :deep(.mdict-collapsed .unbox:not(:first-child)) {
    display: none !important;
}

/* ─── Sound buttons ───────────────────────────────────── */
.mdict-html :deep(.mdict-sound-btn) {
    cursor: pointer;
    border-bottom: none !important;
}
.mdict-html :deep(.mdict-sound-btn:hover) {
    opacity: 0.7;
}

/* ─── Images ──────────────────────────────────────────── */
.mdict-html :deep(img) {
    max-width: 100%;
    height: auto;
    border-radius: 4px;
}
</style>

<!-- Image overlay must be unscoped to work when appended to document.body -->
<style>
.mdict-img-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    cursor: zoom-out;
    backdrop-filter: blur(4px);
}
.mdict-img-overlay-img {
    max-width: 90vw;
    max-height: 90vh;
    object-fit: contain;
    border-radius: 8px;
    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.5);
}
</style>
