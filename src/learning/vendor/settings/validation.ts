import { DEFAULT_SETTINGS } from "./defaults";
import type { MyPluginSettings } from "./types";
import { normalizeRefluxThresholds } from "../utils/reviewReflux";

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
    !!value && typeof value === "object" && !Array.isArray(value);

const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

const formatNumber = (value: number) =>
    Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");

/** Clone the defaults so nested objects are never mutated between plugin loads. */
export function cloneDefaultSettings(): MyPluginSettings {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as MyPluginSettings;
}

function normalizeDimension(
    value: unknown,
    fallback: string,
    min: number,
    max: number,
    units: string,
): string {
    if (typeof value !== "string" && typeof value !== "number") return fallback;
    const raw = String(value).trim();
    const match = raw.match(new RegExp(`^(\\d+(?:\\.\\d+)?)(px|rem|em|%)$`, "i"));
    if (!match) return fallback;

    const number = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(number) || !units.includes(unit)) return fallback;
    return `${formatNumber(clamp(number, min, max))}${unit}`;
}

export function normalizeDictionaryHeight(value: unknown, fallback = "300px"): string {
    const raw = typeof value === "number" ? `${value}px` : String(value ?? "").trim();
    const match = raw.match(/^(\d+(?:\.\d+)?)px$/i);
    if (!match) return fallback;
    const number = Number(match[1]);
    return `${Math.round(clamp(number, 200, 600))}px`;
}

export function normalizeDictionaryFontSize(value: unknown, fallback = "16px"): string {
    return normalizeDimension(value, fallback, 12, 20, "pxremem");
}

export function normalizeReadingFontSize(value: unknown, fallback = "16px"): string {
    return normalizeDimension(value, fallback, 10, 24, "pxremem");
}

export function normalizeLineHeight(value: unknown, fallback = "1.8em"): string {
    if (typeof value === "number" || (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()))) {
        const number = Number(value);
        return Number.isFinite(number) ? formatNumber(clamp(number, 1.1, 3)) : fallback;
    }
    return normalizeDimension(value, fallback, 1.1, 3, "emrem");
}

export function normalizeReadingSideSpacing(value: unknown, fallback = 5): number {
    const number = typeof value === "number" ? value : Number(String(value ?? "").trim());
    return Number.isFinite(number) ? Math.round(clamp(number, 0, 24)) : fallback;
}

function stringValue(value: unknown, fallback: string): string {
    return typeof value === "string" ? value.trim() : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

function finitePriority(value: unknown, fallback: number): number {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? Math.round(clamp(number, 1, 10)) : fallback;
}

const scalarStringKeys: Array<keyof MyPluginSettings> = [
    "native", "foreign", "dict_font_family", "word_database", "review_database",
    "word_folder", "font_family", "review_delimiter", "last_sync", "last_word_db_hash",
    "activeTab", "hover_definition_lang",
];

const scalarBooleanKeys: Array<keyof MyPluginSettings> = [
    "popup_search", "auto_pron", "word_count", "use_machine_trans",
    "hover_definition_enabled", "subtitle_click_lookup_only", "auto_refresh_db",
    "review_reflux_enabled",
];

/**
 * Validate persisted settings and in-memory edits. Unknown fields are ignored;
 * values absent from an in-memory update remain in the supplied base settings.
 */
export function normalizeSettings(
    input: unknown,
    base: MyPluginSettings = cloneDefaultSettings(),
): MyPluginSettings {
    const result = JSON.parse(JSON.stringify(base)) as MyPluginSettings;
    if (!isRecord(input)) return result;

    for (const key of scalarStringKeys) {
        if (typeof input[key] === "string") {
            (result as unknown as UnknownRecord)[key] = input[key];
        }
    }
    for (const key of scalarBooleanKeys) {
        (result as unknown as UnknownRecord)[key] = booleanValue(input[key], result[key] as boolean);
    }

    // Older releases stored Japanese/Korean as jp/kr in the foreign-language
    // selector. Keep those vaults readable even though the legacy selector is
    // no longer shown until multilingual lookup is fully wired.
    if (result.foreign === "jp") result.foreign = "ja";
    if (result.foreign === "kr") result.foreign = "ko";

    if (typeof input.default_paragraphs === "string") {
        const paragraphs = input.default_paragraphs.trim();
        result.default_paragraphs = paragraphs === "all"
            ? "all"
            : String(Math.round(clamp(Number(paragraphs) || 4, 1, 64)));
    }

    if (input.word_color_theme === "underline" || input.word_color_theme === "vivid" ||
        input.word_color_theme === "background" || input.word_color_theme === "minimal" ||
        input.word_color_theme === "lingq" || input.word_color_theme === "night") {
        result.word_color_theme = input.word_color_theme;
    }
    if (input.function_key === "ctrlKey" || input.function_key === "altKey" ||
        input.function_key === "metaKey" || input.function_key === "disable") {
        result.function_key = input.function_key;
    }
    if (input.hover_pron_accent === "us" || input.hover_pron_accent === "uk") {
        result.hover_pron_accent = input.hover_pron_accent;
    }
    if (input.review_prons === "0" || input.review_prons === "1") {
        result.review_prons = input.review_prons;
    }
    if (input.hover_definition_provider === "auto" || input.hover_definition_provider === "google" ||
        input.hover_definition_provider === "mymemory" || input.hover_definition_provider === "bing" ||
        input.hover_definition_provider === "youdao") {
        result.hover_definition_provider = input.hover_definition_provider;
    }
    if (input.col_delimiter === "," || input.col_delimiter === "\t" || input.col_delimiter === "|") {
        result.col_delimiter = input.col_delimiter;
    }
    if (input.reading_width_mode === "comfortable" || input.reading_width_mode === "full" ||
        input.reading_width_mode === "manual") {
        result.reading_width_mode = input.reading_width_mode;
    }

    result.dict_height = normalizeDictionaryHeight(input.dict_height, result.dict_height);
    result.dict_font_size = normalizeDictionaryFontSize(input.dict_font_size, result.dict_font_size);
    result.font_size = normalizeReadingFontSize(input.font_size, result.font_size);
    result.line_height = normalizeLineHeight(input.line_height, result.line_height);
    result.reading_side_spacing = normalizeReadingSideSpacing(input.reading_side_spacing, result.reading_side_spacing);

    const reflux = normalizeRefluxThresholds({
        familiarDays: input.reflux_familiar_days as number,
        knownDays: input.reflux_known_days as number,
        learnedDays: input.reflux_learned_days as number,
    }, {
        familiarDays: result.reflux_familiar_days,
        knownDays: result.reflux_known_days,
        learnedDays: result.reflux_learned_days,
    });
    result.reflux_familiar_days = reflux.familiarDays;
    result.reflux_known_days = reflux.knownDays;
    result.reflux_learned_days = reflux.learnedDays;

    if (isRecord(input.dictionaries)) {
        for (const [id, raw] of Object.entries(input.dictionaries)) {
            if (!isRecord(raw)) continue;
            const previous = result.dictionaries[id] || { enable: false, priority: 10 };
            result.dictionaries[id] = {
                enable: booleanValue(raw.enable, previous.enable),
                priority: finitePriority(raw.priority, previous.priority),
            };
        }
    }

    if (isRecord(input.ai)) {
        const ai = input.ai;
        const stringKeys: Array<keyof MyPluginSettings["ai"]> = [
            "provider", "api_key", "api_url", "model", "prompt", "trans_prompt",
        ];
        for (const key of stringKeys) {
            if (typeof ai[key] === "string") {
                // Exported settings intentionally contain an empty API key.
                // Keep the locally configured key when importing that file.
                if (key === "api_key" && ai[key].trim() === "" && result.ai.api_key) continue;
                result.ai[key] = ai[key].trim();
            }
        }
    }

    if (Array.isArray(input.mdict_files)) {
        result.mdict_files = input.mdict_files
            .filter(isRecord)
            .filter(item => typeof item.path === "string" && item.path.trim().length > 0)
            .map(item => ({
                path: String(item.path).trim(),
                name: stringValue(item.name, "MDict"),
                enabled: booleanValue(item.enabled, true),
            }));
    }

    return result;
}
