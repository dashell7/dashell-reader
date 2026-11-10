<template>
    <div id="qiaomu-english-search" @click="handleClick">
        <div class="search-bar">
            <div class="search-history-buttons">
                <button class="search-nav-btn" :disabled="historyIndex <= 0" @click="switchHistory('prev')">
                    <span class="search-sr-only">{{ t('Previous search') }}</span>
                    <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                </button>
                <button class="search-nav-btn" :disabled="historyIndex >= lastHistory" @click="switchHistory('next')">
                    <span class="search-sr-only">{{ t('Next search') }}</span>
                    <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                </button>
            </div>
            <label class="search-sr-only" :for="searchInputId">{{ t('Enter word') }}</label>
            <input
                :id="searchInputId"
                class="search-input" 
                type="text" 
                :placeholder="t('Enter word')"
                v-model="inputWord" 
                @keydown.enter="handleSearch"
                @compositionstart="isComposing = true"
                @compositionend="isComposing = false"
            />
            <button class="search-submit-btn" @click="handleSearch">{{ t("Search") }}</button>
        </div>
        <div class="dict-area" :style="{ fontSize: dictFontSize, fontFamily: dictFontFamily || undefined }" :aria-busy="isSearching">
            <div v-if="components.length === 0" class="dict-empty-state" role="status">
                {{ t("No dictionaries enabled") }}
            </div>
            <div v-else-if="!word" class="dict-empty-state" role="status">{{ t('Search prompt') }}</div>
            <DictItem v-for="(cp, i) in components" v-show="word" :key="cp.id" :loading="loadings[i]" :name="cp.name" :id="cp.id" :has-result="shows[i]">
                <div v-if="statuses[i]?.state === 'empty' || statuses[i]?.state === 'error'" class="dict-query-feedback" role="status">
                    <p>{{ statuses[i]?.state === 'error' ? t('Dictionary request failed') : t('Dictionary no result') }}</p>
                    <p v-if="cp.id === 'ai' && statuses[i]?.state === 'error'">{{ t('Check AI dictionary settings') }}</p>
                    <details v-if="statuses[i]?.message">
                        <summary>{{ t('Error details') }}</summary>
                        <p>{{ statuses[i].message }}</p>
                    </details>
                    <button type="button" @click="retrySearch(cp.id)">{{ t('Retry dictionary search') }}</button>
                </div>
                <Component :key="`${cp.id}:${queryRevision}:${retryRevisions[cp.id] || 0}`" @loading="loading" :is="cp.type" :word="word"
                    v-bind="cp.id === 'ai' ? { context: aiContext } : {}"
                    v-show="shows[i]"></Component>
            </DictItem>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, getCurrentInstance, toRef, computed } from "vue";

import DictItem from "./DictItem.vue";
import { t } from "@/lang/helper";
import PluginType from "@/plugin";
import { dicts } from "@dict/list";
import { playAudio } from "@/utils/helpers";
import { logger } from "@/utils/logger";
import type { DictionaryStatus } from "@dict/uses";

const plugin = getCurrentInstance().appContext.config.globalProperties.plugin as PluginType;
const searchInputId = `reader-dictionary-query-${getCurrentInstance().uid}`;
let isComposing = false;
const queryRevision = ref(0);
const retryRevisions = ref<Record<string, number>>({});
let dictFontSize = toRef(plugin.store, "dictFontSize");
let dictFontFamily = toRef(plugin.store, "dictFontFamily");

let components = ref([]);
let map: { [K in string]: number } = {};
let loadings = ref<boolean[]>([]);
let shows = ref<boolean[]>([]);
let statuses = ref<DictionaryStatus[]>([]);
const isSearching = computed(() => loadings.value.some(Boolean));
watch(() => plugin.store.dictsChange, () => {
    let collection = Object.keys(plugin.settings.dictionaries)
        .map((dict: keyof typeof dicts) => {
            // 检查字典是否存在
            if (!dicts[dict]) {
                logger.warn(`Dictionary not found: ${dict}`);
                return null;
            }
            return {
                id: dict,
                priority: plugin.settings.dictionaries[dict].priority,
                name: dicts[dict].name,
            };
        })
        .filter((dict) => dict && plugin.settings.dictionaries[dict.id].enable);
    collection.sort((a, b) => a.priority - b.priority);

    components.value = collection.map((dict) => {
        return {
            id: dict.id,
            name: dict.name,
            type: dicts[dict.id].Cp,
        };
    });
    map = {};
    collection.forEach((v, i) => {
        map[v.id] = i;
    });
    loadings.value = Array(collection.length).fill(false);
    shows.value = Array(collection.length).fill(false);
    statuses.value = collection.map(dict => ({ id: dict.id, loading: false, result: false, state: 'idle' }));
    // A changed source configuration must refresh retained result instances too.
    retrySearch();

}, {
    immediate: true
});

function loading(status: DictionaryStatus) {
    const index = map[status.id];
    if (index === undefined) return;
    loadings.value[index] = status.loading;
    shows.value[index] = status.result;
    statuses.value[index] = status;
}

function retrySearch(id?: string) {
    // Remount only results, retaining the query, reader context and typed draft.
    // A fresh instance also prevents an older same-word request replacing a retry.
    if (id) retryRevisions.value[id] = (retryRevisions.value[id] || 0) + 1;
    else {
        retryRevisions.value = {};
        queryRevision.value++;
    }
}

// 提供一个前进后退查询记录的功能
let history: string[] = [];
let lastHistory = ref(history.length - 1);
let historyIndex = ref(-1);
function switchHistory(direction: "prev" | "next") {
    if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
    historyIndex.value = Math.max(
        0,
        Math.min(historyIndex.value + (direction === "prev" ? -1 : 1), history.length - 1)
    );
    word.value = history[historyIndex.value];
    inputWord.value = history[historyIndex.value];
    aiContext.value = { sentence: "", bookTitle: "" };
    retrySearch();
    publishQuery();
}
function appendHistory() {
    if (!word.value.trim()) return;
    word.value = word.value.trim();
    if (historyIndex.value < history.length - 1) {
        history = history.slice(0, historyIndex.value + 1);
    }
    if (history[history.length - 1] !== word.value) history.push(word.value);
    lastHistory.value = history.length - 1;
    historyIndex.value = lastHistory.value;
}

let inputWord = ref("");
let word = ref("");
let aiContext = ref({ sentence: "", bookTitle: "" });

// Debounce search to avoid redundant API calls when the same word fires rapidly
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const onSearch = (evt: CustomEvent) => {
    if (evt.detail.source === searchInputId) return;
    const text = evt.detail.selection as string;
    const context = {
        sentence: String(evt.detail.sentence || ""),
        bookTitle: String(evt.detail.bookTitle || ""),
    };
    if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
    if (!text || (text === word.value && context.sentence === aiContext.value.sentence
        && context.bookTitle === aiContext.value.bookTitle)) return;
    searchDebounceTimer = setTimeout(() => {
        searchDebounceTimer = null;
        aiContext.value = context;
        word.value = text;
        inputWord.value = text;
        appendHistory();
        retrySearch();
    }, 80);
};

function handleSearch(event?: KeyboardEvent | MouseEvent) {
    if (isComposing || (event instanceof KeyboardEvent && (event.isComposing || event.keyCode === 229))) return;
    if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
    const query = inputWord.value.trim();
    if (query !== word.value) aiContext.value = { sentence: "", bookTitle: "" };
    word.value = query;
    if (!word.value) return;
    appendHistory();
    retrySearch();
    publishQuery();
}

// Every dictionary navigation shares the same word with the learning form.
// The source identifies this panel so its own event cannot replay history.
function publishQuery() {
    dispatchEvent(new CustomEvent('qiaomu-english-event-search', {
        detail: { selection: word.value, ...aiContext.value, source: searchInputId },
    }));
}

function handleClick(evt: MouseEvent) {
    const target = evt.target as HTMLElement;
    const speaker = target.closest(".speaker") as HTMLAnchorElement | null;
    if (speaker) {
        evt.preventDefault();
        evt.stopPropagation();
        let url = speaker.href;
        playAudio(url);

    }
    else {
        const link = target.closest("a") as HTMLAnchorElement | null;
        if (!link) return;
        evt.preventDefault();
        evt.stopPropagation();
        if (searchDebounceTimer !== null) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
        word.value = link.textContent?.trim() || "";
        aiContext.value = { sentence: "", bookTitle: "" };
        inputWord.value = word.value;
        if (!word.value) return;
        appendHistory();
        retrySearch();
        publishQuery();
    }
}


onMounted(() => {
    addEventListener('qiaomu-english-event-search', onSearch);
});

onUnmounted(() => {
    removeEventListener('qiaomu-english-event-search', onSearch);
    if (searchDebounceTimer !== null) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
    }
});
</script>

<style lang="scss">
#qiaomu-english-search {
    .search-sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
    }

    .dict-empty-state,
    .dict-query-feedback {
        padding: 12px 8px;
        color: var(--text-muted);
        line-height: 1.5;
        overflow-wrap: anywhere;
        p { margin: 0 0 8px; }
        details { margin-bottom: 8px; }
        summary { cursor: pointer; }
    }
    height: 100%;
    width: 100%;
    overflow: hidden;
    font-size: var(--font-ui-medium, 14px);
    user-select: text;
    display: flex;
    flex-direction: column;

    .search-bar {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
        padding: 6px 8px;
        background: var(--background-primary);
        border-radius: 4px;
        
        .search-history-buttons {
            display: flex;
            flex-shrink: 0;
            gap: 2px;
            
            .search-nav-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 32px;
                height: 32px;
                padding: 0;
                background: var(--background-modifier-hover);
                border: 1px solid var(--background-modifier-border);
                border-radius: 3px;
                color: var(--text-muted);
                cursor: pointer;
                transition: all 0.15s;
                box-sizing: border-box; /* 确保高度包含 border */
                
                &:hover:not(:disabled) {
                    background: var(--background-modifier-active-hover);
                    color: var(--text-normal);
                }
                
                &:disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
                }
                
                svg {
                    display: block;
                }
            }
        }
        
        .search-input {
            flex: 1;
            min-width: 0;
            height: 32px;
            padding: 4px 8px;
            background: var(--background-primary);
            border: 1px solid var(--background-modifier-border);
            border-radius: 3px;
            color: var(--text-normal);
            font-size: 0.8125rem;
            line-height: 1.4;
            outline: none;
            box-sizing: border-box; /* 确保高度包含 border 和 padding */
            
            &::placeholder {
                color: var(--text-faint);
            }
            
            &:focus {
                border-color: var(--interactive-accent);
                box-shadow: 0 0 0 1px var(--interactive-accent);
            }
        }
        
        .search-submit-btn {
            flex-shrink: 0;
            height: 32px;
            padding: 0 12px;
            background: var(--interactive-accent);
            border: none;
            border-radius: 3px;
            color: var(--text-on-accent);
            font-size: 0.75rem;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.15s;
            box-sizing: border-box; /* 确保高度包含 padding */
            
            &:hover {
                background: var(--interactive-accent-hover);
            }
            
            &:active {
                transform: translateY(1px);
            }
        }
    }

    .dict-area {
        flex: 1;
        overflow: auto;
    }
}

.is-mobile #qiaomu-english-search {
    .search-bar {
        padding: 8px;
        gap: 8px;
    }

    .search-history-buttons .search-nav-btn {
        width: 44px;
        height: 44px;
    }

    .search-input {
        height: 44px;
        font-size: 1rem;
    }

    .search-submit-btn {
        height: 44px;
        padding: 0 14px;
        font-size: 0.875rem;
    }
}
</style>
