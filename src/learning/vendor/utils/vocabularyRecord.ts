import type { ExpressionInfo, ExpressionInfoSimple } from "@/db/interface";
import type { ReviewState } from "./reviewReflux";
import { normalizeSentenceSource } from "./sentenceSource";
import { normalizeReaderLink } from "./readerLink";

export const VOCABULARY_SCHEMA = 1;
export const expressionKey = (expression: string): string => expression.trim().toLowerCase();

/** Missing metadata is a supported legacy record; malformed metadata must not erase a manual choice. */
export function normalizeReviewState(value: unknown): ReviewState | undefined {
    if (value == null) return undefined;
    const state = value as ReviewState;
    if (typeof state !== "object" || Array.isArray(state)
        || !["manual", "review"].includes(state.source)
        || typeof state.evidence !== "string" || typeof state.reviewPath !== "string"
        || !Number.isInteger(state.status) || state.status < 0 || state.status > 4
        || !Number.isFinite(state.updatedAt) || state.updatedAt < 0
        || (state.source === "review" && (!state.evidence || !Number.isFinite(state.intervalDays)))
        || (state.intervalDays != null && (!Number.isFinite(state.intervalDays) || state.intervalDays < 0))) {
        throw new Error("Invalid vocabulary review history; keep the original record unchanged");
    }
    return { source: state.source, evidence: state.evidence, reviewPath: state.reviewPath,
        status: state.status, updatedAt: state.updatedAt,
        ...(state.intervalDays != null ? { intervalDays: state.intervalDays } : {}) };
}

/** Reversible identity: unlike sanitized filenames, distinct expressions cannot collide. */
export function stableItemId(language: string, expression: string): string {
    return `ll1:${encodeURIComponent(language.trim().toLowerCase())}:${encodeURIComponent(expressionKey(expression))}`;
}

export function normalizeRecord(input: ExpressionInfo, language: string): ExpressionInfo {
    if (!input || typeof input.expression !== "string" || !input.expression.trim()) {
        throw new Error("Vocabulary record has no expression");
    }
    if (input.schemaVersion != null && (!Number.isInteger(input.schemaVersion)
        || input.schemaVersion < 0 || input.schemaVersion > VOCABULARY_SCHEMA)) {
        throw new Error("Vocabulary data was written by a newer plugin; keep it unchanged");
    }
    if (!Number.isInteger(input.status) || input.status < 0 || input.status > 4) {
        throw new Error("Invalid vocabulary status");
    }
    const now = Math.floor(Date.now() / 1000);
    // The existing manual-entry form supplies Date.now(), while storage and statistics use seconds.
    const seconds = (value: number, fallback: number) => Number.isFinite(value)
        ? Math.floor(value > 100000000000 ? value / 1000 : value) : fallback;
    const date = seconds(input.date, now);
    const recordLanguage = (input.language || language || "en").trim().toLowerCase();
    return {
        ...input,
        reviewState: normalizeReviewState(input.reviewState),
        expression: expressionKey(input.expression),
        itemId: input.itemId || stableItemId(recordLanguage, input.expression),
        schemaVersion: VOCABULARY_SCHEMA,
        language: recordLanguage,
        created: seconds(input.created, date),
        date,
        meaning: input.meaning || "",
        t: input.t === "PHRASE" ? "PHRASE" : "WORD",
        tags: [...(input.tags || [])],
        notes: [...(input.notes || [])],
        aliases: [...(input.aliases || [])].map(expressionKey),
        sentences: (input.sentences || []).map(sentence => {
            const { source: storedSource, readerLink: storedReaderLink, ...content } = sentence;
            const source = normalizeSentenceSource(storedSource);
            const readerLink = normalizeReaderLink(storedReaderLink);
            return { ...content, ...(source ? { source } : {}), ...(readerLink ? { readerLink } : {}) };
        }),
    };
}

export function simplifyRecord(record: ExpressionInfo): ExpressionInfoSimple {
    const { sentences, notes, ...rest } = record;
    return { ...rest, sen_num: sentences.length, note_num: notes.length };
}

/** Optimistic concurrency token for plugin-owned values; user Markdown is deliberately excluded. */
export function recordRevision(record: ExpressionInfo): string {
    return JSON.stringify([record.itemId, record.expression, record.language, record.status, record.meaning,
        record.t, record.tags, record.notes, record.aliases, record.sentences, record.date, record.reviewState]);
}
