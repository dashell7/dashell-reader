import { requestUrl } from "obsidian";
import { DictSearchResult, handleNoResult, handleNetWorkError, withTimeout } from "../helpers";

export type GoogleResult = {
    src: string;
    tgt: string;
    srcLang: string;
    tgtLang: string;
};

export type GoogleSearchResult = DictSearchResult<GoogleResult>;

/**
 * 使用 Free Dictionary API 获取英英释义（简洁版：只显示第一个常用释义）
 */
const searchDictionary = async (text: string): Promise<GoogleSearchResult> => {
    const cleanWord = text.toLowerCase().replace(/[^a-zA-Z'-]/g, '');
    if (!cleanWord || cleanWord.length < 2) {
        return handleNoResult();
    }

    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`;

    try {
        const response = await withTimeout(requestUrl({ url }));
        const data = response.json;

        if (Array.isArray(data) && data.length > 0) {
            const entry = data[0];
            const meanings = entry.meanings;
            
            if (meanings && meanings.length > 0) {
                const firstDef = meanings[0].definitions?.[0]?.definition;
                if (firstDef) {
                    return {
                        result: {
                            src: text,
                            tgt: firstDef,
                            srcLang: 'en',
                            tgtLang: 'en'
                        }
                    };
                }
            }
        }
        return handleNoResult();
    } catch (e) {
        return handleNetWorkError();
    }
};

/**
 * 使用 Google Translate API 翻译
 */
const searchGoogle = async (text: string, targetLang: string): Promise<GoogleSearchResult> => {
    const sourceLang = 'auto';
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

    try {
        const response = await withTimeout(requestUrl({ url }));
        const data = response.json;

        if (data && data[0] && data[0].length > 0) {
            const tgt = data[0].map((item: any) => item[0]).join('');
            const detectedLang = data[2];

            return {
                result: {
                    src: text,
                    tgt: tgt,
                    srcLang: detectedLang,
                    tgtLang: targetLang
                }
            };
        }
        return handleNoResult();
    } catch (e) {
        return handleNetWorkError();
    }
};

export const search = async (text: string, settings: any): Promise<GoogleSearchResult> => {
    const targetLang = settings.native || 'zh';
    
    // 英语目标语言使用词典 API，其他语言使用 Google 翻译
    if (targetLang === 'en') {
        return searchDictionary(text);
    }
    return searchGoogle(text, targetLang);
};
