<template>
    <div class="word-more">
        <div class="word-notes" v-if="(notes.length > 0)">
            <h2>Notes:</h2>
            <p v-for="n in notes">{{ n }}</p>
        </div>
        <div class="word-sens" v-if="(sentences.length > 0)">
            <h2>Sentences:</h2>
            <div class="word-sen" v-for="sen in sentences">
                <p v-html="sen.text"></p>
                <p v-html="sen.trans"></p>
                <p v-html="sen.origin"></p>
                <button v-if="sen.readerLink" type="button" class="reader-backlink"
                    @click="plugin.openReaderLink(sen.readerLink)">{{ t("Back to book") }}</button>
            </div>
        </div>
    </div>
</template>

<script setup lang='ts'>
import { ref, getCurrentInstance } from 'vue';
import PluginType from "@/plugin";
import { t } from "@/lang/helper";

const instance = getCurrentInstance();
if (!instance) throw new Error('WordMore: Vue instance not available');
const plugin = instance.appContext.config.globalProperties.plugin as PluginType & {
    openReaderLink: (link: string) => void;
};

const props = defineProps<{
    word: string;
}>();

const expressionData = await plugin.db.getExpression(props.word);
let sentences = expressionData?.sentences || [];
let notes = expressionData?.notes || [];

sentences.forEach((_, i) => {
    sentences[i].text = highlight(sentences[i].text || '', props.word);
    sentences[i].trans = escapeHtml(sentences[i].trans || '');
    sentences[i].origin = escapeHtml(sentences[i].origin || '');
});

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Sanitize HTML by allowing only safe formatting tags */
function sanitizeHtml(html: string): string {
    const allowedTags = ['b', 'i', 'em', 'strong', 'span', 'br', 'div', 'p'];
    const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
    return html.replace(tagPattern, (match, tagName) => {
        if (allowedTags.includes(tagName.toLowerCase())) {
            // Strip all attributes except class from allowed tags
            return match.replace(/\s+(?!class\b)[a-zA-Z-]+=("[^"]*"|'[^']*'|[^\s>]*)/g, '');
        }
        return escapeHtml(match);
    });
}

function highlight(text: string, word: string) {
    if (!text || !word) return escapeHtml(text || '');
    // Escape HTML first to prevent XSS, then insert safe <em> tags
    text = escapeHtml(text);
    const expr = escapeHtml(word.toLowerCase());
    const Expr = escapeHtml(word[0].toUpperCase() + word.slice(1));
    text = text.replace(expr, `<em>${expr}</em>`);
    text = text.replace(Expr, `<em>${Expr}</em>`);
    return sanitizeHtml(text);
}

</script>

<style lang="scss">
.word-more {
    .reader-backlink {
        margin: 0.25em 5px 0.5em;
        border: 0;
        padding: 2px 0;
        background: transparent;
        color: var(--text-accent);
        cursor: pointer;
    }
    h2 {
        margin: 0.5em 0;
    }

    .word-notes {
        user-select: text;

        p {
            white-space: pre-line;
            margin: 0.5em 5px;
        }
    }

    .word-sens {
        user-select: text;

        .word-sen {
            margin-bottom: 5px;
            border: 1px solid gray;
            border-radius: 5px;

            p {
                &:first-child {
                    font-style: italic;

                    em {
                        font-weight: bold;
                        color: var(--interactive-accent)
                    }
                }

                margin: 0.5em 5px;
            }

        }
    }
}
</style>
