<template>
    <div
        v-if="visible"
        class="langr-subtitle-popup"
        ref="popupEl"
        :style="{ left: x + 'px', top: y + 'px' }"
        @click.stop
        @mouseenter="onPopupEnter"
        @mouseleave="onPopupLeave"
    >
        <!-- Meanings (max 3) + buttons, all vertically stacked -->
        <div class="stp-body">
            <div class="stp-meaning" v-for="(m, i) in meanings.slice(0, 3)" :key="i">{{ m }}</div>
            <div class="stp-meaning stp-loading" v-if="loading && meanings.length === 0">...</div>
            <div class="stp-meaning" v-if="!loading && meanings.length === 0">{{ lookupFailed ? t('Definition service unavailable') : t('No definition found') }}</div>
            <!-- Action buttons: 🔊 ✓ 📖, side by side, inline style to avoid CSS conflicts -->
            <div class="stp-actions">
                <button
                    class="stp-btn-speak"
                    style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;border:none;cursor:pointer;padding:0;box-sizing:border-box;"
                    @click="speakWord"
                >
                    <svg viewBox="0 0 24 24" style="width:16px;height:16px;flex-shrink:0;"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3z"/><path fill="currentColor" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
                    <span class="qiaomu-reader-sr-only">{{ t('Pronounce') }}</span>
                </button>
                <button
                    class="stp-btn-known"
                    :class="{ 'stp-btn-active': currentStatus === 3 }"
                    style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;border:none;cursor:pointer;padding:0;box-sizing:border-box;"
                    @click="markKnown"
                    :aria-pressed="currentStatus === 3"
                >
                    <svg viewBox="0 0 24 24" style="width:16px;height:16px;flex-shrink:0;"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                    <span class="qiaomu-reader-sr-only">{{ currentStatus === 3 ? t('Mark as ignored') : t('Mark as known') }}</span>
                </button>
                <button
                    class="stp-btn-learn"
                    :class="{ 'stp-btn-active': currentStatus === 1 }"
                    style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;border:none;cursor:pointer;padding:0;box-sizing:border-box;"
                    @click="markLearning"
                    :aria-pressed="currentStatus === 1"
                >
                    <svg viewBox="0 0 24 24" style="width:16px;height:16px;flex-shrink:0;"><path fill="currentColor" d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>
                    <span class="qiaomu-reader-sr-only">{{ t('Mark as learning') }}</span>
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, getCurrentInstance, onMounted, onUnmounted } from 'vue';
import { requestUrl, Notice } from 'obsidian';
import type PluginType from '@/plugin';
import { playAudio } from '@/utils/helpers';
import { logger } from '@/utils/logger';
import { t } from '@/lang/helper';
import { REVIEW_INTEGRITY_ERROR_CODE } from '@/utils/reviewDb';
import { fetchEnglishDefinitions } from './english-definition';
import type { Sentence } from '@/db/interface';
import { normalizeReaderLink } from '@/utils/readerLink';

const instance = getCurrentInstance();
if (!instance) throw new Error('SubtitlePopup: Vue instance not available');
const plugin = instance.appContext.config.globalProperties.plugin as PluginType;
const props = defineProps<{ hostDocument?: Document }>();
const eventDocument = props.hostDocument || document;
const eventWindow = eventDocument.defaultView || window;

function showStatusSaveFailure(error: unknown, fallback: string) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    new Notice(code === REVIEW_INTEGRITY_ERROR_CODE
        ? t('Review status blocked invalid managed section')
        : fallback);
}

// ── LRU Cache for word lookups ──
class WordCache {
    // Only remote definitions are cached. Vocabulary status and user-edited
    // meanings always come from the authoritative database on each hover.
    private cache = new Map<string, string[]>();
    private maxSize: number;
    constructor(maxSize = 200) { this.maxSize = maxSize; }
    get(key: string) {
        const v = this.cache.get(key);
        if (v) { // Move to end (most recent)
            this.cache.delete(key);
            this.cache.set(key, v);
        }
        return v;
    }
    set(key: string, value: string[]) {
        if (this.cache.size >= this.maxSize) {
            // Delete oldest (first entry)
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) this.cache.delete(oldest);
        }
        this.cache.set(key, value);
    }
    /** Invalidate a specific word (e.g. after status change) */
    invalidate(key: string) { this.cache.delete(key); }
    /** Clear all entries (e.g. when language setting changes) */
    clear() { this.cache.clear(); }
}
const wordCache = new WordCache(200);
/** Track the lang+provider the cache was built with */
let cachedLangKey = '';

const visible = ref(false);
const x = ref(0);
const y = ref(0);
const word = ref('');
const sentenceEn = ref('');
const sentenceZh = ref('');
const bookTitle = ref('');
const readerLink = ref('');
const meanings = ref<string[]>([]);
const lookupFailed = ref(false);
const phrases = ref<Array<{ text: string; meaning?: string }>>([]);
const loading = ref(false);
const currentStatus = ref(-1); // -1 = not in db
const popupEl = ref<HTMLElement | null>(null);
let closeTimer: number | null = null;
// Race condition guard: incrementing ID to cancel stale lookups
let lookupRequestId = 0;
let phraseRequestId = 0;
// 保存单词位置，用于内容加载后重新定位
let wordCenterX = 0;
let wordTopY = 0;

// 鼠标进入弹窗 → 取消关闭
function onPopupEnter() {
    if (closeTimer) {
        eventWindow.clearTimeout(closeTimer);
        closeTimer = null;
    }
}

// 鼠标离开弹窗 → 延迟关闭
function onPopupLeave() {
    scheduleClose();
}

function scheduleClose(delay = 300) {
    if (closeTimer) eventWindow.clearTimeout(closeTimer);
    closeTimer = eventWindow.setTimeout(() => {
        closeTimer = null;
        close();
    }, delay);
}

// 外部调用：当鼠标移到新单词时，取消之前的关闭定时器
function cancelClose() {
    if (closeTimer) {
        eventWindow.clearTimeout(closeTimer);
        closeTimer = null;
    }
}

// 重新计算弹窗位置（紧贴单词上方）
function repositionPopup() {
    nextTick(() => {
        const el = popupEl.value;
        if (!el || !visible.value) { logger.debug('[SubtitlePopup] reposition skipped: el=', !!el, 'visible=', visible.value); return; }
        const popW = el.offsetWidth;
        const popH = el.offsetHeight;
        const viewW = eventWindow.innerWidth;

        let px = wordCenterX - popW / 2;
        let py = wordTopY - popH - 2;

        if (px < 4) px = 4;
        if (px + popW > viewW - 4) px = viewW - popW - 4;
        if (py < 4) py = wordTopY + 24; // 下方显示

        logger.debug('[SubtitlePopup] repositioned to:', px, py, 'popSize:', popW, popH);
        x.value = px;
        y.value = py;
    });
}

// 内容变化时重新定位
watch(meanings, () => { repositionPopup(); });

// Close when clicking outside
function onDocumentClick(evt: MouseEvent) {
    const target = evt.target as HTMLElement;
    if (popupEl.value && !popupEl.value.contains(target) && !target.closest('.lf-word, .lp-word')) {
        close();
    }
}

function onKeydown(evt: KeyboardEvent) {
    if (evt.key === 'Escape') close();
}

function onVocabularyRefresh(evt: CustomEvent<{ expression?: string }>) {
    const changed = evt.detail?.expression?.toLowerCase();
    if (changed) wordCache.invalidate(changed);
    else wordCache.clear();
    if (visible.value && word.value && (!changed || changed === word.value.toLowerCase())) {
        void lookupWord(word.value);
    }
}

onMounted(() => {
    logger.debug('[SubtitlePopup] mounted successfully');
    eventDocument.addEventListener('click', onDocumentClick, true);
    eventDocument.addEventListener('keydown', onKeydown);

    // 监听鼠标离开 .lf-word / .lp-word 时延迟关闭弹窗
    eventDocument.addEventListener('mouseout', onWordMouseOut, true);
    window.addEventListener('qiaomu-english-event-refresh', onVocabularyRefresh);
});

onUnmounted(() => {
    eventDocument.removeEventListener('click', onDocumentClick, true);
    eventDocument.removeEventListener('keydown', onKeydown);
    eventDocument.removeEventListener('mouseout', onWordMouseOut, true);
    window.removeEventListener('qiaomu-english-event-refresh', onVocabularyRefresh);
    if (closeTimer) eventWindow.clearTimeout(closeTimer);
});

function isHoverWord(el: HTMLElement | null): boolean {
    if (!el) return false;
    return el.classList?.contains('lf-word') || el.classList?.contains('lp-word') || el.classList?.contains('word') || el.classList?.contains('phrase');
}

function onWordMouseOut(evt: MouseEvent) {
    const target = evt.target as HTMLElement;
    if (!isHoverWord(target)) return;

    const related = evt.relatedTarget as HTMLElement;
    // 如果鼠标移到了弹窗上，不关闭
    if (related && popupEl.value?.contains(related)) return;
    // 如果鼠标移到了另一个可查词元素上，不关闭（会触发新的 show）
    if (isHoverWord(related)) return;

    scheduleClose();
}

function close() {
    lookupRequestId++;
    phraseRequestId++;
    visible.value = false;
    word.value = '';
    meanings.value = [];
    lookupFailed.value = false;
    loading.value = false;
    phrases.value = [];
    currentStatus.value = -1;
}

// ── Translation helpers (5s timeout each) ──

function withTimeout<T>(promise: Promise<T>, ms = 5000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer !== null) clearTimeout(timer);
    });
}

type RemoteMeanings = { meanings: string[]; failed: boolean };

/** Google Translate with dictionary entries */
async function fetchGoogleTranslate(w: string, tl: string): Promise<RemoteMeanings> {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${tl}&dt=t&dt=bd&dt=at&q=${encodeURIComponent(w)}`;
        const resp = await withTimeout(requestUrl({ url }));
        const data = resp.json;
        const result: string[] = [];
        if (data?.[1]) {
            for (const posGroup of data[1]) {
                const terms = posGroup[1] as string[];
                if (terms?.length) {
                    for (const t of terms) {
                        if (!result.includes(t)) result.push(t);
                        if (result.length >= 3) break;
                    }
                }
                if (result.length >= 3) break;
            }
        }
        if (result.length === 0 && data?.[0]?.length > 0) {
            const translations = data[0].map((item: any) => item[0] as string).filter(Boolean);
            result.push(...translations);
        }
        return { meanings: result.slice(0, 3), failed: false };
    } catch (e) {
        logger.warn('[SubtitlePopup] fetchGoogleTranslate failed:', e);
        return { meanings: [], failed: true };
    }
}

/** Bing Dictionary (Chinese definitions) */
async function fetchBingDict(w: string): Promise<RemoteMeanings> {
    try {
        const url = `https://cn.bing.com/dict/search?q=${encodeURIComponent(w)}&mkt=zh-cn`;
        const resp = await withTimeout(requestUrl({ url, method: 'GET' }));
        const parser = new DOMParser();
        const doc = parser.parseFromString(resp.text, 'text/html');
        const items = doc.querySelectorAll('.qdef ul > li');
        if (!items.length) return { meanings: [], failed: false };
        const defs: string[] = [];
        items.forEach(li => {
            const pos = li.querySelector('.pos')?.textContent?.trim() || '';
            const rawDef = li.querySelector('.def')?.textContent?.trim() || '';
            if (!rawDef) return;
            // Only keep first definition per part-of-speech (split by ；or ;)
            const firstDef = rawDef.split(/[；;]/)[0].trim();
            if (firstDef) defs.push(pos ? `${pos} ${firstDef}` : firstDef);
        });
        return { meanings: defs, failed: false };
    } catch (e) {
        logger.warn('[SubtitlePopup] fetchBingDict failed:', e);
        return { meanings: [], failed: true };
    }
}

/** Youdao Dictionary (Chinese definitions) */
async function fetchYoudaoDict(w: string): Promise<RemoteMeanings> {
    try {
        const url = `https://dict.youdao.com/jsonapi_s?doctype=json&jsonversion=4&le=en&q=${encodeURIComponent(w)}`;
        const resp = await withTimeout(requestUrl({ url, method: 'GET' }));
        const data = resp.json;
        const entry = Array.isArray(data?.ec?.word) ? data.ec.word[0] : data?.ec?.word;
        const ec = entry?.trs;
        if (!ec || ec.length === 0) return { meanings: [], failed: false };
        const defs: string[] = [];
        for (const tr of ec) {
            const tran = tr.tran || '';
            if (tran) defs.push(tran);
        }
        return { meanings: defs.slice(0, 3), failed: false };
    } catch (e) {
        logger.warn('[SubtitlePopup] fetchYoudaoDict failed:', e);
        return { meanings: [], failed: true };
    }
}

/** MyMemory translation */
async function fetchMyMemory(w: string, tl: string): Promise<RemoteMeanings> {
    try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(w)}&langpair=en|${tl}`;
        const resp = await withTimeout(requestUrl({ url, method: 'GET' }));
        const responseStatus = Number(resp.json?.responseStatus);
        if (Number.isFinite(responseStatus) && responseStatus !== 200) {
            return { meanings: [], failed: true };
        }
        const translated = resp.json?.responseData?.translatedText?.trim?.();
        if (!translated || translated.toLowerCase() === w.toLowerCase()) return { meanings: [], failed: false };
        return { meanings: [translated], failed: false };
    } catch (e) {
        logger.warn('[SubtitlePopup] fetchMyMemory failed:', e);
        return { meanings: [], failed: true };
    }
}

async function lookupWord(w: string) {
    const myId = ++lookupRequestId;
    loading.value = true;
    meanings.value = [];
    lookupFailed.value = false;
    currentStatus.value = -1;
    const hoverLang = (plugin.settings?.hover_definition_lang || '').trim() || 'zh';

    // 0. Invalidate cache if language/provider settings changed
    const currentLangKey = `${plugin.settings?.hover_definition_lang || 'zh'}|${plugin.settings?.hover_definition_provider || 'auto'}`;
    if (currentLangKey !== cachedLangKey) {
        wordCache.clear();
        cachedLangKey = currentLangKey;
    }

    // 1. Always read vocabulary first: sidebar edits and SR updates must be
    // reflected even when a remote dictionary definition is cached.
    try {
        const info = await plugin.db.getExpression(w);
        if (myId !== lookupRequestId) return; // stale request cancelled
        if (info && info.meaning && hoverLang !== 'en') {
            meanings.value = info.meaning.split(/[;；\n]/).map(s => s.trim()).filter(Boolean);
            currentStatus.value = info.status;
            loading.value = false;
            return;
        }
        if (info) {
            currentStatus.value = info.status;
        }
    } catch (e: any) {
        if (myId !== lookupRequestId) return; // stale request cancelled
        // Differentiate between "not found" and actual database errors
        const isNotFound = e?.message?.includes('not found') || e?.message?.includes('No record') || e?.name === 'NotFoundError';
        if (isNotFound) {
            // Word not in database — expected, continue to API lookup
        } else {
            logger.warn('[SubtitlePopup] DB query error for word:', w, e);
        }
    }

    const cached = wordCache.get(w.toLowerCase());
    if (cached) {
        meanings.value = cached;
        loading.value = false;
        return;
    }

    // 2. Fetch definition based on settings
    const provider = (plugin.settings?.hover_definition_provider || 'auto').toLowerCase();

    try {
        let result: string[] = [];
        let failed = false;

        if (hoverLang === 'en') {
            result = await fetchEnglishDefinitions(w, options => withTimeout(requestUrl(options)),
                () => { failed = true; });
            if (myId !== lookupRequestId) return; // stale request cancelled
        } else {
            // ── Translation to target language ──
            if (provider === 'bing') {
                const response = await fetchBingDict(w);
                result = response.meanings; failed = response.failed;
            } else if (provider === 'youdao') {
                const response = await fetchYoudaoDict(w);
                result = response.meanings; failed = response.failed;
            } else if (provider === 'mymemory') {
                const response = await fetchMyMemory(w, hoverLang);
                result = response.meanings; failed = response.failed;
            } else {
                // Google is preferred; MyMemory is a bounded fallback when it
                // is rate-limited, unavailable, or has no entry.
                const primary = await fetchGoogleTranslate(w, hoverLang);
                if (myId !== lookupRequestId) return; // stale request cancelled
                result = primary.meanings; failed = primary.failed;
                if (!result.length) {
                    const backup = await fetchMyMemory(w, hoverLang);
                    result = backup.meanings;
                    failed = failed || backup.failed;
                }
            }
            if (myId !== lookupRequestId) return; // stale request cancelled
        }

        meanings.value = result.slice(0, 3);
        lookupFailed.value = !meanings.value.length && failed;
        if (meanings.value.length > 0) {
            wordCache.set(w.toLowerCase(), meanings.value);
        }
    } catch (e) {
        if (myId !== lookupRequestId) return; // stale request cancelled
        lookupFailed.value = true;
        logger.warn('[SubtitlePopup] Translation failed for word:', w, e);
    }
    loading.value = false;
}

async function lookupPhrases(w: string, sentence: string) {
    const requestId = ++phraseRequestId;
    phrases.value = [];
    if (!sentence) return;

    // Check phrases in database via getStoredWords
    try {
        const words = sentence.toLowerCase().split(/\s+/).filter(Boolean);
        const result = await plugin.db.getStoredWords({
            article: sentence.toLowerCase(),
            words,
        });
        if (requestId !== phraseRequestId) return;
        if (result && result.phrases && result.phrases.length > 0) {
            // Only show phrases containing the clicked word
            const lowerWord = w.toLowerCase();
            const relevantPhrases = result.phrases.filter(p =>
                p.text.toLowerCase().includes(lowerWord)
            );
            const found: Array<{ text: string; meaning?: string }> = [];
            for (const p of relevantPhrases) {
                // Get meaning from db
                const info = await plugin.db.getExpression(p.text);
                if (requestId !== phraseRequestId) return;
                found.push({
                    text: p.text,
                    meaning: info?.meaning || undefined,
                });
            }
            phrases.value = found;
        }
    } catch (e) {
        logger.warn('[SubtitlePopup] Phrase lookup failed:', e);
    }
}

function speakWord() {
    if (!word.value) return;
    const w = encodeURIComponent(word.value);
    // Youdao: type=1 British, type=2 American
    const type = plugin.settings.hover_pron_accent === 'uk' ? 1 : 2;
    playAudio(`https://dict.youdao.com/dictvoice?audio=${w}&type=${type}`);
}

function captureSentence(sentences: Sentence[], text: string, trans: string, origin: string, link: string) {
    const exact = sentences.find(s => s.text === text && (!link || s.readerLink === link));
    if (exact) return;
    const unlinked = link && sentences.find(s => s.text === text && !s.readerLink && (!s.origin || s.origin === origin));
    if (unlinked) { unlinked.readerLink = link; return; }
    sentences.push({ text, trans: trans || '', origin, ...(link ? { readerLink: link } : {}) });
}

async function markKnown() {
    if (!word.value) return;
    const w = word.value.toLowerCase();
    const sourceSentence = sentenceEn.value;
    const sourceTranslation = sentenceZh.value;
    const sourceOrigin = bookTitle.value || 'LinguaFlow subtitle';
    const sourceReaderLink = readerLink.value;
    const sourceMeanings = [...meanings.value];
    let savedStatus = 3;
    wordCache.invalidate(w);

    try {
        const existing = await plugin.db.getExpression(w);
        if (existing) {
            // The action is intentionally a simple “known/ignored” toggle.
            // Any active learning state can be promoted to Known; only Known
            // toggles back to Ignored.
            const newStatus = existing.status === 3 ? 0 : 3;
            savedStatus = newStatus;
            existing.status = newStatus;
            // Also save sentence context
            if (sourceSentence) {
                captureSentence(existing.sentences, sourceSentence, sourceTranslation, sourceOrigin, sourceReaderLink);
            }
            await plugin.db.postExpression(existing);
            if (word.value.toLowerCase() === w) currentStatus.value = newStatus;
        } else {
            // A word not yet in the vocabulary is genuinely marked as Known,
            // never as Ignored. “Not in vocabulary” is a derived UI state.
            await plugin.db.postExpression({
                expression: w,
                meaning: sourceMeanings.join('; ') || '',
                status: 3,
                t: 'WORD',
                tags: [],
                notes: [],
                sentences: sourceSentence ? [{
                    text: sourceSentence,
                    trans: sourceTranslation || '',
                    origin: sourceOrigin,
                    ...(sourceReaderLink ? { readerLink: sourceReaderLink } : {}),
                }] : [],
                aliases: [],
                date: Date.now(),
            });
            if (word.value.toLowerCase() === w) currentStatus.value = 3;
        }

        dispatchEvent(new CustomEvent('qiaomu-english-event-refresh', {
            detail: {
                expression: w,
                type: 'WORD',
                status: savedStatus,
                meaning: sourceMeanings.join('; '),
                aliases: [],
            },
        }));
        dispatchEvent(new CustomEvent('qiaomu-english-event-refresh-stat'));
    } catch (e) {
        showStatusSaveFailure(e, 'Failed to update word status');
    }
}

async function markLearning() {
    if (!word.value) return;
    const w = word.value.toLowerCase();
    const sourceSentence = sentenceEn.value;
    const sourceTranslation = sentenceZh.value;
    const sourceOrigin = bookTitle.value || 'LinguaFlow subtitle';
    const sourceBookTitle = bookTitle.value;
    const sourceReaderLink = readerLink.value;
    const sourceMeanings = [...meanings.value];
    wordCache.invalidate(w);

    try {
        const existing = await plugin.db.getExpression(w);
        if (existing) {
            existing.status = 1;
            // Add sentence context if not already present
            if (sourceSentence) {
                captureSentence(existing.sentences, sourceSentence, sourceTranslation, sourceOrigin, sourceReaderLink);
            }
            await plugin.db.postExpression(existing);
        } else {
            await plugin.db.postExpression({
                expression: w,
                meaning: sourceMeanings.join('; ') || '',
                status: 1,
                t: 'WORD',
                tags: [],
                notes: [],
                sentences: sourceSentence ? [{
                    text: sourceSentence,
                    trans: sourceTranslation || '',
                    origin: sourceOrigin,
                    ...(sourceReaderLink ? { readerLink: sourceReaderLink } : {}),
                }] : [],
                aliases: [],
                date: Date.now(),
            });
        }
        if (word.value.toLowerCase() === w) currentStatus.value = 1;

        dispatchEvent(new CustomEvent('qiaomu-english-event-refresh', {
            detail: {
                expression: w,
                type: 'WORD',
                status: 1,
                meaning: sourceMeanings.join('; '),
                aliases: [],
            },
        }));
        dispatchEvent(new CustomEvent('qiaomu-english-event-refresh-stat'));

        // Also trigger the full search panel for detailed editing
        dispatchEvent(new CustomEvent('qiaomu-english-event-search', {
            detail: { selection: w, sentence: sourceSentence, bookTitle: sourceBookTitle,
                readerLink: sourceReaderLink },
        }));
    } catch (e) {
        showStatusSaveFailure(e, 'Failed to save word');
    }
}

// Exposed method for plugin.ts to call
function show(data: {
    word: string;
    sentenceEn: string;
    sentenceZh: string;
    bookTitle?: string;
    readerLink?: string;
    x: number;
    y: number;
}) {
    logger.debug('[SubtitlePopup] show() called with:', data.word, 'x:', data.x, 'y:', data.y);
    cancelClose();
    word.value = data.word.replace(/[^a-zA-Z'-]/g, '');
    if (!word.value) { logger.debug('[SubtitlePopup] word cleaned to empty, skipping'); return; }

    sentenceEn.value = data.sentenceEn;
    sentenceZh.value = data.sentenceZh;
    bookTitle.value = data.bookTitle || '';
    try { readerLink.value = normalizeReaderLink(data.readerLink) || ''; }
    catch { readerLink.value = ''; }

    // 保存单词位置
    wordCenterX = data.x;
    wordTopY = data.y;

    // Show first (off-screen), then measure and reposition
    x.value = -9999;
    y.value = -9999;
    visible.value = true;
    logger.debug('[SubtitlePopup] visible set to true, starting lookup for:', word.value);

    // Lookup word and phrases
    lookupWord(word.value);
    lookupPhrases(word.value, data.sentenceEn);

    // 初次定位
    repositionPopup();
}

defineExpose({ show, close, cancelClose });
</script>

<style>
/* ============================================================
   SubtitlePopup — adaptive light/dark theme
   ============================================================ */
.langr-subtitle-popup {
    position: fixed;
    z-index: 10000;
    pointer-events: none;
    border: none;
    border-radius: 10px;
    padding: 0;
    overflow: hidden;
    animation: stp-fadein 0.1s ease;
    max-width: min(320px, 80vw);
    width: auto;
}
.langr-subtitle-popup .stp-actions button { pointer-events: auto; }

/* Dark mode (default) */
.langr-subtitle-popup {
    background: #2b2b2f;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    color: #e0e0e0;
}

/* Light mode */
.theme-light .langr-subtitle-popup {
    background: #ffffff;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.06);
    color: #1a1a1a;
}

@keyframes stp-fadein {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
}

/* --- Body --- */
.stp-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6px 8px 6px 8px;
}

/* Meanings — each on its own line, centered */
.stp-meaning {
    font-size: 14px;
    color: #e0e0e0;
    line-height: 1.45;
    cursor: default;
    white-space: normal;
    word-break: break-word;
    text-align: center;
    width: 100%;
}
.theme-light .stp-meaning {
    color: #1a1a1a;
}

.stp-loading {
    color: #666;
    font-style: italic;
}
.theme-light .stp-loading {
    color: #999;
}

/* --- Buttons row --- */
.stp-actions {
    display: flex;
    flex-direction: row;
    gap: 4px;
    margin-top: 5px;
}

/* Shared button base */
.stp-btn-speak,
.stp-btn-known,
.stp-btn-learn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    transition: background 0.12s, color 0.12s, transform 0.1s;
    padding: 0;
}
.stp-btn-speak:focus-visible,
.stp-btn-known:focus-visible,
.stp-btn-learn:focus-visible {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 2px;
}

.stp-btn-speak:active,
.stp-btn-known:active,
.stp-btn-learn:active {
    transform: scale(0.92);
}

/* ── DARK MODE buttons ── */
/* 🔊 button */
.stp-btn-speak {
    background: rgba(255, 255, 255, 0.08);
    color: #5b9bd5;
}
.stp-btn-speak:hover {
    background: rgba(255, 255, 255, 0.14);
}

/* ✓ button */
.stp-btn-known {
    background: rgba(255, 255, 255, 0.08);
    color: #b7bdc5;
}
.stp-btn-known:hover {
    background: rgba(255, 255, 255, 0.14);
}
.stp-btn-known.stp-btn-active {
    background: rgba(92, 184, 92, 0.2);
    color: #78dfa0;
    box-shadow: inset 0 0 0 1px #45ad6c;
}

/* 📖 button */
.stp-btn-learn {
    background: rgba(255, 255, 255, 0.08);
    color: #ffd17a;
}
.stp-btn-learn:hover {
    background: rgba(255, 255, 255, 0.14);
}
.stp-btn-learn.stp-btn-active {
    background: rgba(92, 184, 92, 0.2);
    color: #78dfa0;
    box-shadow: inset 0 0 0 1px #45ad6c;
}

/* ── LIGHT MODE buttons ── */
.theme-light .stp-btn-speak {
    background: rgba(0, 0, 0, 0.06);
    color: #1765a3;
}
.theme-light .stp-btn-speak:hover {
    background: rgba(0, 0, 0, 0.1);
}

.theme-light .stp-btn-known {
    background: rgba(0, 0, 0, 0.06);
    color: #67727b;
}
.theme-light .stp-btn-known:hover {
    background: rgba(0, 0, 0, 0.1);
}
.theme-light .stp-btn-known.stp-btn-active {
    background: rgba(45, 138, 45, 0.15);
    color: #187a3d;
    box-shadow: inset 0 0 0 1px #26a65b;
}

.theme-light .stp-btn-learn {
    background: rgba(0, 0, 0, 0.06);
    color: #a96b11;
}
.theme-light .stp-btn-learn:hover {
    background: rgba(0, 0, 0, 0.1);
}
.theme-light .stp-btn-learn.stp-btn-active {
    background: rgba(45, 138, 45, 0.15);
    color: #187a3d;
    box-shadow: inset 0 0 0 1px #26a65b;
}

.is-mobile .stp-btn-speak,
.is-mobile .stp-btn-known,
.is-mobile .stp-btn-learn {
    width: 38px !important;
    height: 38px !important;
}
</style>
