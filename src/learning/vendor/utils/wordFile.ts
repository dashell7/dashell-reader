import { normalizePath } from "obsidian";

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function sanitizeExpressionFilename(expression: string): string {
    const normalized = (expression ?? "")
        .replace(INVALID_FILENAME_CHARS, " ")
        .replace(/\.\./g, " ")
        .replace(/\s+/g, " ")
        .replace(/\.+$/g, "")
        .trim();

    const safeName = normalized || "word";
    if (WINDOWS_RESERVED_NAMES.test(safeName)) {
        return `${safeName}_word`;
    }
    return safeName;
}

export function buildWordFilePath(wordFolder: string, expression: string): string {
    const folder = normalizePath(wordFolder || "");
    const fileName = sanitizeExpressionFilename(expression);
    return normalizePath(`${folder}/${fileName}.md`);
}
