<template>
    <div id="qiaomu-english-global" ref="global">
        <PopupSearch :x="searchX" :y="searchY" ref="search" v-if="store.popupSearch" v-show="showSearch" />
        <SubtitlePopup ref="subtitlePopup" />
        <div
            class="langr-toast"
            :class="toastType ? `langr-toast--${toastType}` : ''"
            v-show="toastVisible"
        >
            {{ toastMessage }}
        </div>
    </div>
</template>

<script setup lang='ts'>
import { ref, watch } from 'vue';
import { Platform } from "obsidian";
import { onClickOutside, onKeyStroke } from "@vueuse/core";
import store from "@/store";
import { getPageSize, optimizedPos } from "@/utils/style";
import { useEvent } from "@/utils/use";
import PopupSearch from "./PopupSearch.vue";
import SubtitlePopup from "./SubtitlePopup.vue";
import { logger } from "@/utils/logger";

const global = ref(null);

const toastVisible = ref(false);
const toastMessage = ref("");
const toastType = ref<"success" | "error" | "info" | "">("");
let toastTimer: number | null = null;

let showSearch = ref(false);
// 重新再设置打开popup_search时，重置showSearch状态
watch(() => store.popupSearch, (open) => {
    if (open) {
        showSearch.value = false;
    }
});

let search = ref<InstanceType<typeof PopupSearch>>(null);
let subtitlePopup = ref<InstanceType<typeof SubtitlePopup>>(null);

function closeSearch(evt: MouseEvent) {
    let target = evt.target as HTMLElement;
    if (target.hasClass("word") ||
        target.hasClass("phrase") ||
        target.matchParent("#qiaomu-english-learn-panel") ||
        window.getSelection().toString() ||
        search.value?.pinned
    ) {
        return;
    }
    showSearch.value = false;
}
onClickOutside(search, closeSearch);
onKeyStroke("Escape", (e) => {
    if (search.value?.pinned)
        return;

    showSearch.value = false;
})

let searchX = ref(0);
let searchY = ref(0);
useEvent(window, "qiaomu-english-event-search", (evt) => {
    let { pageW, pageH } = getPageSize();
    let evtPos = evt.detail.evtPosition;
    if (evtPos) {
        let h = 520, w = 450;
        if (Platform.isMobileApp) {
            // A tablet needs a readable dictionary sheet, while a phone still
            // gets a compact panel. The actual position is clamped below.
            h = Math.min(600, Math.round(window.innerHeight * 0.72));
            w = Math.min(560, Math.round(window.innerWidth * 0.9));
        }

        let { x, y } = optimizedPos({ h: pageH, w: pageW }, { h, w }, evtPos, 60, 30);

        searchX.value = x;
        searchY.value = y;
    }
    showSearch.value = true;
})

function showToast(message: string, type: "success" | "error" | "info" = "info", duration = 2000) {
    toastMessage.value = message;
    toastType.value = type;
    toastVisible.value = true;
    if (toastTimer) {
        window.clearTimeout(toastTimer);
    }
    toastTimer = window.setTimeout(() => {
        toastVisible.value = false;
    }, duration);
}

useEvent(window, "qiaomu-english-event-toast", (evt) => {
    const { message, type = "info", duration } = evt.detail || {};
    if (!message) return;
    showToast(message, type, duration ?? 2000);
});

// 字幕弹窗事件监听
useEvent(window, "qiaomu-english-event-subtitle-popup", (evt) => {
    const { word, sentenceEn, sentenceZh, bookTitle, readerLink, x, y } = evt.detail || {};
    logger.debug('[Global] received subtitle-popup event:', word, 'subtitlePopup ref:', !!subtitlePopup.value);
    if (!word || !subtitlePopup.value) return;
    subtitlePopup.value.show({ word, sentenceEn, sentenceZh, bookTitle, readerLink, x, y });
});
useEvent(window, "qiaomu-english-event-subtitle-close", () => {
    subtitlePopup.value?.close();
});


</script>

<style>
.langr-toast {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 9999;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 0.875rem;
    background: var(--background-secondary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
    box-shadow: 0 6px 18px rgba(var(--mono-rgb-100), 0.12);
}

.langr-toast--success {
    background: rgba(var(--color-green-rgb, 31, 136, 61), 0.15);
    border-color: rgba(var(--color-green-rgb, 31, 136, 61), 0.5);
    color: var(--color-green, #18a058);
}

.langr-toast--error {
    background: rgba(var(--color-red-rgb, 220, 38, 38), 0.15);
    border-color: rgba(var(--color-red-rgb, 220, 38, 38), 0.5);
    color: var(--color-red, #d03050);
}

.langr-toast--info {
    background: rgba(var(--color-blue-rgb, 59, 130, 246), 0.15);
    border-color: rgba(var(--color-blue-rgb, 59, 130, 246), 0.4);
    color: var(--color-blue, #2080f0);
}
</style>
