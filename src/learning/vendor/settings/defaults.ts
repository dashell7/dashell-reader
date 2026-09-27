// ── settings/defaults.ts ──────────────────────────────────────────────────
// Default values for all plugin settings.

import type { MyPluginSettings } from "./types";

export const DEFAULT_SETTINGS: MyPluginSettings = {
    // lang
    native: "zh",
    foreign: "en",
    // appearance
    // Soft is the balanced default: clear status colors without fluorescent blocks.
    word_color_theme: "vivid",
    // search
    popup_search: true,
    auto_pron: true,
    hover_pron_accent: "us",
    function_key: "ctrlKey",
    dictionaries: {
        "youdao":    { enable: true, priority: 1 },
        "bing":      { enable: true, priority: 2 },
        "ai":        { enable: true, priority: 3 },
        "google":    { enable: true, priority: 4 },
    },
    dict_height: "300px",
    dict_font_size: "16px",
    dict_font_family: "",
    // mdict
    mdict_files: [],
    // text db (for Spaced Repetition plugin)
    word_database: "",
    review_database: "",
    col_delimiter: ",",
    auto_refresh_db: true,
    // file db
    word_folder: "Qiaomu Reader/English Vocabulary",
    // reading
    default_paragraphs: "4",
    font_size: "16px",
    font_family: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif',
    line_height: "1.8em",
    // Comfortable keeps the current 72ch reading measure. Manual controls
    // equal left/right spacing as a responsive percentage of the pane.
    reading_width_mode: "comfortable",
    reading_side_spacing: 5,
    use_machine_trans: true,
    word_count: true,
    hover_definition_enabled: true,
    hover_definition_lang: "zh",
    hover_definition_provider: "auto",
    subtitle_click_lookup_only: false,
    // review
    review_prons: "0",
    review_delimiter: "?",
    last_sync: "1970-01-01T00:00:00Z",
    last_word_db_hash: "",
    // review reflux: upgrade word status once a card's SR interval matures
    review_reflux_enabled: true,
    reflux_familiar_days: 3,
    reflux_known_days: 14,
    reflux_learned_days: 30,
    // ai
    ai: {
        provider: "openai",
        api_key: "",
        api_url: "https://api.openai.com/v1/chat/completions",
        model: "gpt-4o-mini",
        prompt: "You are a helpful English learning assistant. Explain the meaning of words clearly and provide examples.",
        trans_prompt: "Translate the following sentence into Chinese accurately and naturally: {sentence}",
    },
    activeTab: "general",
};
