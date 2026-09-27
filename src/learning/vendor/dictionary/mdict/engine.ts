/**
 * MDict Engine
 *
 * Wraps MdictParser to provide the same search interface as other
 * dictionary engines in this plugin (SearchFunction → DictSearchResult).
 *
 * Each MDict file registered by the user gets its own MdictEngine instance.
 * Instances are cached in the plugin and shared between searches.
 */

import { MdictParser } from './parser';
import type { DictSearchResult } from '../helpers';
import { logger } from '@/utils/logger';

export interface MdictResult {
    /** The HTML definition string from the .mdx file */
    html: string;
    /** Name of the dictionary this result came from */
    dictName: string;
    /** True if the definition is plain text rather than HTML */
    isPlainText: boolean;
}

export type MdictSearchResult = DictSearchResult<MdictResult>;

/**
 * Per-file engine instance.
 * Construction is cheap; parsing is deferred until the first `search()` call.
 */
export class MdictEngine {
    private parser: MdictParser;
    private name: string;
    private loading: Promise<void> | null = null;
    private loadState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
    /** Set to an error message string if the .mdx file failed to load. */
    loadError: string | null = null;

    constructor(filePath: string, name: string) {
        this.parser = new MdictParser(filePath);
        this.name = name;
    }

    /** Eagerly trigger index loading (call this on plugin start for faster first lookup). */
    preload(): void {
        if (!this.loading) {
            this.loadState = 'loading';
            this.loading = this.parser.load().catch(err => {
                this.loadError = err?.message ?? String(err);
                this.loadState = 'error';
                // console.warn(`[MDict] Failed to preload "${this.name}":`, err);
            });
            void this.loading.then(() => {
                if (!this.loadError) this.loadState = 'ready';
            });
        }
    }

    /** Search for a word. Returns null result (not throws) on any failure. */
    async search(word: string): Promise<MdictSearchResult | null> {
        try {
            if (!this.loading) {
                this.loadState = 'loading';
                this.loading = this.parser.load().catch(err => {
                    this.loadError = err?.message ?? String(err);
                    this.loadState = 'error';
                    throw err;
                });
            }
            await this.loading;

            // If preload() swallowed the error, loadError is set but the promise resolved
            if (this.loadError) return null;
            this.loadState = 'ready';
        } catch (err) {
            this.loadState = 'error';
            return null;
        }

        try {
            const html = await this.parser.lookup(word);
            if (!html) return null;

            const header = this.parser.getHeader();
            const isPlainText =
                !html.trimStart().startsWith('<') ||
                (header?.format?.toLowerCase() === 'text');

            return {
                result: {
                    html,
                    dictName: this.name,
                    isPlainText,
                }
            };
        } catch (err) {
            logger.error(`[MDict] Lookup failed for "${word}" in "${this.name}":`, err);
            return null;
        }
    }

    getName(): string {
        return this.name;
    }

    getStatus(): 'idle' | 'loading' | 'ready' | 'error' {
        return this.loadState;
    }

    /** Whether this dictionary has a companion .mdd resource file */
    hasMdd(): boolean {
        return this.parser.hasMdd;
    }

    /** Look up a resource from the .mdd file(s) (images, audio, CSS). Returns Buffer or null. */
    lookupResource(key: string): Buffer | null {
        return this.parser.lookupResource(key);
    }

    /** Return standalone CSS (from dict.css file) or null */
    getStandaloneCss(): string | null {
        return this.parser.getStandaloneCss();
    }

    /** Release parser resources (MDD instances, key index, etc.) */
    dispose(): void {
        this.parser.dispose();
        this.loading = null;
        this.loadError = null;
        this.loadState = 'idle';
    }
}

/**
 * Global registry: dict id → engine instance.
 * Populated by initMdictEngines() called from plugin.ts.
 */
const registry = new Map<string, MdictEngine>();

export function registerMdictEngine(id: string, engine: MdictEngine): void {
    registry.set(id, engine);
}

export function getMdictEngine(id: string): MdictEngine | undefined {
    return registry.get(id);
}

export function clearMdictEngines(): void {
    registry.forEach(engine => engine.dispose());
    registry.clear();
}

export function listMdictEngineIds(): string[] {
    return [...registry.keys()];
}
