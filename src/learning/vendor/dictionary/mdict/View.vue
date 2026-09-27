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

/**
 * Inject the MDict HTML into the container element.
 *
 * MDict HTML often uses old-style <FONT> tags and inline styles.
 * We transform these into semantic elements with CSS classes for
 * better Obsidian theme integration and cleaner rendering.
 */
/**
 * Sanitize CSS from MDD/standalone files:
 * - Resolve font url() references from MDD to data: URLs
 * - Strip @font-face rules that reference unavailable local files
 */
function sanitizeCss(css: string, engine: any): string {
    // Replace url() references with MDD data URLs where possible
    return css.replace(/@font-face\s*\{[^}]*\}/g, (fontFace) => {
        // Try to resolve font URLs from MDD
        const urlMatch = fontFace.match(/url\(['"]?([^'")\s]+)['"]?\)/);
        if (!urlMatch) return ''; // strip unresolvable @font-face

        const fontFile = urlMatch[1];
        if (fontFile.startsWith('http')) return fontFace; // keep external

        if (engine?.hasMdd()) {
            const key = '\\' + fontFile.replace(/^[./\\]+/, '');
            const buf = engine.lookupResource(key);
            if (buf) {
                const ext = fontFile.split('.').pop()?.toLowerCase() || 'ttf';
                const mime = ext === 'woff2' ? 'font/woff2'
                    : ext === 'woff' ? 'font/woff'
                    : ext === 'otf' ? 'font/opentype'
                    : 'font/ttf';
                const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
                return fontFace.replace(urlMatch[0], `url("${dataUrl}")`);
            }
        }
        // Font not in MDD — strip the @font-face to prevent ERR_FILE_NOT_FOUND
        return '';
    });
}

function renderHtml(html: string): void {
    if (!htmlContainer.value) return;

    const container = htmlContainer.value;
    container.innerHTML = '';

    // Pre-process: convert <br> sequences to proper block structure
    let processed = html;

    // Get engine early — needed for MDD resource resolution throughout
    const engine = getMdictEngine(props.dictId);

    // Parse the HTML fragment
    const parser = new DOMParser();
    const doc = parser.parseFromString(
        `<html><body>${processed}</body></html>`,
        'text/html'
    );

    // Remove all <script> tags for security — dictionary JS is not executed
    doc.querySelectorAll('script').forEach(el => el.remove());

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

    // Resolve images: try MDD resource, otherwise hide
    doc.querySelectorAll('img[src]').forEach(img => {
        const src = img.getAttribute('src') || '';
        if (src.startsWith('http://') || src.startsWith('https://')) return;

        // Try loading from MDD
        if (engine?.hasMdd()) {
            const key = '\\' + src.replace(/^[./\\]+/, '');
            const buf = engine.lookupResource(key);
            if (buf) {
                const ext = src.split('.').pop()?.toLowerCase() || 'png';
                const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                    : ext === 'gif' ? 'image/gif'
                    : ext === 'svg' ? 'image/svg+xml'
                    : 'image/png';
                img.setAttribute('src', `data:${mime};base64,${buf.toString('base64')}`);
                return;
            }
        }
        // No MDD or resource not found — hide
        (img as HTMLElement).style.display = 'none';
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
                    style.textContent = sanitizeCss(buf.toString('utf8'), engine);
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
        style.textContent = sanitizeCss(standaloneCss, engine);
        doc.body.prepend(style);
    }

    // Remove remaining unresolved stylesheet links (no MDD available)
    if (!engine?.hasMdd()) {
        doc.querySelectorAll('link[rel="stylesheet"]').forEach(el => el.remove());
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
        if (!imgEl.src || imgEl.width < 20) return;  // skip tiny icons

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
.mdict-html :deep(#page),
.mdict-html :deep(#pageContent) {
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
