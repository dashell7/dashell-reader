<template>
    <div id="youdao">
        <h2>{{ word }}</h2>
        <div class="pronunces">
            <span class="pron" v-for="i in prons.length" @click="playAudio(prons[i - 1].url)">{{
                prons[i - 1].phsym
            }}</span>
        </div>
        <div class="meaning" style="margin-bottom: 10px;" v-html="meaningHTML"></div>
        <div class="translation" v-html="translationHTML" />
        <button v-for="sub in ['柯林斯', '辨析', '词组', '同根词']" @click="curPanel = sub"
            :class="{ 'youdao-tab-active': curPanel === sub }">
            {{ sub }}
        </button>
        <Collins class="collins" v-if="curPanel === '柯林斯'" :mydata="collins" />
        <div class="discrimination" v-else-if="curPanel === '辨析'" v-html="discriminationHTML"></div>
        <div class="word-group" v-else-if="curPanel === '词组'" v-html="wordGroupHTML"></div>
        <div class="rel-word" v-else-if="curPanel === '同根词'" v-html="relWordHTML"></div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'

import Collins from "./YDCollins.vue"
import { search, YoudaoResultLex } from "./engine"
import { useLoading } from "@dict/uses"
import { playAudio } from "@/utils/helpers"

// import Plugin from "../plugin"
// const plugin: Plugin = getCurrentInstance().appContext.config.globalProperties.plugin

const props = defineProps<{
    word: string,
}>()

const emits = defineEmits<{
    (event: "loading", status: { id: string, loading: boolean, result: boolean }): void
}>()

let word = ref("")
let meaningHTML = ref("")
let translationHTML = ref("")
let prons = ref([])
let curPanel = ref("柯林斯")
let collins = ref([{}])
let discriminationHTML = ref("")
let wordGroupHTML = ref("")
let relWordHTML = ref("")

async function onSearch(): Promise<boolean> {
    const query = props.word;
    let res = await search(query)
    if (!res) {
        return false;
    }
    if (query !== props.word) return false;
    let result = res.result as YoudaoResultLex;
    word.value = result.title;
    meaningHTML.value = result.basic;
    translationHTML.value = result.translation;
    prons.value = result.prons;
    collins.value = result.collins;
    discriminationHTML.value = result.discrimination;
    wordGroupHTML.value = result.wordGroup;
    relWordHTML.value = result.relWord;

    await nextTick();
    return true;
}

useLoading(() => props.word, "youdao", onSearch, emits);

</script>

<style lang="scss">
#youdao {
    h2 {
        font-size: 1.5em;
        font-weight: 700;
        color: var(--text-accent);
    }

    .pron {
        margin-right: 15px;
        color: var(--text-accent);
        font-size: 1.1em;
        cursor: pointer;
        transition: opacity 0.15s ease;
        &:hover { opacity: 0.7; }
    }

    .youdao-tab-active {
        background-color: var(--interactive-accent) !important;
        color: var(--text-on-accent) !important;
    }

    .meaning ul {
        padding-left: 0;
    }

    h1,
    h2,
    h3,
    h4 {
        margin-top: 0.2em;
        margin-bottom: 0.2em;
    }

    p {
        margin-top: 0.2em;
        margin-bottom: 0.2em;
    }

    ul {
        padding-left: 20px;
        margin-top: 0.2em;
        margin-bottom: 0.2em;
    }

    ul,
    ol,
    li {
        list-style-type: none;
    }

    .collins {
        h4 {

            span,
            em {
                margin-right: 5px;
            }
        }

        .collinsMajorTrans .additional {
            color: var(--text-faint);
        }

        .exampleLists {
            margin: 5px 0 5px 0px;
            padding-left: 20px;
            border-left: 1px solid var(--background-modifier-border);
        }

        .collinsOrder {
            float: left;
            margin-left: -15px;
        }
    }

    .discrimination {
        .title {
            font-size: 1.2em;
            font-weight: bold;
        }

        .wordGroup {
            margin-left: 10px;
        }

        .wt-container {
            margin-top: 0.5em;
        }
    }
}

#youdao {
    .collins .collinsMajorTrans,
    .discrimination .wt-container {
        background-color: var(--background-secondary);
        border-radius: 4px;
        padding: 6px 8px;
    }
}
</style>
