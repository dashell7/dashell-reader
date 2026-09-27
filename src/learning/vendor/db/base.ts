import {
    ArticleWords, Word, Phrase, WordsPhrase, Sentence,
    ExpressionInfo, ExpressionInfoSimple, ExpressionSaveOptions, CountInfo, WordCount, Span
} from "./interface";


abstract class DbProvider {
    isReady: boolean = false;
    private readyPromise: Promise<void>;
    private readyResolve: () => void;
    private readyReject: (error: Error) => void;
    private readyError: Error | null = null;
    private readySettled = false;

    constructor() {
        this.createReadiness();
    }

    private createReadiness(): void {
        this.readyPromise = new Promise((resolve, reject) => {
            this.readyResolve = resolve;
            this.readyReject = reject;
        });
        // A failed startup may precede the first query; keep the rejection observable without an unhandled rejection.
        void this.readyPromise.catch((): void => undefined);
    }

    protected resetReadiness(): void {
        if (!this.readySettled) return; // Preserve callers already waiting for the first open.
        this.isReady = false;
        this.readyError = null;
        this.readySettled = false;
        this.createReadiness();
    }

    failInitialization(reason: unknown): void {
        this.isReady = false;
        this.readyError = reason instanceof Error ? reason : new Error(String(reason));
        this.readySettled = true;
        this.readyReject(this.readyError);
    }

    abstract open(): Promise<void>;
    abstract close(): void;

    // 等待数据库就绪
    async waitForReady(): Promise<void> {
        await this.readyPromise;
        if (this.readyError) throw this.readyError;
    }

    // 子类在初始化完成后调用此方法
    protected markReady(): void {
        this.isReady = true;
        this.readySettled = true;
        this.readyResolve();
    }
    // 在文章中寻找之前记录过的单词和词组
    abstract getStoredWords(payload: ArticleWords): Promise<WordsPhrase>;
    // 查询单个单词/词组的全部信息
    abstract getExpression(expression: string): Promise<ExpressionInfo>;
    //获取一批单词的简略信息
    abstract getExpressionsSimple(expressions: string[]): Promise<ExpressionInfoSimple[]>;
    //获取一批单词的全部信息，包括句子
    abstract getExprall(expressions: string[]): Promise<ExpressionInfo[]>;
    // 某一时间之后添加的全部单词
    abstract getExpressionAfter(time: string): Promise<ExpressionInfo[]>;
    // 获取全部单词的简略信息
    abstract getAllExpressionSimple(ignores?: boolean): Promise<ExpressionInfoSimple[]>;
    // 发送单词信息到数据库保存
    abstract postExpression(payload: ExpressionInfo, options?: ExpressionSaveOptions): Promise<number>;
    // 批量发送单词信息到数据库保存
    abstract bulkPostExpressions(payloads: ExpressionInfo[]): Promise<void>;
    // 获取所有tag
    abstract getTags(): Promise<string[]>;
    // 批量发送单词，全部标记为ignore
    abstract postIgnoreWords(payload: string[]): Promise<void>;
    // 查询一个例句是否已经记录过
    abstract tryGetSen(text: string): Promise<Sentence>;
    // 获取各类单词的个数
    abstract getCount(): Promise<CountInfo>;
    // 获取7天内的统计信息
    abstract countSeven(): Promise<WordCount[]>;
    // 销毁数据库
    abstract destroyAll(): Promise<void>;
    // 导入数据库
    abstract importDB(data: any): Promise<void>;
    // 导出数据库
    abstract exportDB(): Promise<void>;
}


export default DbProvider;
