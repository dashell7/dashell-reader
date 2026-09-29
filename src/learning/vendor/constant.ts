import { t } from "./lang/helper";

const dict = {
    NAME: "Language Learner"
};

type Position = {
    x: number;
    y: number;
};

//继承 GlobalEventHandlersEventMap：EventMap 继承了 GlobalEventHandlersEventMap，
//这意味着 EventMap 将包含 GlobalEventHandlersEventMap 中的所有事件，同时添加自定义事件。
interface EventMap extends GlobalEventHandlersEventMap {
    "qiaomu-english-event-search": CustomEvent<{
        selection: string,
        target?: HTMLElement,
        evtPosition?: Position,
        // Sentence the word was clicked in, computed at dispatch time so the
        // LearnPanel can auto-fill the example sentence without re-deriving it
        // from fragile DOM parent-walking (works for reading + subtitle words).
        sentence?: string,
        bookTitle?: string,
        readerLink?: string,
    }>;
    "qiaomu-english-event-refresh": CustomEvent<{
        expression: string,
        type: string,
        status: number,
        meaning: string,
        aliases: string[],
    }>;
    "qiaomu-english-event-refresh-stat": CustomEvent<{}>;
    "qiaomu-english-event-toast": CustomEvent<{
        message: string;
        type?: "success" | "error" | "info";
        duration?: number;
    }>;
    "qiaomu-english-event-subtitle-popup": CustomEvent<{
        word: string;
        sentenceEn: string;
        sentenceZh: string;
        x: number;
        y: number;
    }>;
}



export { dict };
export type { EventMap, Position }


