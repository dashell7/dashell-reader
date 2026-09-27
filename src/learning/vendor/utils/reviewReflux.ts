/**
 * Review reflux: derive vocabulary status upgrades from Spaced Repetition
 * scheduling tags (`<!--SR:!due,interval,ease...-->`) preserved in review.md.
 *
 * Pure functions only — no Obsidian imports — so the decision logic is
 * unit-testable in isolation. The plugin wiring lives in plugin.ts.
 */

// Status codes (kept in sync with src/utils/status.ts):
// 0 Ignore · 1 Learning · 2 Familiar · 3 Known · 4 Learned
export const REFLUX_STATUS = {
    IGNORE: 0,
    FAMILIAR: 2,
    KNOWN: 3,
    LEARNED: 4,
} as const;

export interface RefluxThresholds {
    /** Interval (days) at which a card counts as Familiar. */
    familiarDays: number;
    /** Interval (days) at which a card counts as Known. */
    knownDays: number;
    /** Interval (days) at which a card counts as Learned. */
    learnedDays: number;
}

export const DEFAULT_REFLUX_THRESHOLDS: RefluxThresholds = {
    familiarDays: 3,
    knownDays: 14,
    learnedDays: 30,
};

/** Persisted evidence consumed by the most recent status decision. */
export interface ReviewState {
    source: "manual" | "review";
    evidence: string;
    reviewPath: string;
    status: number;
    updatedAt: number;
    intervalDays?: number;
}

interface SRSchedule {
    dueDate: string;
    interval: number;
    ease: number;
}

/**
 * Read the same schedule tuple syntax that Spaced Repetition accepts.
 *
 * A tag holds one entry per sub-card (e.g. reversed cards):
 *   <!--SR:!2026-09-25,5,270!2026-09-26,6,250-->
 * Each entry is `!dueDate,interval,ease` — this matches the spaced
 * repetition plugin's own reader: /!(\d{4}-\d{2}-\d{2}),(\d+),(\d+)/.
 */
function parseSRSchedules(srTag: string): SRSchedule[] {
    if (!srTag) return [];
    const schedules: SRSchedule[] = [];
    const re = /!(\d{4}-\d{2}-\d{2}),(\d+),(\d+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(srTag)) !== null) {
        const interval = parseInt(match[2], 10);
        const ease = parseInt(match[3], 10);
        if (Number.isFinite(interval) && Number.isFinite(ease)) {
            schedules.push({ dueDate: match[1], interval, ease });
        }
    }
    return schedules;
}

/** Parse one `<!--SR:...-->` tag into its scheduling intervals (days). */
export function parseSRTagIntervals(srTag: string): number[] {
    return parseSRSchedules(srTag).map((schedule) => schedule.interval);
}

/**
 * Canonical evidence for all sub-cards, including due date and ease so a new
 * review can be recognized even when its interval stays the same. Order,
 * numeric padding and surrounding comment formatting are immaterial.
 */
export function reviewEvidence(srTag: string): string {
    return parseSRSchedules(srTag)
        .map(({ dueDate, interval, ease }) => `!${dueDate},${interval},${ease}`)
        .sort()
        .join("");
}

/**
 * Map an interval (days) to a status upgrade target, or null when the
 * interval is below every threshold (card still young — keep learning).
 */
export function statusForInterval(
    intervalDays: number,
    thresholds: RefluxThresholds,
): number | null {
    if (intervalDays >= thresholds.learnedDays) return REFLUX_STATUS.LEARNED;
    if (intervalDays >= thresholds.knownDays) return REFLUX_STATUS.KNOWN;
    if (intervalDays >= thresholds.familiarDays) return REFLUX_STATUS.FAMILIAR;
    return null;
}

export interface RefluxChange {
    expression: string;
    from: number;
    to: number;
    /** Effective interval driving the upgrade (min across sub-cards). */
    intervalDays: number;
    /** Canonical schedule evidence to consume together with this upgrade. */
    evidence: string;
}

/**
 * Decide which words should be upgraded from SR scheduling progress.
 *
 * Rules:
 * - Never touches Ignore (0): the user explicitly excluded the word.
 * - Upgrade only — never downgrades a word, even if a card lapses.
 * - Words without an SR tag (never reviewed) are left untouched.
 * - Evidence already consumed by a manual or automatic status decision in
 *   this review file is not replayed, including after threshold changes.
 * - Multi-entry cards use the MIN interval: every sub-card must have
 *   matured before the word counts as known.
 * - Case-insensitive expression matching, mirroring how word lookups
 *   behave elsewhere in the plugin.
 */
export function planRefluxUpdates(
    words: Array<{ expression: string; status: number; reviewState?: ReviewState }>,
    srProgress: Record<string, string>,
    thresholds: RefluxThresholds,
    reviewPath: string = "",
): RefluxChange[] {
    // Index SR tags by lowercase expression for case-insensitive matching.
    const progressByLower: Record<string, string> = {};
    for (const [expr, tag] of Object.entries(srProgress)) {
        progressByLower[expr.toLowerCase()] = tag;
    }

    const changes: RefluxChange[] = [];
    for (const word of words) {
        if (!word.expression || word.status === REFLUX_STATUS.IGNORE) continue;
        const tag = progressByLower[word.expression.toLowerCase()];
        if (!tag) continue;
        const intervals = parseSRTagIntervals(tag);
        if (intervals.length === 0) continue;
        const evidence = reviewEvidence(tag);
        if (word.reviewState?.reviewPath === reviewPath && word.reviewState.evidence === evidence) continue;
        const minInterval = Math.min(...intervals);
        const target = statusForInterval(minInterval, thresholds);
        if (target !== null && target > word.status) {
            changes.push({
                expression: word.expression,
                from: word.status,
                to: target,
                intervalDays: minInterval,
                evidence,
            });
        }
    }
    return changes;
}

/**
 * Clamp a threshold value into a sane range: integer days in [1, 365].
 */
export function normalizeRefluxDays(value: unknown, fallback: number): number {
    const num = typeof value === "number" ? value : parseInt(String(value), 10);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(365, Math.max(1, Math.trunc(num)));
}

/**
 * Normalize the three thresholds as a group, enforcing
 * familiar <= known <= learned by clamping upward.
 */
export function normalizeRefluxThresholds(
    input: Partial<RefluxThresholds> | undefined,
    fallback: RefluxThresholds = DEFAULT_REFLUX_THRESHOLDS,
): RefluxThresholds {
    const familiarDays = normalizeRefluxDays(input?.familiarDays, fallback.familiarDays);
    const knownDays = Math.max(
        normalizeRefluxDays(input?.knownDays, fallback.knownDays),
        familiarDays,
    );
    const learnedDays = Math.max(
        normalizeRefluxDays(input?.learnedDays, fallback.learnedDays),
        knownDays,
    );
    return { familiarDays, knownDays, learnedDays };
}
