import { parseYaml, stringifyYaml } from "obsidian";
import type { ExpressionInfo, Sentence } from "@/db/interface";
import { parseStatusValue } from "./status";
import { normalizeRecord, stableItemId, normalizeReviewState } from "./vocabularyRecord";
import { normalizeSentenceSource } from "./sentenceSource";

export const WORD_NOTE_SCHEMA = 1;

interface ParsedWordNote {
    properties: Record<string, unknown>;
    body: string;
    bom: string;
    newline: string;
}

/** Parse from disk content, not the eventually updated metadata cache. */
export function splitWordNote(content: string): ParsedWordNote {
    const opening = /^(\uFEFF)?---[ \t]*\r?\n/.exec(content);
    if (!opening) {
        return { properties: {}, body: content, bom: "", newline: "\n" };
    }
    const rest = content.slice(opening[0].length);
    const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest);
    if (!closing) throw new Error("Vocabulary note has unterminated frontmatter");
    const yaml = rest.slice(0, closing.index);
    const parsed: unknown = yaml.trim() ? parseYaml(yaml) : {};
    if (parsed != null && (typeof parsed !== "object" || Array.isArray(parsed))) {
        throw new Error("Vocabulary note frontmatter must be a YAML mapping");
    }
    return {
        properties: (parsed || {}) as Record<string, unknown>,
        body: rest.slice(closing.index + closing[0].length),
        bom: opening[1] || "",
        newline: opening[0].endsWith("\r\n") ? "\r\n" : "\n",
    };
}

function text(value: unknown, fallback = ""): string {
    return value == null ? fallback : String(value).trim();
}

function strings(value: unknown): string[] {
    return (Array.isArray(value) ? value : value == null ? [] : [value])
        .map(item => text(item)).filter(Boolean);
}

function epoch(value: unknown, fallback: number): number {
    if (value instanceof Date) return Math.floor(value.getTime() / 1000);
    if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(text(value))) {
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) {
            return Math.floor(number > 100000000000 ? number / 1000 : number);
        }
    }
    const raw = text(value);
    // Legacy dates were read using moment.utc, including dates without a zone.
    const utc = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(raw)
        ? raw.replace(" ", "T") + (raw.length === 10 ? "T00:00:00Z" : "Z")
        : raw;
    const parsed = Date.parse(utc);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : fallback;
}

function assertSupportedSchema(properties: Record<string, unknown>): void {
    if (properties.langr_schema == null) return;
    const schema = Number(properties.langr_schema);
    if (!Number.isInteger(schema) || schema < 0 || schema > WORD_NOTE_SCHEMA) {
        throw new Error(`Unsupported vocabulary note schema: ${String(properties.langr_schema)}`);
    }
}

function renderWordNote(parsed: ParsedWordNote, properties: Record<string, unknown>): string {
    const yaml = stringifyYaml(properties).replace(/\r?\n/g, parsed.newline).replace(/(?:\r?\n)+$/, "");
    return `${parsed.bom}---${parsed.newline}${yaml}${parsed.newline}---${parsed.newline}${parsed.body}`;
}

/** Restore legacy identity metadata from the backup without rewriting complete v1 notes. */
export function stampMissingWordMetadata(content: string, record: ExpressionInfo): string {
    const parsed = splitWordNote(content);
    assertSupportedSchema(parsed.properties);
    const fm = { ...parsed.properties };
    const defaults: Record<string, unknown> = {
        langr_id: record.itemId,
        langr_schema: WORD_NOTE_SCHEMA,
        langr_language: record.language,
        langr_created: record.created ?? record.date,
    };
    let changed = false;
    for (const [key, value] of Object.entries(defaults)) {
        if (fm[key] == null || fm[key] === "") {
            fm[key] = value;
            changed = true;
        }
    }
    return changed ? renderWordNote(parsed, fm) : content;
}

/** Move only a restored baseline's review path; user properties and body retain their values. */
export function rebindWordReviewPath(content: string, sourcePath: string, targetPath: string): string {
    if (sourcePath === targetPath) return content;
    const parsed = splitWordNote(content);
    assertSupportedSchema(parsed.properties);
    const state = normalizeReviewState(parsed.properties.langr_review);
    if (!state || state.reviewPath !== sourcePath) return content;
    return renderWordNote(parsed, { ...parsed.properties, langr_review: { ...state, reviewPath: targetPath } });
}

export function readWordNote(
    content: string,
    language: string,
    sourcePath: string,
    fallbackDate: number,
): ExpressionInfo | null {
    const { properties: fm } = splitWordNote(content);
    const expression = text(fm.expression).toLowerCase();
    if (!expression) return null;
    assertSupportedSchema(fm);
    const date = epoch(fm.date, fallbackDate);
    const recordLanguage = text(fm.langr_language, language).toLowerCase();
    const sources: Record<string, Sentence["source"]> = {};
    // Validate all owned source fields, including orphaned ones, before a save
    // can remove or renumber them. Corrupt/newer data must remain recoverable.
    for (const key of Object.keys(fm)) {
        if (/^langr_source\d+$/.test(key)) sources[key] = normalizeSentenceSource(fm[key]);
    }
    const sentences: Sentence[] = Object.keys(fm)
        .filter(key => /^sentence\d+$/.test(key))
        .sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)))
        .map(key => {
            const suffix = key.slice(8);
            const source = sources[`langr_source${suffix}`];
            return { text: text(fm[key]), trans: text(fm[`trans${suffix}`]), origin: text(fm[`origin${suffix}`]),
                ...(source ? { source } : {}) };
        }).filter(sentence => !!sentence.text);
    return normalizeRecord({
        expression,
        meaning: text(fm.meaning),
        status: parseStatusValue(fm.status),
        t: text(fm.type || fm.t, "WORD").toUpperCase() === "PHRASE" ? "PHRASE" : "WORD",
        tags: strings(fm.tags),
        notes: strings(fm.notes),
        aliases: strings(fm.aliases).map(alias => alias.toLowerCase()),
        sentences,
        date,
        created: epoch(fm.langr_created ?? fm.created, date),
        itemId: text(fm.langr_id) || stableItemId(recordLanguage, expression),
        schemaVersion: WORD_NOTE_SCHEMA,
        language: recordLanguage,
        sourcePath,
        reviewState: normalizeReviewState(fm.langr_review),
    }, recordLanguage);
}

/** Only plugin-owned properties change; the Markdown body is kept byte-for-byte. */
export function mergeWordNote(content: string, input: ExpressionInfo, language: string): string {
    const parsed = splitWordNote(content);
    assertSupportedSchema(parsed.properties);
    const existing = readWordNote(content, language, input.sourcePath || "", input.created ?? input.date);
    const record = normalizeRecord(input, language);
    if (existing && (
        existing.expression !== record.expression || existing.language !== record.language
    )) {
        throw new Error("Vocabulary note belongs to a different expression or language");
    }
    const fm = { ...parsed.properties };
    for (const key of Object.keys(fm)) {
        if (/^(?:sentence|trans|origin|langr_source)\d+$/.test(key)) delete fm[key];
    }
    Object.assign(fm, {
        expression: record.expression,
        meaning: record.meaning,
        status: record.status,
        type: record.t,
        tags: record.tags,
        notes: record.notes,
        aliases: record.aliases,
        date: new Date(record.date * 1000).toISOString(),
        langr_id: text(parsed.properties.langr_id) || record.itemId,
        langr_schema: WORD_NOTE_SCHEMA,
        langr_language: existing?.language || record.language,
        langr_created: existing?.created ?? record.created ?? record.date,
    });
    if (record.reviewState) fm.langr_review = record.reviewState;
    record.sentences.forEach((sentence, index) => {
        const suffix = index + 1;
        fm[`sentence${suffix}`] = sentence.text;
        fm[`trans${suffix}`] = sentence.trans || "";
        fm[`origin${suffix}`] = sentence.origin || "";
        if (sentence.source) fm[`langr_source${suffix}`] = sentence.source;
    });
    return renderWordNote(parsed, fm);
}

/** Non-security filename suffix; collisions are also checked before every write. */
export function wordNoteSuffix(identity: string): string {
    let hash = 2166136261;
    for (let index = 0; index < identity.length; index++) {
        hash ^= identity.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}
