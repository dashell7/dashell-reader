/**
 * Pure utility functions for the review database (MD flashcard file).
 * Kept side-effect-free so they can be unit-tested without Obsidian.
 */

import type { ExpressionInfo, Sentence } from '../db/interface';

// ─── SR progress extraction ──────────────────────────────────────────────────

/**
 * Parse an existing review file and extract spaced-repetition scheduling tags.
 * Returns a map of { expression → "<!--SR:...-->" }.
 *
 * Splits by "#word" section headers so the regex never spans across cards,
 * making it robust to any card content (multi-line meanings, code blocks, etc.).
 */
export function extractSRProgress(text: string): Record<string, string> {
    const progress: Record<string, string> = {};
    // Each card starts with "\n#word\n" (or at the very beginning)
    const sections = text.replace(/\r\n/g, '\n').split(/(?:^|\n)#word\n/);
    for (const section of sections) {
        const wordMatch = /^#### (.+)/m.exec(section);
        const srMatch = /(<!--SR:[^>]+-->)/.exec(section);
        if (wordMatch && srMatch) {
            progress[wordMatch[1].trim()] = srMatch[1];
        }
    }
    return progress;
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
    delimiter: string,
    srProgress: Record<string, string>,
): string {
    const sorted = [...words].sort((a, b) =>
        a.expression.localeCompare(b.expression),
    );
    const cards = sorted.map((w) =>
        buildReviewCard(w, delimiter, srProgress[w.expression]),
    );
    return '#flashcards\n\n' + cards.join('\n') + '\n';
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
