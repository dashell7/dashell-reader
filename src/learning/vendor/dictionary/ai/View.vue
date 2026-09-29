<template>
    <div class="ai-search-view">
        <div v-if="error" class="error">{{ error }}</div>
        <div v-else class="content" ref="contentContainer"></div>
    </div>
</template>

<script setup lang="ts">
import { ref, getCurrentInstance, onUnmounted } from 'vue';
import { MarkdownRenderer, Component } from 'obsidian';
import { useLoading } from "@dict/uses";
import { logger } from '@/utils/logger';

const props = defineProps<{
    word: string;
    context?: { sentence?: string; bookTitle?: string };
}>();

const emits = defineEmits<{
    (event: "loading", status: { id: string, loading: boolean, result: boolean }): void;
}>();

const plugin = getCurrentInstance()?.appContext.config.globalProperties.plugin;

const loading = ref(false);
const error = ref('');
const contentContainer = ref<HTMLElement | null>(null);
let activeRender: Component | null = null;

async function onSearch(): Promise<boolean> {
    if (!props.word) return false;
    const query = props.word;
    const context = { sentence: props.context?.sentence || '', bookTitle: props.context?.bookTitle || '' };
    const isCurrent = () => query === props.word && context.sentence === (props.context?.sentence || '')
        && context.bookTitle === (props.context?.bookTitle || '');

    error.value = '';
    activeRender?.unload();
    activeRender = null;
    if (contentContainer.value) {
        // Use DOM API to safely clear container instead of innerHTML
        while (contentContainer.value.firstChild) {
            contentContainer.value.removeChild(contentContainer.value.firstChild);
        }
    }

    try {
        const rawContent = await plugin.searchDictionaryWithAi(query, context);
        if (!isCurrent()) return false;

        if (contentContainer.value) {
            const rendered = document.createElement('div');
            const owner = new Component();
            owner.load();
            // MarkdownRenderer.renderMarkdown is Obsidian's safe rendering API;
            // it handles sanitization internally. We pass markdown text, not raw HTML.
            try {
                await MarkdownRenderer.renderMarkdown(rawContent, rendered, '', owner);
            } catch (error) {
                owner.unload();
                throw error;
            }
            if (!isCurrent()) { owner.unload(); return false; }
            activeRender = owner;
            contentContainer.value.replaceChildren(...Array.from(rendered.childNodes));
        }
        return true;
    } catch (e: any) {
        if (!isCurrent()) return false;
        error.value = e.message || "Error fetching AI response";
        logger.error('AI search failed:', e);
        return false;
    }
}

useLoading(() => [props.word, props.context?.sentence || '', props.context?.bookTitle || ''].join('\u0000'), "ai", onSearch, emits);
onUnmounted(() => activeRender?.unload());
</script>

<style scoped>
.ai-search-view {
    padding: 10px;
}
.loading {
    color: var(--text-muted);
    font-style: italic;
}
.error {
    color: var(--text-error);
}
.content {
    line-height: 1.6;
    font-size: 15px;
}
/* Markdown styles */
.content :deep(h1), .content :deep(h2), .content :deep(h3) {
    margin-top: 1em;
    margin-bottom: 0.5em;
    font-size: 1.2em;
}
.content :deep(p) {
    margin-bottom: 1em;
    font-size: 15px;
}
.content :deep(ul), .content :deep(ol) {
    padding-left: 1.5em;
    margin-bottom: 1em;
    font-size: 15px;
}
.content :deep(li) {
    font-size: 15px;
}
.content :deep(strong), .content :deep(b) {
    font-size: 15px;
}
.content :deep(code) {
    font-size: 14px;
}
</style>
