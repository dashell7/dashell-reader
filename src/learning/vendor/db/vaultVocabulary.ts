import { TFile, normalizePath, type Vault } from "obsidian";
import type { ExpressionInfo } from "./interface";
import { normalizeRecord, stableItemId, VOCABULARY_SCHEMA } from "@/utils/vocabularyRecord";

export interface VocabularyLedger {
    schemaVersion: number;
    records: ExpressionInfo[];
    legacyImports: string[];
}

export function parseLedger(text: string, language: string): VocabularyLedger {
    const value = JSON.parse(text);
    if (value?.schemaVersion !== VOCABULARY_SCHEMA || !Array.isArray(value.records)
        || !Array.isArray(value.legacyImports) || value.legacyImports.some((v: unknown) => typeof v !== "string")) {
        throw new Error("Vocabulary storage is damaged or uses a newer format; it was not overwritten");
    }
    const ids = new Set<string>();
    const keys = new Set<string>();
    const records = value.records.map((record: ExpressionInfo) => {
        if (!Array.isArray(record.tags) || !Array.isArray(record.notes) || !Array.isArray(record.sentences)
            || !Array.isArray(record.aliases)) throw new Error("Invalid vocabulary record; storage was not overwritten");
        const normalized = normalizeRecord(record, language);
        const key = stableItemId(normalized.language, normalized.expression);
        if (ids.has(normalized.itemId) || keys.has(key)) throw new Error("Duplicate vocabulary identity; storage was not overwritten");
        ids.add(normalized.itemId);
        keys.add(key);
        return normalized;
    });
    return { schemaVersion: VOCABULARY_SCHEMA, records, legacyImports: value.legacyImports };
}

/** Durable compact records. Every update merges against the latest file on this device. */
export class VaultVocabulary {
    private pending: Promise<unknown> = Promise.resolve();
    constructor(private vault: Vault, readonly folder: string, private language: string) {}

    get path(): string { return normalizePath(`${this.folder}/LanguageLearner/vocabulary.json`); }

    async ensureFolders(path: string): Promise<void> {
        const segments = normalizePath(path).split("/");
        let current = "";
        for (const segment of segments) {
            current = current ? `${current}/${segment}` : segment;
            if (!this.vault.getAbstractFileByPath(current)) {
                try { await this.vault.createFolder(current); }
                catch (error) { if (!this.vault.getAbstractFileByPath(current)) throw error; }
            }
        }
    }

    async read(): Promise<VocabularyLedger> {
        const file = this.vault.getAbstractFileByPath(this.path);
        if (!file) return { schemaVersion: VOCABULARY_SCHEMA, records: [], legacyImports: [] };
        if (!(file instanceof TFile)) throw new Error("Vocabulary storage path is not a file");
        return parseLedger(await this.vault.read(file), this.language);
    }

    update(change: (ledger: VocabularyLedger) => void): Promise<void> {
        const operation = this.pending.then(async () => {
            await this.ensureFolders(`${this.folder}/LanguageLearner`);
            let file = this.vault.getAbstractFileByPath(this.path);
            if (!file) {
                try {
                    file = await this.vault.create(this.path, JSON.stringify({
                        schemaVersion: VOCABULARY_SCHEMA, records: [], legacyImports: [],
                    }, null, 2) + "\n");
                } catch (error) {
                    file = this.vault.getAbstractFileByPath(this.path);
                    if (!file) throw error;
                }
            }
            if (!(file instanceof TFile)) throw new Error("Vocabulary storage path is not a file");
            await this.vault.process(file, text => {
                const ledger = parseLedger(text, this.language);
                change(ledger);
                // Validate the complete candidate before any bytes are committed.
                const next = JSON.stringify(ledger, null, 2) + "\n";
                parseLedger(next, this.language);
                return next;
            });
        });
        this.pending = operation.catch((): void => undefined);
        return operation;
    }

    async backup(kind: string, data: unknown): Promise<string> {
        const directory = normalizePath(`${this.folder}/LanguageLearner/backups`);
        await this.ensureFolders(directory);
        const path = `${directory}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.json`;
        const content = JSON.stringify(data, null, 2) + "\n";
        const file = await this.vault.create(path, content);
        if (await this.vault.read(file) !== content) throw new Error("Vocabulary backup could not be verified");
        return path;
    }
}
