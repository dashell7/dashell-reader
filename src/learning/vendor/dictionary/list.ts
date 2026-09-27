import { t } from "@/lang/helper";
import Youdao from "./youdao/View.vue";
import Bing from "./bing/View.vue";
import AI from "./ai/View.vue";
import Google from "./google/View.vue";
import { Platform } from "obsidian";
import { defineAsyncComponent, defineComponent, h } from "vue";

// ─── static dictionaries ─────────────────────────────────────────────────────

/**
 * The `dicts` object is mutable so that plugin.ts can register/unregister
 * MDict entries at runtime without reloading the entire settings system.
 */
const dicts: Record<string, { name: string; description: string; Cp: any }> = {
    "youdao": {
        name: t("Youdao"),
        description: `${t("English")} <=> ${t("Chinese")}`,
        Cp: Youdao
    },
    "bing": {
        name: t("Bing Dictionary"),
        description: `${t("English")} <=> ${t("Chinese")}`,
        Cp: Bing
    },
    "ai": {
        name: t("AI Search"),
        description: t("AI Explanation"),
        Cp: AI
    },
    "google": {
        name: t("Google"),
        description: t("Multi-language Translate"),
        Cp: Google
    },
};

// ─── dynamic MDict dictionaries ───────────────────────────────────────────────

/**
 * Register (or update) a MDict dictionary entry.
 * Creates a wrapper Vue component that passes the `dictId` prop automatically.
 *
 * @param id      – e.g. "mdict_0"
 * @param name    – display name shown in the dict panel header
 * @param dictId  – same as id, forwarded as prop to MdictView
 */
export function registerMdictDict(id: string, name: string, dictId: string): void {
    if (!Platform.isDesktopApp) return;

    const MdictView = defineAsyncComponent(() => import("./mdict/View.vue").then(module => module.default));

    // Create a thin wrapper that injects the dictId prop
    const BoundView = defineComponent({
        name: `MdictBound_${id}`,
        props: {
            word: { type: String, required: true },
        },
        emits: ["loading"],
        setup(props, { emit }) {
            return () => h(MdictView, {
                word: props.word,
                dictId,
                onLoading: (status: any) => emit("loading", status),
            });
        },
    });

    dicts[id] = {
        name,
        description: t("Local MDict dictionary"),
        Cp: BoundView,
    };
}

/**
 * Remove a MDict dictionary entry (e.g. when user deletes or disables it).
 */
export function unregisterMdictDict(id: string): void {
    if (id.startsWith("mdict_")) {
        delete dicts[id];
    }
}

export { dicts };
