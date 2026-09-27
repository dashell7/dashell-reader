export interface SentenceSource {
    version: 1;
    path: string;
    quote: string;
    /** UTF-16 offset in the original Markdown, used only as capture evidence. */
    offset: number;
    prefix: string;
    suffix: string;
}

const MAX_QUOTE = 4096;
const MAX_CONTEXT = 80;
const whitespace = (value: string): string => value.replace(/\s+/g, ' ');

function validPath(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 4096
        && /\.md$/i.test(value) && !/[\\<>:"|?*\x00-\x1f\x7f]/.test(value)
        && !value.split('/').some(part => !part || part === '.' || part === '..');
}

/** Invalid or future provenance is rejected instead of silently losing a source during a save. */
export function normalizeSentenceSource(value: unknown): SentenceSource | undefined {
    if (value == null) return undefined;
    const source = value as SentenceSource;
    if (typeof source !== 'object' || Array.isArray(source) || source.version !== 1
        || !validPath(source.path) || typeof source.quote !== 'string'
        || !source.quote.trim() || source.quote.length > MAX_QUOTE
        || !Number.isSafeInteger(source.offset) || source.offset < 0
        || typeof source.prefix !== 'string' || source.prefix.length > MAX_CONTEXT
        || typeof source.suffix !== 'string' || source.suffix.length > MAX_CONTEXT) {
        throw new Error('Invalid or unsupported sentence source; keep the original vocabulary unchanged');
    }
    return { version: 1, path: source.path, quote: whitespace(source.quote).trim(), offset: source.offset,
        prefix: whitespace(source.prefix), suffix: whitespace(source.suffix) };
}
