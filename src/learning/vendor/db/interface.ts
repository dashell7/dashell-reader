import type { ReviewState } from "@/utils/reviewReflux";
import type { SentenceSource } from "@/utils/sentenceSource";

export interface ExpressionSaveOptions {
    source: "review";
    evidence: string;
    reviewPath: string;
    intervalDays: number;
}

interface ArticleWords {
    article: string;
    words: string[];
}

interface Word {
    text: string;
    status: number;
}

interface Phrase {
    text: string;
    status: number;
    offset: number;
}

interface WordsPhrase {
    words: Word[];
    phrases: Phrase[];
}

interface Sentence {
    text: string;
    trans: string;
    origin: string;
    source?: SentenceSource;
}

interface ExpressionInfo {
    reviewState?: ReviewState;
    revision?: string;
    itemId?: string;
    schemaVersion?: number;
    language?: string;
    sourcePath?: string;
    expression: string;
    meaning: string;
    status: number;
    t: string;
    tags: string[];
    notes: string[];
    sentences: Sentence[];
    aliases:string[];
    date: number;
    created?: number;
}

interface ExpressionInfoSimple {
    revision?: string;
    reviewState?: ReviewState;
    itemId?: string;
    schemaVersion?: number;
    language?: string;
    sourcePath?: string;
    expression: string;
    meaning: string;
    status: number;
    t: string;
    tags: string[];
    note_num: number;
    sen_num: number;
    date: number;
    created?: number;
    aliases:string[];
}

interface CountInfo {
    word_count: number[];
    phrase_count: number[];
}


interface Span {
    from: number;
    to: number;
}

interface WordCount {
    today: number[];
    accumulated: number[];
}

interface link {
    link: {[key:string]: string[]};
}


export type {
    ArticleWords, Word, Phrase, WordsPhrase, Sentence,
    ExpressionInfo, ExpressionInfoSimple, CountInfo, WordCount, Span
};
