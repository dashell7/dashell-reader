/**
 * Convert vocabulary frontmatter status values from current and legacy
 * releases into the stable numeric status model used by the database.
 */
const LEGACY_STATUS_MAP: Record<string, number> = {
    ignore: 0,
    ignored: 0,
    unknown: 0,
    "未知": 0,
    "已忽略": 0,
    "忽略": 0,
    "无视": 0,
    learning: 1,
    new: 1,
    "新学": 1,
    "新词": 1,
    "学习中": 1,
    familiar: 2,
    "眼熟": 2,
    "熟悉": 2,
    known: 3,
    "了解": 3,
    "已会": 3,
    learned: 4,
    "掌握": 4,
    "已掌握": 4,
};

const clampStatus = (value: number): number => Math.min(4, Math.max(0, Math.trunc(value)));

/**
 * New Learning/Familiar/Learned entries get a full note. New Known/Ignore
 * entries may stay compact; an existing note must survive every status change.
 */
export function shouldPersistWordFile(status: number): boolean {
    return status === 1 || status === 2 || status === 4;
}

export function parseStatusValue(raw: unknown, localizedLabels: string[] = []): number {
    if (typeof raw === "number" && Number.isFinite(raw)) return clampStatus(raw);

    const text = raw == null ? "" : String(raw).trim().toLowerCase();
    if (/^-?\d+$/.test(text)) return clampStatus(Number(text));

    const localized = localizedLabels.findIndex(label =>
        String(label).trim().toLowerCase() === text
    );
    if (localized >= 0) return localized;
    return LEGACY_STATUS_MAP[text] ?? 0;
}
