<template>
    <div ref="containerRef" class="bing-dict">
        <section v-for="entry in result" :key="entry.id" :id="entry.id">
            <div v-html="entry.html"></div>
        </section>
    </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from "vue";
import { BingResult, search } from "./engine";
import { useLoading } from "@dict/uses";

const props = defineProps<{
    word: string;
}>();

const emits = defineEmits<{
    (event: "loading", status: { id: string; loading: boolean; result: boolean }): void;
}>();

const result = ref<BingResult>([]);
const containerRef = ref<HTMLElement | null>(null);

function wireAudioButtons(): void {
    const container = containerRef.value;
    if (!container) return;
    container.querySelectorAll("a.speaker").forEach((a) => {
        a.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const src = (a as HTMLAnchorElement).href;
            if (src) {
                const audio = new Audio(src);
                audio.onended = () => { audio.src = ''; };
                audio.onerror = () => { audio.src = ''; };
                audio.play().catch(() => {});
            }
        });
    });
}

async function onSearch(): Promise<boolean> {
    const query = props.word;
    const res = await search(query);
    if (!res) return false;
    if (query !== props.word) return false;

    result.value = res.result;
    await nextTick();
    wireAudioButtons();
    return true;
}

useLoading(() => props.word, "bing", onSearch, emits);
</script>

<style lang="scss">
.bing-dict {
    font-size: 1.05em;
    line-height: 1.6;
    padding: 4px 0;

    .bing-header { margin-bottom: 10px; }

    .bing-headword {
        font-size: 1.5em;
        font-weight: 700;
        color: var(--text-accent);
        margin-bottom: 4px;
    }

    .bing-phonetics {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        margin-bottom: 6px;
    }

    .bing-pron {
        font-size: 0.9em;
        color: var(--text-muted);
        a.speaker {
            cursor: pointer;
            text-decoration: none;
            font-size: 0.85em;
            &:hover { opacity: 0.7; }
        }
    }

    .bing-defs {
        margin-bottom: 12px;
        border-left: 3px solid var(--text-accent);
        padding-left: 10px;
    }

    .bing-def-item { margin-bottom: 4px; line-height: 1.6; }

    .bing-pos {
        font-weight: 600;
        color: var(--text-accent);
        margin-right: 6px;
        font-style: italic;
    }

    .bing-def { color: var(--text-normal); }

    .bing-thesaurus {
        margin: 10px 0;
        padding: 8px 10px;
        background: var(--background-secondary);
        border-radius: 6px;
    }

    .bing-th-title { font-weight: 600; font-size: 0.9em; color: var(--text-accent); margin-bottom: 4px; }
    .bing-th-section { margin-bottom: 6px; }
    .bing-th-pos { font-weight: 600; color: var(--text-faint); font-size: 0.85em; margin-right: 4px; }
    .bing-th-item { font-size: 0.9em; line-height: 1.5; color: var(--text-normal); }

    .bing-sentences { margin-top: 10px; }

    .bing-sen-title {
        font-weight: 600;
        font-size: 0.95em;
        color: var(--text-accent);
        margin-bottom: 6px;
        padding-bottom: 4px;
        border-bottom: 1px solid var(--background-modifier-border);
    }

    .bing-sen-item {
        display: flex;
        gap: 6px;
        margin-bottom: 8px;
        padding-bottom: 8px;
        border-bottom: 1px dashed var(--background-modifier-border);
        &:last-child { border-bottom: none; margin-bottom: 0; }
    }

    .bing-sen-num { color: var(--text-faint); font-size: 0.85em; min-width: 18px; padding-top: 2px; }
    .bing-sen-content { flex: 1; }
    .bing-sen-en { color: var(--text-normal); font-size: 0.95em; margin-bottom: 2px; }
    .bing-sen-cn { color: var(--text-muted); font-size: 0.9em; }
}
</style>
