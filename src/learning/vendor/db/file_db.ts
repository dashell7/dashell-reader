import { TFile, moment, normalizePath } from "obsidian";
import { createAutomaton } from "ac-auto";
import download from "downloadjs";
import type { ArticleWords, WordsPhrase, ExpressionInfo, ExpressionInfoSimple, ExpressionSaveOptions, Sentence, CountInfo, WordCount } from "./interface";
import DbProvider from "./base";
import { WordDB } from "./idb";
import type Plugin from "@/plugin";
import { WordNoteStore } from "./wordNoteStore";
import { VaultVocabulary } from "./vaultVocabulary";
import { expressionKey, normalizeRecord, simplifyRecord, stableItemId, recordRevision } from "@/utils/vocabularyRecord";
import { shouldPersistWordFile } from "@/utils/status";
import { readWordNote } from "@/utils/wordNoteFormat";
import { extractSRProgress } from "@/utils/reviewDb";
import { reviewEvidence, planRefluxUpdates, normalizeRefluxThresholds } from "@/utils/reviewReflux";

export interface VocabularyBackup {
    format: "language-learner-vocabulary";
    schemaVersion: 1;
    createdAt: string;
    wordFolder: string;
    records: ExpressionInfo[];
    notes: Array<{ path: string; content: string }>;
    review?: { path: string; content: string };
    legacyRecords?: ExpressionInfo[];
}

const keyOf = (record: ExpressionInfo) => stableItemId(record.language || "en", record.expression);

/** Vault files own all durable state. IndexedDB is read only as a legacy migration source. */
export class FileDb extends DbProvider {
    readonly idb: WordDB;
    readonly notes: WordNoteStore;
    readonly ledger: VaultVocabulary;
    private pending: Promise<unknown> = Promise.resolve();
    private closed = false;
    private dispose: Array<() => void> = [];
    private revision = 0;
    private reviewRevision = 0;
    private cache: ExpressionInfo[] | null = null;
    private opening: Promise<void> | null = null;

    invalidate(): void {
        this.revision++;
        this.cache = null;
        this.notes.invalidate();
    }

    constructor(readonly plugin: Plugin) {
        super();
        this.idb = new WordDB(plugin);
        this.notes = new WordNoteStore(plugin);
        this.ledger = new VaultVocabulary(plugin.app.vault, plugin.settings.word_folder, plugin.settings.foreign);
    }

    private assertOpen(): void {
        if (this.closed) throw new Error("Vocabulary database is closed");
        if (this.plugin.settings.word_folder !== this.ledger.folder) {
            throw new Error("Vocabulary folder changed; reload Language Learner before continuing");
        }
    }

    open(): Promise<void> {
        if (this.opening) return this.opening;
        if (this.isReady) return Promise.resolve();
        this.resetReadiness();
        this.closed = false;
        this.opening = this.initialize().finally(() => { this.opening = null; });
        return this.opening;
    }

    private async initialize(): Promise<void> {
        const vault = this.plugin.app.vault;
        const changed = (file: { path: string }, oldPath?: string) => {
            const reviewPath = this.plugin.settings.review_database ? normalizePath(this.plugin.settings.review_database) : "";
            if (reviewPath && (file.path === reviewPath || oldPath === reviewPath)) this.reviewRevision++;
            if (file.path.startsWith(this.ledger.folder + "/") || oldPath?.startsWith(this.ledger.folder + "/")) {
                this.invalidate();
                this.plugin.invalidateParserAllFMCache();
                this.plugin.parser?.invalidateCache();
            }
        };
        try {
            // Observe changes before reading or migrating so the first cache cannot miss concurrent edits.
            for (const event of ["create", "modify", "delete", "rename"] as const) {
                const ref = (vault.on as Function).call(vault, event, changed);
                this.dispose.push(() => vault.offref(ref));
            }
            await this.idb.open();
            this.assertOpen();
            await this.migrateLegacy();
            this.assertOpen();
            this.markReady();
        } catch (error) {
            for (const dispose of this.dispose) dispose();
            this.dispose = [];
            this.idb.close();
            this.failInitialization(error);
            throw error;
        }
    }

    close(): void {
        this.closed = true;
        this.failInitialization(new Error("Vocabulary database is closed"));
        for (const dispose of this.dispose) dispose();
        this.dispose = [];
        this.idb.close();
        this.invalidate();
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.pending.then(async () => { await this.waitForReady(); this.assertOpen(); return operation(); });
        this.pending = next.catch((): void => undefined);
        return next;
    }

    private async allRecords(): Promise<ExpressionInfo[]> {
        this.assertOpen();
        if (this.cache) return this.cache;
        const revision = this.revision;
        const stored = await this.ledger.read();
        const byId = new Map(stored.records.map(record => [keyOf(record), record]));
        const noteIds = new Set<string>();
        for (const note of await this.notes.readAll()) {
            if (noteIds.has(keyOf(note))) throw new Error(`Duplicate vocabulary notes for ${note.expression}; resolve the duplicate before saving`);
            noteIds.add(keyOf(note));
            // Existing notes always win over an interrupted materialization's compact record.
            byId.set(keyOf(note), note);
        }
        if (revision !== this.revision) return this.allRecords();
        this.cache = [...byId.values()].map(record => ({ ...record, revision: recordRevision(record) }));
        return this.cache;
    }

    private async currentRecords(): Promise<ExpressionInfo[]> {
        await this.waitForReady();
        await this.pending;
        return (await this.allRecords()).filter(record => record.language === this.plugin.settings.foreign)
            .map(record => normalizeRecord(record, this.plugin.settings.foreign));
    }

    async getStoredWords(payload: ArticleWords): Promise<WordsPhrase> {
        const records = await this.currentRecords();
        const requested = new Set(payload.words.map(expressionKey));
        const words = new Map<string, { text: string; status: number }>();
        const phrases = new Map<string, number>();
        for (const record of records) {
            for (const text of [record.expression, ...record.aliases]) {
                if (requested.has(text)) words.set(text, { text, status: record.status });
                if (record.t === "PHRASE") phrases.set(text, record.status);
            }
        }
        const result: WordsPhrase = { words: [...words.values()], phrases: [] };
        if (payload.article?.trim() && phrases.size) {
            const automaton = await createAutomaton([...phrases.keys()]);
            result.phrases = (await automaton.search(payload.article)).map(match => ({
                text: match[1], status: phrases.get(match[1]), offset: match[0],
            }));
        }
        return result;
    }

    async getExpression(expression: string): Promise<ExpressionInfo> {
        if (!expression?.trim()) return null;
        const key = expressionKey(expression);
        const records = await this.currentRecords();
        return records.find(record => record.expression === key)
            || records.find(record => record.aliases.includes(key)) || null;
    }

    async getExpressionsSimple(expressions: string[]): Promise<ExpressionInfoSimple[]> {
        return (await this.getExprall(expressions)).map(simplifyRecord);
    }

    async getExprall(expressions: string[]): Promise<ExpressionInfo[]> {
        const requested = new Set(expressions.map(expressionKey));
        return (await this.currentRecords()).filter(record => requested.has(record.expression)
            || record.aliases.some(alias => requested.has(alias)));
    }

    async getExpressionAfter(time: string): Promise<ExpressionInfo[]> {
        const timestamp = moment.utc(time).unix();
        if (!Number.isFinite(timestamp)) throw new Error("Invalid vocabulary date filter");
        return (await this.currentRecords()).filter(record => record.status > 0 && record.date > timestamp);
    }

    async getAllExpressionSimple(includeIgnored = false): Promise<ExpressionInfoSimple[]> {
        return (await this.currentRecords()).filter(record => includeIgnored || record.status !== 0).map(simplifyRecord);
    }

    private async currentReviewEvidence(expression: string): Promise<{ evidence: string; reviewPath: string; tag: string; assertCurrent: () => void }> {
        const reviewPath = this.plugin.settings.review_database ? normalizePath(this.plugin.settings.review_database) : "";
        const file = reviewPath ? this.plugin.app.vault.getAbstractFileByPath(reviewPath) : null;
        if (file && !(file instanceof TFile)) throw new Error("Review database path is not a file");
        const revision = this.reviewRevision;
        const mtime = file instanceof TFile ? file.stat.mtime : 0;
        const size = file instanceof TFile ? file.stat.size : 0;
        const assertCurrent = () => {
            const configured = this.plugin.settings.review_database ? normalizePath(this.plugin.settings.review_database) : "";
            const latest = reviewPath ? this.plugin.app.vault.getAbstractFileByPath(reviewPath) : null;
            if (configured !== reviewPath || latest !== file || revision !== this.reviewRevision
                || (latest instanceof TFile && (latest.stat.mtime !== mtime || latest.stat.size !== size))) {
                throw new Error("Review records changed while saving; retry to keep the latest progress");
            }
        };
        const progress = file instanceof TFile ? extractSRProgress(await this.plugin.app.vault.read(file)) : {};
        assertCurrent();
        const tag = Object.entries(progress).find(([key]) => expressionKey(key) === expression)?.[1] || "";
        return { evidence: reviewEvidence(tag), reviewPath, tag, assertCurrent };
    }

    postExpression(input: ExpressionInfo, options?: ExpressionSaveOptions): Promise<number> {
        const captured = normalizeRecord(input, this.plugin.settings.foreign);
        const review = options ? { ...options } : undefined;
        return this.enqueue(async () => {
            const existing = (await this.allRecords()).find(record => record.itemId === captured.itemId
                || (record.expression === captured.expression && record.language === captured.language));
            if (existing && (existing.expression !== captured.expression || existing.language !== captured.language)) {
                throw new Error("Changing a vocabulary identity requires a separate rename operation; the original was kept");
            }
            if (captured.revision && (!existing || captured.revision !== existing.revision)) {
                throw new Error("Vocabulary changed since it was opened; reload it before saving");
            }
            const record = normalizeRecord({ ...captured, itemId: existing?.itemId || captured.itemId,
                created: existing?.created ?? captured.created, sourcePath: existing?.sourcePath,
                reviewState: existing?.reviewState,
                date: Math.floor(Date.now() / 1000) }, this.plugin.settings.foreign);
            let beforeWrite: (() => void) | undefined;
            if (review) {
                // Apply the planned snapshot, never a freshly read revision that could hide a manual edit.
                if (!existing || !captured.revision || !this.plugin.settings.review_reflux_enabled) return 409;
                const current = await this.currentReviewEvidence(record.expression);
                beforeWrite = () => {
                    current.assertCurrent();
                    if (!this.plugin.settings.review_reflux_enabled || record.language !== this.plugin.settings.foreign
                        || JSON.stringify(normalizeRefluxThresholds({
                            familiarDays: this.plugin.settings.reflux_familiar_days,
                            knownDays: this.plugin.settings.reflux_known_days,
                            learnedDays: this.plugin.settings.reflux_learned_days,
                        })) !== thresholdSnapshot) throw new Error("Review settings changed while saving; retry");
                };
                const thresholdSnapshot = JSON.stringify(normalizeRefluxThresholds({
                    familiarDays: this.plugin.settings.reflux_familiar_days,
                    knownDays: this.plugin.settings.reflux_known_days,
                    learnedDays: this.plugin.settings.reflux_learned_days,
                }));
                if (current.reviewPath !== review.reviewPath || !review.evidence || current.evidence !== review.evidence) return 409;
                const changes = planRefluxUpdates([existing], { [record.expression]: current.tag }, normalizeRefluxThresholds({
                    familiarDays: this.plugin.settings.reflux_familiar_days,
                    knownDays: this.plugin.settings.reflux_known_days,
                    learnedDays: this.plugin.settings.reflux_learned_days,
                }), current.reviewPath);
                if (!changes.some(change => change.to === record.status && change.intervalDays === review.intervalDays)) return 409;
                record.reviewState = { source: "review", evidence: current.evidence, reviewPath: current.reviewPath,
                    status: record.status, updatedAt: Date.now(), intervalDays: review.intervalDays };
            } else if (!existing || existing.status !== record.status) {
                // Capture even while automatic updates are off, so enabling them cannot replay an old review.
                const current = await this.currentReviewEvidence(record.expression);
                beforeWrite = current.assertCurrent;
                record.reviewState = { source: "manual", evidence: current.evidence, reviewPath: current.reviewPath,
                    status: record.status, updatedAt: Date.now() };
            }
            if (existing?.sourcePath || shouldPersistWordFile(record.status)) {
                // A note survives Known/Ignore transitions. Only an explicit save can materialize a new note.
                await this.notes.save({ ...record, revision: existing?.sourcePath ? existing.revision : undefined }, true, beforeWrite);
                await this.ledger.update(ledger => { ledger.records = ledger.records.filter(row => keyOf(row) !== keyOf(record)); });
            } else {
                delete record.revision;
                await this.ledger.update(ledger => {
                    beforeWrite?.();
                    const latest = ledger.records.find(row => keyOf(row) === keyOf(record));
                    if ((existing && (!latest || recordRevision(latest) !== existing.revision)) || (!existing && latest)) {
                        throw new Error("Vocabulary changed while saving; reload it before saving");
                    }
                    ledger.records = ledger.records.filter(row => keyOf(row) !== keyOf(record));
                    ledger.records.push(record);
                });
            }
            this.invalidate();
            this.plugin.invalidateParserAllFMCache();
            this.plugin.parser?.invalidateCache();
            return 200;
        });
    }

    async bulkPostExpressions(records: ExpressionInfo[]): Promise<void> {
        for (const record of records) await this.postExpression(record);
    }

    async getTags(): Promise<string[]> {
        return [...new Set((await this.currentRecords()).flatMap(record => record.tags))];
    }

    postIgnoreWords(expressions: string[]): Promise<void> {
        const keys = [...new Set(expressions.map(expressionKey).filter(Boolean))];
        return this.enqueue(async () => {
            const existing = new Set((await this.allRecords()).filter(record => record.language === this.plugin.settings.foreign)
                .flatMap(record => [record.expression, ...record.aliases]));
            const additions = keys.filter(key => !existing.has(key)).map(expression => normalizeRecord({
                expression, status: 0, meaning: "", t: "WORD", date: Math.floor(Date.now() / 1000),
                tags: [], aliases: [], notes: [], sentences: [],
            }, this.plugin.settings.foreign));
            if (!additions.length) return;
            await this.ledger.update(ledger => {
                const ids = new Set(ledger.records.map(record => record.itemId));
                ledger.records.push(...additions.filter(record => !ids.has(record.itemId)));
            });
            this.invalidate();
            this.plugin.parser?.invalidateCache();
        });
    }

    async tryGetSen(text: string): Promise<Sentence> {
        return (await this.currentRecords()).flatMap(record => record.sentences).find(sentence => sentence.text === text) || null;
    }

    async getCount(): Promise<CountInfo> {
        const result = { word_count: [0, 0, 0, 0, 0], phrase_count: [0, 0, 0, 0, 0] };
        for (const record of await this.currentRecords()) {
            (record.t === "PHRASE" ? result.phrase_count : result.word_count)[record.status]++;
        }
        return result;
    }

    async countSeven(): Promise<WordCount[]> {
        const records = await this.currentRecords();
        return Array.from({ length: 7 }, (_, index) => {
            const day = moment().utcOffset(8 * 60).subtract(6 - index, "days").startOf("day");
            const from = day.unix();
            const to = day.endOf("day").unix();
            const result = { today: [0, 0, 0, 0, 0], accumulated: [0, 0, 0, 0, 0] };
            for (const record of records.filter(row => row.t === "WORD")) {
                const created = record.created ?? record.date;
                if (created <= to) result.accumulated[record.status]++;
                if (created >= from && created <= to) result.today[record.status]++;
            }
            return result;
        });
    }

    private async legacyRecords(): Promise<ExpressionInfo[]> {
        const result: ExpressionInfo[] = [];
        for (const row of await this.idb.expressions.toArray()) {
            const sentences = await this.idb.sentences.where("id").anyOf([...row.sentences]).toArray();
            result.push(normalizeRecord({ ...row, tags: [...row.tags], sentences,
                notes: row.notes || [], aliases: row.aliases || [] }, this.plugin.settings.foreign));
        }
        return result;
    }

    private async fingerprint(records: ExpressionInfo[]): Promise<string> {
        const bytes = new TextEncoder().encode(JSON.stringify([...records].sort((a, b) => a.expression.localeCompare(b.expression))));
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, "0")).join("");
    }

    private async migrateLegacy(): Promise<void> {
        const legacy = await this.legacyRecords();
        const fingerprint = await this.fingerprint(legacy);
        const ledger = await this.ledger.read(); // Fail closed on invalid/newer schemas.
        if (ledger.legacyImports.includes(fingerprint)) return;
        const notes = await this.notes.readAll();
        const all = new Map(legacy.map(record => [keyOf(record), record]));
        for (const record of ledger.records) all.set(keyOf(record), record);
        for (const record of notes) all.set(keyOf(record), record);
        if (all.size) {
            // The complete original note bytes and legacy records are saved before any migration write.
            this.assertOpen();
            await this.ledger.backup("before-migration", { ...await this.makeBackup([...all.values()]), legacyRecords: legacy });
        }
        for (const note of notes) {
            this.assertOpen();
            await this.notes.save({ ...note, revision: recordRevision(note) }, false);
        }
        const noteIds = new Set(notes.map(keyOf));
        this.assertOpen();
        await this.ledger.update(current => {
            const ids = new Set(current.records.map(keyOf));
            for (const record of legacy) {
                if (!ids.has(keyOf(record)) && !noteIds.has(keyOf(record))) {
                    current.records.push(record); ids.add(keyOf(record));
                }
            }
            current.records = current.records.filter(record => !noteIds.has(keyOf(record)));
            if (!current.legacyImports.includes(fingerprint)) current.legacyImports.push(fingerprint);
        });
        this.invalidate();
        // Original IndexedDB data deliberately remains available for rollback; it is never written or queried again.
    }

    private async makeBackup(records?: ExpressionInfo[]): Promise<VocabularyBackup> {
        const backup: VocabularyBackup = {
            format: "language-learner-vocabulary", schemaVersion: 1, createdAt: new Date().toISOString(),
            wordFolder: this.ledger.folder, records: records || await this.allRecords(), notes: await this.notes.snapshots(),
        };
        const review = this.plugin.app.vault.getAbstractFileByPath(this.plugin.settings.review_database);
        if (review instanceof TFile) backup.review = { path: review.path, content: await this.plugin.app.vault.read(review) };
        return backup;
    }

    createBackup(): Promise<string> {
        return this.enqueue(async () => this.ledger.backup("vocabulary", await this.makeBackup()));
    }

    async exportDB(): Promise<void> {
        await this.waitForReady();
        await this.pending;
        const backup = await this.makeBackup();
        download(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }), "language-learner-vocabulary.json", "application/json");
    }

    async importDB(file: File): Promise<void> {
        const { splitWordNote, stampMissingWordMetadata, rebindWordReviewPath } = await import("@/utils/wordNoteFormat");
        const candidate: VocabularyBackup = JSON.parse(await file.text());
        if (candidate?.format !== "language-learner-vocabulary" || candidate.schemaVersion !== 1
            || !Array.isArray(candidate.records) || !Array.isArray(candidate.notes) || typeof candidate.wordFolder !== "string") {
            throw new Error("Select a Language Learner vocabulary backup; the current data was not changed");
        }
        const safePath = (value: unknown): string => {
            if (typeof value !== "string" || !value || /^[\\/]/.test(value)
                || /[<>:"|?*\x00-\x1f]/.test(value)) throw new Error("Unsafe path in vocabulary backup");
            const parts = value.replace(/\\/g, "/").split("/");
            if (parts.some(part => !part || part === "." || part === "..")) {
                throw new Error("Unsafe path in vocabulary backup");
            }
            return parts.join("/");
        };
        const sourceFolder = safePath(candidate.wordFolder);
        const records = candidate.records.map(record => {
            const normalized = normalizeRecord(record, this.plugin.settings.foreign);
            delete normalized.sourcePath;
            delete normalized.revision;
            return normalized;
        });
        const byKey = new Map<string, ExpressionInfo>();
        const byId = new Map<string, ExpressionInfo>();
        for (const record of records) {
            if (byKey.has(keyOf(record)) || byId.has(record.itemId)) {
                throw new Error("Backup contains duplicate vocabulary identities; no data was changed");
            }
            byKey.set(keyOf(record), record);
            byId.set(record.itemId, record);
        }
        const bySourcePath = new Map<string, ExpressionInfo>();
        candidate.records.forEach((original, index) => {
            if (!original.sourcePath) return;
            const path = safePath(original.sourcePath);
            if (!path.startsWith(sourceFolder + "/")) return;
            if (bySourcePath.has(path)) throw new Error("Backup records refer to the same source note");
            bySourcePath.set(path, records[index]);
        });
        const noteKeys = new Set<string>();
        const notePaths = new Set<string>();
        const validatedNotes = candidate.notes.map(note => {
            if (!note || typeof note.content !== "string") throw new Error("Invalid vocabulary note in backup");
            const sourcePath = safePath(note.path);
            if (!sourcePath.startsWith(sourceFolder + "/") || !sourcePath.endsWith(".md")) {
                throw new Error("Unsafe note path in backup");
            }
            const initial = readWordNote(note.content, this.plugin.settings.foreign, sourcePath, 0);
            if (!initial) throw new Error("Backup note and vocabulary record identities do not match");
            const properties = splitWordNote(note.content).properties;
            const explicitId = typeof properties.langr_id === "string" && !!properties.langr_id.trim();
            const explicitLanguage = typeof properties.langr_language === "string" && !!properties.langr_language.trim();
            let represented = bySourcePath.get(sourcePath);
            if (!represented && explicitId) represented = byId.get(initial.itemId);
            if (!represented && explicitLanguage) represented = byKey.get(keyOf(initial));
            if (!represented && !explicitId && !explicitLanguage) {
                const matches = records.filter(record => record.expression === initial.expression);
                if (matches.length !== 1) throw new Error("Legacy backup note has an ambiguous vocabulary identity");
                represented = matches[0];
            }
            if (!represented || represented.expression !== initial.expression
                || (explicitId && represented.itemId !== initial.itemId)
                || (explicitLanguage && represented.language !== initial.language)) {
                throw new Error("Backup note and vocabulary record identities do not match");
            }
            const content = stampMissingWordMetadata(note.content, represented);
            const record = readWordNote(content, represented.language, sourcePath, represented.date);
            if (record.itemId !== represented.itemId || keyOf(record) !== keyOf(represented)) {
                throw new Error("Backup note and vocabulary record identities do not match");
            }
            const path = safePath(this.ledger.folder + sourcePath.slice(sourceFolder.length));
            if (noteKeys.has(keyOf(record)) || notePaths.has(path.toLowerCase())) {
                throw new Error("Backup contains duplicate vocabulary notes or target paths");
            }
            noteKeys.add(keyOf(record));
            notePaths.add(path.toLowerCase());
            return { note: { ...note, content }, record, path };
        });
        await this.enqueue(async () => {
            // Merge restoration never clears newer vocabulary or overwrites existing user note bodies.
            const existing = await this.allRecords();
            const existingKeys = new Set(existing.map(keyOf));
            const existingIds = new Map(existing.map(record => [record.itemId, keyOf(record)]));
            for (const record of records) {
                const existingKey = existingIds.get(record.itemId);
                if (existingKey && existingKey !== keyOf(record)) {
                    throw new Error("Backup identity belongs to a different existing word; no data was changed");
                }
            }
            const notesToCreate = validatedNotes.filter(({ record }) => !existingKeys.has(keyOf(record)));
            const reviewPath = candidate.review && typeof candidate.review.content === "string"
                && this.plugin.settings.review_database ? safePath(this.plugin.settings.review_database) : "";
            const restoreReview = !!reviewPath && !this.plugin.app.vault.getAbstractFileByPath(reviewPath);
            const sourceReviewPath = reviewPath ? safePath(candidate.review.path) : "";
            const targets = notesToCreate.map(note => note.path);
            if (restoreReview) targets.push(reviewPath);
            const targetSet = new Set<string>();
            for (const target of targets) {
                if (targetSet.has(target.toLowerCase())) throw new Error(`Duplicate restore target: ${target}`);
                targetSet.add(target.toLowerCase());
            }
            const preflightPaths = () => {
                const markdownPaths = new Set(this.plugin.app.vault.getMarkdownFiles().map(note => note.path.toLowerCase()));
                for (const path of targets) {
                    if (this.plugin.app.vault.getAbstractFileByPath(path) || markdownPaths.has(path.toLowerCase())) {
                        throw new Error(`Restore target already exists: ${path}`);
                    }
                    const parts = path.split("/");
                    for (let count = 1; count < parts.length; count++) {
                        const parent = parts.slice(0, count).join("/");
                        if (this.plugin.app.vault.getAbstractFileByPath(parent) instanceof TFile
                            || markdownPaths.has(parent.toLowerCase()) || targetSet.has(parent.toLowerCase())) {
                            throw new Error(`Restore target parent is a file: ${parent}`);
                        }
                    }
                }
            };
            // Check the entire restore plan before its first write, including the recovery backup.
            preflightPaths();
            await this.ledger.backup("before-restore", await this.makeBackup());
            // A different writer may have changed targets while the backup was being written.
            preflightPaths();
            try {
                // Bind only to a successfully restored review or its exact contents already on disk.
                // An identical file may remain from an interrupted restore, so retries can finish
                // without deleting files or changing already imported words.
                let sameReview = false;
                if (restoreReview) {
                    const parent = reviewPath.includes("/") ? reviewPath.slice(0, reviewPath.lastIndexOf("/")) : "";
                    if (parent) await this.ledger.ensureFolders(parent);
                    await this.plugin.app.vault.create(reviewPath, candidate.review.content);
                    sameReview = true;
                } else if (reviewPath) {
                    const currentReview = this.plugin.app.vault.getAbstractFileByPath(reviewPath);
                    sameReview = currentReview instanceof TFile
                        && await this.plugin.app.vault.read(currentReview) === candidate.review.content;
                }
                const restoredRecords = records.map(record => sameReview && record.reviewState?.reviewPath === sourceReviewPath
                    ? { ...record, reviewState: { ...record.reviewState, reviewPath } } : record);
                for (const { note, path } of notesToCreate) {
                    await this.ledger.ensureFolders(path.slice(0, path.lastIndexOf("/")));
                    const content = sameReview ? rebindWordReviewPath(note.content, sourceReviewPath, reviewPath) : note.content;
                    await this.plugin.app.vault.create(path, content);
                }
                this.invalidate();
                const currentNotes = await this.notes.readAll();
                await this.ledger.update(ledger => {
                    const current = [...ledger.records, ...currentNotes];
                    const keys = new Set(current.map(keyOf));
                    const ids = new Map(current.map(record => [record.itemId, keyOf(record)]));
                    for (const record of restoredRecords) {
                        if (keys.has(keyOf(record))) continue;
                        if (ids.has(record.itemId)) throw new Error("Vocabulary identity changed during restore; existing data was kept");
                        ledger.records.push(record);
                        keys.add(keyOf(record));
                        ids.set(record.itemId, keyOf(record));
                    }
                });
            } finally {
                this.invalidate();
                this.plugin.invalidateParserAllFMCache();
                this.plugin.parser?.invalidateCache();
            }
        });
    }

    async destroyAll(): Promise<void> {
        // Historical callers used this to rebuild IndexedDB. Durable vocabulary is never cleared here.
        this.invalidate();
        this.plugin.invalidateParserAllFMCache();
        this.plugin.parser?.invalidateCache();
    }
}
