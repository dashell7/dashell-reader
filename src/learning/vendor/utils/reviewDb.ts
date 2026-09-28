/**
 * Pure utility functions for the review database (MD flashcard file).
 * Kept side-effect-free so they can be unit-tested without Obsidian.
 */

import type { ExpressionInfo, Sentence } from '../db/interface';

const MANAGED_END = '<!-- qiaomu-reader-english:review:end -->';
const MANAGED_START = /^<!-- qiaomu-reader-english:review:start sha256=([a-f0-9]{64}) -->\r?$/gm;

type ReviewFormat = { tag: string; delimiter: string };
type ReviewProgressSnapshot = {
    status: 'managed' | 'unmanaged' | 'invalid';
    progress: Record<string, string>;
};
export const REVIEW_INTEGRITY_ERROR_CODE = 'review-invalid';

export class ReviewIntegrityError extends Error {
    readonly code = REVIEW_INTEGRITY_ERROR_CODE;
}

export type ReviewSyncResult = {
    status: 'created' | 'migrated' | 'updated' | 'unchanged' | 'conflict';
    text: string;
    preservedSR: number;
    reason?: 'unowned' | 'managed-edited' | 'markers' | 'duplicate';
};

function normalized(text: string): string {
    return text.replace(/\r\n/g, '\n');
}

// SR owns only scheduling comments. Ignore those when verifying that the
// plugin-generated region has not been edited by a person or another plugin.
function withoutSchedules(text: string): string {
    return normalized(text)
        .replace(/^[ \t]*<!--SR:[^>\n]*-->[ \t]*\n?/gm, '')
        .replace(/[ \t]*<!--SR:[^>\n]*-->/g, '')
        .trimEnd();
}

async function generatedDigest(text: string): Promise<string> {
    const bytes = new TextEncoder().encode(withoutSchedules(text));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function cardWords(text: string): string[] {
    const words: string[] = [];
    const re = /(?:^|\n)#word\n#### ([^\n]+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(normalized(text))) !== null) words.push(match[1].trim().toLowerCase());
    return words;
}

function inspectCards(text: string): { progress: Record<string, string>; reason?: 'duplicate' | 'managed-edited' } {
    const progress: Record<string, string> = Object.create(null);
    const seen = new Set<string>();
    const sections = normalized(text).split(/(?:^|\n)#word\n/);
    if (sections[0].includes('<!--SR:')) return { progress, reason: 'managed-edited' };
    for (const section of sections.slice(1)) {
        const wordMatch = /^#### ([^\n]+)/.exec(section);
        if (!wordMatch) return { progress, reason: 'managed-edited' };
        const word = wordMatch[1].trim();
        const key = word.toLowerCase();
        if (seen.has(key)) return { progress, reason: 'duplicate' };
        seen.add(key);
        const schedules = [...section.matchAll(/<!--SR:[^>\n]+-->/g)];
        // SR owns one scheduling comment per card. More than one could make
        // picking a schedule arbitrary and silently discard review progress.
        if (schedules.length > 1 || (section.match(/<!--SR:/g) || []).length !== schedules.length) {
            return { progress, reason: 'managed-edited' };
        }
        if (schedules.length === 1) progress[word] = schedules[0][0];
    }
    return { progress };
}

function managedRegion(text: string) {
    const starts = [...text.matchAll(MANAGED_START)];
    const ends = [...text.matchAll(/^<!-- qiaomu-reader-english:review:end -->\r?$/gm)];
    if (!starts.length && !ends.length) return null;
    if (starts.length !== 1 || ends.length !== 1) return false;
    const start = starts[0];
    const end = ends[0];
    const bodyStart = (start.index || 0) + start[0].length + 1;
    if (text[bodyStart - 1] !== '\n' || end.index === undefined || end.index < bodyStart) return false;
    return {
        start: start.index || 0,
        // Keep the original line ending outside the replaceable block.
        end: end.index + end[0].length - (end[0].endsWith('\r') ? 1 : 0),
        body: text.slice(bodyStart, end.index),
        digest: start[1],
    };
}

/** Distinguish an absent legacy marker from a damaged managed section. */
export async function readReviewProgress(text: string): Promise<ReviewProgressSnapshot> {
    const region = managedRegion(text);
    if (!region) {
        return {
            status: region === false || text.includes('qiaomu-reader-english:review:') ? 'invalid' : 'unmanaged',
            progress: {},
        };
    }
    if (await generatedDigest(region.body) !== region.digest) return { status: 'invalid', progress: {} };
    const inspected = inspectCards(region.body);
    return inspected.reason
        ? { status: 'invalid', progress: {} }
        : { status: 'managed', progress: inspected.progress };
}

/** Only intact plugin-owned cards may drive automatic status updates. */
export async function extractSRProgress(text: string): Promise<Record<string, string>> {
    return (await readReviewProgress(text)).progress;
}

/**
 * Prepare a full vocabulary sync without touching text outside the managed
 * region. The hash rejects hand edits inside that region, while SR comments
 * may change. A legacy whole-file export is adopted only when it exactly
 * matches the old generator apart from SR comments and trailing whitespace.
 */
export async function prepareReviewSync(
    current: string,
    words: ExpressionInfo[],
    format: ReviewFormat,
    legacyFormats: ReviewFormat[],
): Promise<ReviewSyncResult> {
    const region = managedRegion(current);
    if (region === false) return { status: 'conflict', text: current, preservedSR: 0, reason: 'markers' };
    const wordKeys = new Set(words.map(word => word.expression.trim().toLowerCase()));
    if (wordKeys.size !== words.length) {
        return { status: 'conflict', text: current, preservedSR: 0, reason: 'duplicate' };
    }
    let progress: Record<string, string> = {};
    let status: ReviewSyncResult['status'];
    let before = '';
    let after = '';
    if (region) {
        if (await generatedDigest(region.body) !== region.digest) {
            return { status: 'conflict', text: current, preservedSR: 0, reason: 'managed-edited' };
        }
        const inspected = inspectCards(region.body);
        if (inspected.reason) return { status: 'conflict', text: current, preservedSR: 0, reason: inspected.reason };
        before = current.slice(0, region.start);
        after = current.slice(region.end);
        if (cardWords(before + after).some(word => wordKeys.has(word))) {
            return { status: 'conflict', text: current, preservedSR: 0, reason: 'duplicate' };
        }
        progress = inspected.progress;
        status = 'updated';
    } else if (!current.trim()) {
        status = 'created';
    } else {
        const inspected = inspectCards(current);
        if (inspected.reason) return { status: 'conflict', text: current, preservedSR: 0, reason: inspected.reason };
        progress = inspected.progress;
        const knownExport = legacyFormats.some(legacy =>
            withoutSchedules(current) === withoutSchedules(buildReviewFileContent(words, legacy, progress))
        );
        if (!knownExport) return { status: 'conflict', text: current, preservedSR: 0, reason: 'unowned' };
        status = 'migrated';
    }
    const newline = current.includes('\r\n') ? '\r\n' : '\n';
    const body = buildReviewFileContent(words, format, progress).replace(/\n/g, newline);
    const digest = await generatedDigest(body);
    const block = `<!-- qiaomu-reader-english:review:start sha256=${digest} -->${newline}${body}${MANAGED_END}`;
    const text = region ? `${before}${block}${after}` : `${block}${newline}`;
    return {
        status: text === current ? 'unchanged' : status,
        text,
        preservedSR: words.filter(word => Object.keys(progress).some(key => key.toLowerCase() === word.expression.toLowerCase())).length,
    };
}

// ─── Card builder ─────────────────────────────────────────────────────────────

/**
 * Build a single flashcard block for one word.
 * Preserves the SR scheduling tag from a previous sync if provided.
 */
export function buildReviewCard(
    word: ExpressionInfo,
    delimiter: string,
    srTag?: string,
): string {
    const notes =
        !word.notes?.length
            ? ''
            : '**Notes**:\n' + word.notes.join('\n').trim() + '\n';

    const sentences =
        !word.sentences?.length
            ? ''
            : '**Sentences**:\n' +
              word.sentences
                  .map((sen: Sentence) => {
                      const text = `*${(sen.text || '').trim()}*`;
                      const trans = sen.trans ? sen.trans.trim() + '\n' : '';
                      const origin = sen.origin ? sen.origin.trim() : '';
                      return text + '\n' + trans + origin;
                  })
                  .join('\n')
                  .trim() +
              '\n';

    const sr = srTag ? srTag + '\n' : '';
    return `#word\n#### ${word.expression}\n${delimiter}\n${word.meaning}\n${notes}${sentences}${sr}`;
}

// ─── File builder ─────────────────────────────────────────────────────────────

/**
 * Build the full review file content from a list of words.
 * - Words are sorted alphabetically.
 * - SR progress from the previous file is re-attached to each card.
 */
export function buildReviewFileContent(
    words: ExpressionInfo[],
    format: { tag: string; delimiter: string },
    srProgress: Record<string, string>,
): string {
    const schedules = new Map<string, string>();
    const ambiguous = new Set<string>();
    for (const [expression, tag] of Object.entries(srProgress)) {
        const key = expression.toLowerCase();
        if (schedules.has(key)) ambiguous.add(key);
        else schedules.set(key, tag);
    }
    const sorted = [...words].sort((a, b) =>
        a.expression.localeCompare(b.expression),
    );
    const cards = sorted.map((w) =>
        buildReviewCard(w, format.delimiter, ambiguous.has(w.expression.toLowerCase())
            ? undefined : schedules.get(w.expression.toLowerCase())),
    );
    return format.tag + '\n\n' + cards.join('\n') + '\n';
}

// ─── Deduplication ───────────────────────────────────────────────────────────

/**
 * Remove duplicate words (same expression). First occurrence wins.
 * Needed because FileDb merges IndexedDB + file-based sources which may overlap.
 */
export function deduplicateWords(words: ExpressionInfo[]): ExpressionInfo[] {
    const seen = new Set<string>();
    return words.filter((w) => {
        if (seen.has(w.expression)) return false;
        seen.add(w.expression);
        return true;
    });
}
