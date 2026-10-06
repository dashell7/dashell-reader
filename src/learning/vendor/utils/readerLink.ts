/** Reader-owned protocol links are stored separately from editable origin text. */
export function normalizeReaderLink(value: unknown): string | undefined {
    if (value == null || value === "") return undefined;
    if (typeof value !== "string" || value.length > 8192) throw new Error("Invalid reader link; keep the original vocabulary unchanged");
    try {
        const url = new URL(value);
        const keys = [...url.searchParams.keys()];
        const allowed = new Set(["vault", "book", "cfi", "block", "page", "highlight"]);
        const book = url.searchParams.get("book") || "";
        const vault = url.searchParams.get("vault") || "";
        const block = url.searchParams.get("block");
        const page = url.searchParams.get("page");
        const cfi = url.searchParams.get("cfi");
        const anchored = (cfi != null && cfi.startsWith("epubcfi(") && cfi.endsWith(")"))
            || (block != null && /^(?:0|[1-9]\d*)$/.test(block))
            || (page != null && /^[1-9]\d*$/.test(page));
        if (url.protocol !== "obsidian:" || !["dashell-reader", "qiaomu-reader-english"].includes(url.hostname)
            || url.pathname !== "" || url.hash || url.username || url.password
            || !vault || vault.length > 255 || !book || book.length > 4096
            || /[\x00-\x1f\x7f]/.test(book) || book.startsWith("/") || book.includes("\\")
            || book.split("/").some(part => !part || part === "." || part === "..")
            || keys.length !== new Set(keys).size || keys.some(key => !allowed.has(key)) || !anchored) {
            throw new Error("Invalid reader link");
        }
        return value;
    } catch {
        throw new Error("Invalid reader link; keep the original vocabulary unchanged");
    }
}
