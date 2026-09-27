// ── settings/types.ts ─────────────────────────────────────────────────────
// MyPluginSettings interface, related types, and AI_PROVIDERS constant.

export type HoverTranslationProvider = "auto" | "google" | "mymemory" | "bing" | "youdao";
export type WordColorTheme = "underline" | "vivid" | "background" | "minimal" | "lingq" | "night";
export type ReadingWidthMode = "comfortable" | "full" | "manual";

export interface MyPluginSettings {
    // lang
    native: string;
    foreign: string;
    // appearance
    word_color_theme: WordColorTheme;
    // search
    popup_search: boolean;
    auto_pron: boolean;
    hover_pron_accent: "us" | "uk";
    function_key: "ctrlKey" | "altKey" | "metaKey" | "disable";
    dictionaries: { [K in string]: { enable: boolean, priority: number; } };
    dict_height: string;
    dict_font_size: string;
    dict_font_family: string;
    // reading
    word_count: boolean;
    default_paragraphs: string;
    font_size: string;
    font_family: string;
    line_height: string;
    reading_width_mode: ReadingWidthMode;
    reading_side_spacing: number;
    use_machine_trans: boolean;
    hover_definition_enabled: boolean;
    hover_definition_lang: string;
    hover_definition_provider: HoverTranslationProvider;
    subtitle_click_lookup_only: boolean;
    // text db (for Spaced Repetition plugin)
    word_database: string;
    review_database: string;
    col_delimiter: "," | "\t" | "|";
    auto_refresh_db: boolean;
    // file db
    word_folder: string;
    // review
    review_prons: "0" | "1";
    review_delimiter: string;
    last_sync?: string;
    last_word_db_hash?: string;
    // review reflux (SR scheduling → word status upgrades)
    review_reflux_enabled: boolean;
    reflux_familiar_days: number;
    reflux_known_days: number;
    reflux_learned_days: number;
    // ai
    ai: {
        provider: string;
        api_key: string;
        api_url: string;
        model: string;
        prompt: string;
        trans_prompt: string;
    };
    // mdict - local MDict dictionary files (.mdx)
    mdict_files: Array<{ path: string; name: string; enabled: boolean }>;
    // ui (deprecated: activeTab is now memory-only, kept for data.json compat)
    activeTab: string;
}

export const AI_PROVIDERS: Record<string, { label: string; url: string; models: string[] }> = {
    openai:      { label: "OpenAI",    url: "https://api.openai.com/v1/chat/completions",                                          models: ["gpt-3.5-turbo", "gpt-4", "gpt-4o", "gpt-4o-mini"] },
    gemini:      { label: "Gemini",    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",            models: ["gemini-2.0-flash", "gemini-2.0-pro-exp", "gemini-3.0-pro", "gemini-1.5-pro", "gemini-1.5-flash"] },
    deepseek:    { label: "DeepSeek",  url: "https://api.deepseek.com/chat/completions",                                          models: ["deepseek-chat", "deepseek-coder"] },
    siliconflow: { label: "硅基流动",  url: "https://api.siliconflow.cn/v1/chat/completions",                                     models: ["Qwen/Qwen2.5-7B-Instruct", "deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-V3.1-Terminus", "deepseek-ai/DeepSeek-R1", "deepseek-ai/DeepSeek-V2.5", "zai-org/GLM-4.6", "moonshotai/Kimi-K2-Thinking"] },
    custom:      { label: "Custom",    url: "",                                                                                    models: [] },
};
