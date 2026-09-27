import { normalizePath, TFile } from "obsidian";
import type Plugin from "@/plugin";
import type { ExpressionInfo } from "./interface";
import { buildWordFilePath } from "@/utils/wordFile";
import { mergeWordNote, readWordNote, wordNoteSuffix } from "@/utils/wordNoteFormat";
import { normalizeRecord, recordRevision } from "@/utils/vocabularyRecord";

export interface WordNoteSnapshot {
    path: string;
    content: string;
}

/** Vocabulary notes own their body; this service owns only vocabulary properties. */
export class WordNoteStore {
    private writeTail: Promise<void> = Promise.resolve();
    private cache = new Map<string, { mtime: number; size: number; record: ExpressionInfo | null }>();
    private cacheRevision = 0;
    private cacheContext = "";

    constructor(private readonly plugin: Plugin) {}

    invalidate(path?: string): void {
        this.cacheRevision++;
        if (path) this.cache.delete(normalizePath(path));
        else this.cache.clear();
    }

    private folder(): string {
        const folder = normalizePath(this.plugin.settings.word_folder || "");
        if (!folder || folder.startsWith("/") || /^[a-z]:\//i.test(folder) || folder.split("/").includes("..")) {
            throw new Error("Vocabulary folder must be a valid folder inside the vault");
        }
        return folder;
    }

    private files(): TFile[] {
        const prefix = this.folder() + "/";
        const context = prefix + this.plugin.settings.foreign;
        if (context !== this.cacheContext) {
            this.invalidate();
            this.cacheContext = context;
        }
        return this.plugin.app.vault.getMarkdownFiles()
            .filter(file => file.path.startsWith(prefix))
            .sort((a, b) => a.path.localeCompare(b.path));
    }

    private async record(file: TFile): Promise<ExpressionInfo | null> {
        const cached = this.cache.get(file.path);
        const mtime = file.stat?.mtime || 0;
        const size = file.stat?.size || 0;
        if (cached && cached.mtime === mtime && cached.size === size) {
            return cached.record ? normalizeRecord(cached.record, this.plugin.settings.foreign) : null;
        }
        try {
            const revision = this.cacheRevision;
            const content = await this.plugin.app.vault.read(file);
            const record = readWordNote(content, this.plugin.settings.foreign, file.path,
                Math.floor((file.stat?.ctime || file.stat?.mtime || Date.now()) / 1000));
            if (revision === this.cacheRevision) this.cache.set(file.path, { mtime, size, record });
            return record ? normalizeRecord(record, this.plugin.settings.foreign) : null;
        } catch (error) {
            throw new Error(`Could not read vocabulary note ${file.path}: ${(error as Error).message}`);
        }
    }

    async readAll(): Promise<ExpressionInfo[]> {
        await this.writeTail;
        const records: ExpressionInfo[] = [];
        // Bound IO and avoid turning a large vocabulary into an unbounded Promise.all.
        for (const file of this.files()) {
            const record = await this.record(file);
            if (record) records.push(record);
        }
        return records;
    }

    async snapshots(): Promise<WordNoteSnapshot[]> {
        await this.writeTail;
        const result: WordNoteSnapshot[] = [];
        for (const file of this.files()) {
            const content = await this.plugin.app.vault.read(file);
            // Other Markdown notes in this folder are user content outside our backup scope.
            if (readWordNote(content, this.plugin.settings.foreign, file.path,
                Math.floor((file.stat?.ctime || file.stat?.mtime || Date.now()) / 1000))) {
                result.push({ path: file.path, content });
            }
        }
        return result;
    }

    save(payload: ExpressionInfo, createIfMissing: boolean, beforeWrite?: () => void): Promise<void> {
        const record = normalizeRecord(JSON.parse(JSON.stringify(payload)), this.plugin.settings.foreign);
        const operation = this.writeTail.then(() => this.saveNow(record, createIfMissing, beforeWrite))
            .finally(() => this.invalidate());
        this.writeTail = operation.catch((): void => undefined);
        return operation;
    }

    private matches(record: ExpressionInfo | null, payload: ExpressionInfo): boolean {
        return !!record && record.expression === payload.expression && record.language === payload.language;
    }

    private async find(payload: ExpressionInfo): Promise<TFile | null> {
        const files = this.files();
        // A renamed note is located by its stored expression rather than a guessed filename.
        files.sort((a, b) => Number(b.path === payload.sourcePath) - Number(a.path === payload.sourcePath));
        for (const file of files) {
            if (this.matches(await this.record(file), payload)) return file;
        }
        return null;
    }

    private async update(file: TFile, payload: ExpressionInfo, beforeWrite?: () => void): Promise<void> {
        await this.plugin.app.vault.process(file, current => {
            beforeWrite?.();
            const record = readWordNote(current, this.plugin.settings.foreign, file.path,
                Math.floor((file.stat?.ctime || file.stat?.mtime || Date.now()) / 1000));
            if (!this.matches(record, payload)) {
                throw new Error("Vocabulary note identity changed while saving; no content was replaced");
            }
            if (payload.revision && payload.revision !== recordRevision(record)) {
                throw new Error("Vocabulary changed since it was opened; reload it before saving");
            }
            return mergeWordNote(current, { ...payload, created: record.created }, this.plugin.settings.foreign);
        });
    }

    private async ensureFolder(): Promise<void> {
        const parts = this.folder().split("/");
        for (let count = 1; count <= parts.length; count++) {
            const path = parts.slice(0, count).join("/");
            if (this.plugin.app.vault.getAbstractFileByPath(path)) continue;
            try {
                await this.plugin.app.vault.createFolder(path);
            } catch (error) {
                // Another writer may have created this folder in the meantime.
                if (!this.plugin.app.vault.getAbstractFileByPath(path)) throw error;
            }
        }
    }

    private async saveNow(payload: ExpressionInfo, createIfMissing: boolean, beforeWrite?: () => void): Promise<void> {
        const existing = await this.find(payload);
        if (existing) return this.update(existing, payload, beforeWrite);
        if (payload.sourcePath) {
            throw new Error("Vocabulary note was deleted or changed identity; reload it before saving");
        }
        if (!createIfMissing) return;
        await this.ensureFolder();

        const suffix = wordNoteSuffix(payload.itemId!);
        for (let index = 0; index < 1000; index++) {
            const expression = index === 0 ? payload.expression
                : `${payload.expression}--${suffix}${index === 1 ? "" : `-${index}`}`;
            const path = buildWordFilePath(this.folder(), expression);
            const occupied = this.plugin.app.vault.getAbstractFileByPath(path);
            if (occupied) {
                if (occupied instanceof TFile && this.matches(await this.record(occupied), payload)) {
                    return this.update(occupied, payload, beforeWrite);
                }
                continue;
            }
            try {
                beforeWrite?.();
                await this.plugin.app.vault.create(path, mergeWordNote("", payload, this.plugin.settings.foreign));
                return;
            } catch (error) {
                // Creation must never degrade into a blind overwrite on a name collision.
                const concurrent = this.plugin.app.vault.getAbstractFileByPath(path);
                if (!concurrent) throw error;
                if (concurrent instanceof TFile && this.matches(await this.record(concurrent), payload)) {
                    return this.update(concurrent, payload, beforeWrite);
                }
            }
        }
        throw new Error("Could not allocate a unique vocabulary note filename");
    }
}
