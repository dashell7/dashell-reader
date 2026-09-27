/**
 * MDict MDX/MDD Parser — powered by js-mdict library
 *
 * Supports MDX format v1 (engine 1.x) and v2 (engine 2.x+),
 * including encrypted dictionaries (Encrypted=2).
 * Automatically loads all companion .mdd resource files:
 *   dict.mdd, dict.1.mdd, dict.2.mdd, dict.3.mdd, ...
 * Also loads standalone CSS files (dict.css) if present.
 *
 * Runs in Electron (Obsidian desktop) using Node.js built-ins.
 */

import { MDX, MDD } from 'js-mdict';
import { Platform } from 'obsidian';

// ─── types ─────────────────────────────────────────────────────────────────

export interface MdictHeader {
    title: string;
    description: string;
    encoding: string;
    encrypted: number;
    format: string;
    generatedByEngineVersion: number;
    version: 1 | 2;
}

// ─── parser ────────────────────────────────────────────────────────────────

export class MdictParser {
    private filePath: string;
    private mdxInstance: any = null;
    /** All loaded MDD instances (dict.mdd, dict.1.mdd, dict.2.mdd, ...) */
    private mddInstances: any[] = [];
    /** Map of filename (lowercase) → full MDD key, for fuzzy resource lookup */
    private mddKeyIndex: Map<string, { key: string; mddIdx: number }> = new Map();
    /** Standalone CSS content loaded from dict.css (if present) */
    private standaloneCss: string | null = null;
    private headerInfo: MdictHeader | null = null;
    private loaded = false;
    /** True if at least one companion .mdd file was found and loaded */
    hasMdd = false;

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    // ── public API ──────────────────────────────────────────────────────────

    /** Load and index the .mdx file (and all .mdd files if present). Idempotent. */
    async load(): Promise<void> {
        if (this.loaded) return;
        if (!Platform.isDesktopApp) {
            this.loaded = true;
            return;
        }

        this.mdxInstance = new MDX(this.filePath);

        // Auto-detect all companion .mdd files
        // Pattern: dict.mdd, dict.1.mdd, dict.2.mdd, dict.3.mdd, ...
        const fs = require('fs');
        const basePath = this.filePath.replace(/\.mdx$/i, '');

        // Load primary .mdd
        const primaryMdd = basePath + '.mdd';
        if (fs.existsSync(primaryMdd)) {
            try {
                this.mddInstances.push(new MDD(primaryMdd));
            } catch (e) {
                // console.warn(`[MDict] Failed to load MDD: ${primaryMdd}`, e);
            }
        }

        // Load numbered .mdd files: .1.mdd, .2.mdd, .3.mdd, ...
        for (let i = 1; i <= 20; i++) {
            const numberedMdd = `${basePath}.${i}.mdd`;
            if (!fs.existsSync(numberedMdd)) break;
            try {
                this.mddInstances.push(new MDD(numberedMdd));
            } catch (e) {
                // console.warn(`[MDict] Failed to load MDD: ${numberedMdd}`, e);
            }
        }

        this.hasMdd = this.mddInstances.length > 0;

        // Build filename index for all MDD resources
        if (this.hasMdd) {
            this.mddInstances.forEach((mdd, mddIdx) => {
                const keyList = mdd.keywordList || [];
                for (const entry of keyList) {
                    const keyText = entry.keyText || '';
                    // Extract filename from path (e.g. "\scripts\full.min.js" → "full.min.js")
                    const parts = keyText.split('\\');
                    const filename = parts[parts.length - 1].toLowerCase();
                    if (filename && !this.mddKeyIndex.has(filename)) {
                        this.mddKeyIndex.set(filename, { key: keyText, mddIdx });
                    }
                    // Also index the full path (lowercase)
                    const fullKey = keyText.toLowerCase();
                    if (!this.mddKeyIndex.has(fullKey)) {
                        this.mddKeyIndex.set(fullKey, { key: keyText, mddIdx });
                    }
                }
            });
            // console.log(`[MDict] Built MDD key index: ${this.mddKeyIndex.size} entries`);
        }

        // Load standalone CSS file (dict.css)
        const cssPath = basePath + '.css';
        if (fs.existsSync(cssPath)) {
            try {
                this.standaloneCss = fs.readFileSync(cssPath, 'utf8');
            } catch {
                // ignore
            }
        }

        // Extract header info
        const header = this.mdxInstance.header || {};
        const engineVer = parseFloat(
            header.GeneratedByEngineVersion || header.generatedByEngineVersion || '2'
        );

        this.headerInfo = {
            title: header.Title || header.title || '',
            description: header.Description || header.description || '',
            encoding: header.Encoding || header.encoding || 'UTF-8',
            encrypted: parseInt(header.Encrypted || header.encrypted || '0'),
            format: header.Format || header.format || 'html',
            generatedByEngineVersion: engineVer,
            version: engineVer >= 2.0 ? 2 : 1,
        };

        if (this.hasMdd || this.standaloneCss) {
            // console.log(`[MDict] "${this.headerInfo.title}": loaded ${this.mddInstances.length} MDD file(s)${this.standaloneCss ? ' + standalone CSS' : ''}`);
        }

        this.loaded = true;
    }

    /** Look up a word, return its HTML definition or null. */
    async lookup(word: string): Promise<string | null> {
        if (!this.loaded) await this.load();
        if (!this.mdxInstance) return null;

        try {
            const result = this.mdxInstance.lookup(word.trim());
            if (!result || !result.definition) return null;

            let def = result.definition as string;

            // Handle @@@LINK= redirects (max 5 hops to prevent loops)
            let hops = 0;
            while (def.startsWith('@@@LINK=') && hops < 5) {
                const target = def.replace('@@@LINK=', '').trim();
                if (!target) return null;
                const linked = this.mdxInstance.lookup(target);
                if (!linked || !linked.definition) return null;
                def = linked.definition;
                hops++;
            }

            return def;
        } catch {
            return null;
        }
    }

    /**
     * Look up a resource from companion .mdd files.
     * Searches all loaded MDD files in order (primary first, then numbered).
     * Returns the resource as a Buffer, or null if not found.
     *
     * @param key — resource key, e.g. "\\abc.png" or "\\word.mp3"
     */
    lookupResource(key: string): Buffer | null {
        // Strategy 1: Try exact locate across all MDD instances
        for (const mdd of this.mddInstances) {
            try {
                const result = mdd.locate(key);
                if (result?.definition) {
                    return this._extractMddResult(result);
                }
            } catch {
                // continue
            }
        }

        // Strategy 2: Use filename index (handles path mismatches like
        //   HTML references "oaldpe.js" but MDD stores "\scripts\full.min.js")
        const cleanKey = key.replace(/^[\\./]+/, '').toLowerCase();
        // Try full path match first
        const indexEntry = this.mddKeyIndex.get('\\' + cleanKey)
            || this.mddKeyIndex.get(cleanKey);
        if (indexEntry) {
            try {
                const mdd = this.mddInstances[indexEntry.mddIdx];
                if (!mdd) return null;
                const result = mdd.locate(indexEntry.key);
                if (result?.definition) {
                    return this._extractMddResult(result);
                }
                // Fallback: direct record read
                const kw = (mdd.keywordList || []).find(
                    (k: any) => k.keyText === indexEntry.key
                );
                if (kw) {
                    const buf = mdd.lookupRecordByKeyBlock(kw);
                    if (buf && Buffer.isBuffer(buf)) return buf;
                }
            } catch {
                // continue
            }
        }

        // Strategy 3: Try filename-only match (basename)
        const basename = cleanKey.split(/[/\\]/).pop()?.toLowerCase() || '';
        if (basename && basename !== cleanKey) {
            const baseEntry = this.mddKeyIndex.get(basename);
            if (baseEntry && this.mddInstances[baseEntry.mddIdx]) {
                try {
                    const mdd = this.mddInstances[baseEntry.mddIdx];
                    const result = mdd.locate(baseEntry.key);
                    if (result?.definition) {
                        return this._extractMddResult(result);
                    }
                    const kw = (mdd.keywordList || []).find(
                        (k: any) => k.keyText === baseEntry.key
                    );
                    if (kw) {
                        const buf = mdd.lookupRecordByKeyBlock(kw);
                        if (buf && Buffer.isBuffer(buf)) return buf;
                    }
                } catch {
                    // continue
                }
            }
        }

        return null;
    }

    private _extractMddResult(result: any): Buffer | null {
        const def = result.definition;
        if (typeof def === 'string') return Buffer.from(def, 'base64');
        if (Buffer.isBuffer(def)) return def;
        return null;
    }



    /** Return standalone CSS content (from dict.css) or null */
    getStandaloneCss(): string | null {
        return this.standaloneCss;
    }

    /** Return the header (available after load()). */
    getHeader(): MdictHeader | null {
        return this.headerInfo;
    }

    /** Release all loaded resources to free memory. */
    dispose(): void {
        this.mddInstances.length = 0;
        this.mddKeyIndex.clear();
        this.standaloneCss = null;
        this.headerInfo = null;
        this.hasMdd = false;
    }
}
