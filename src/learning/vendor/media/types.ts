import type { TFile } from "obsidian";
import type { SupportedLanguage } from "../utils/languageUtils";

export interface MediaSource {
    type: "local" | "url";
    url: string;
    displayName?: string;
    timestamp?: number;
    file?: TFile;
}

export interface PlayerState {
    playing: boolean;
    currentTime: number;
    duration: number;
    loaded: number;
    volume: number;
    playbackRate: number;
}

export interface PlayerRef {
    seekTo: (seconds: number, type?: "seconds" | "fraction") => void;
    getCurrentTime: () => number;
    getDuration: () => number;
    getSecondsLoaded: () => number;
    playVideo: () => void;
    pauseVideo: () => void;
    setPlaybackRate: (rate: number) => void;
    getInternalPlayer?: () => HTMLMediaElement | null;
}

export interface SubtitleCue {
    id: string;
    index: number;
    start: number;
    end: number;
    text: string;
    textEn?: string;
    textZh?: string;
    languages?: Partial<Record<SupportedLanguage, string>>;
    detectedLanguages?: SupportedLanguage[];
    primaryLanguage?: SupportedLanguage;
}

export type SubtitleFormat = "srt" | "vtt" | "ass" | "unknown";

export interface SubtitleConfig {
    fontSize: number;
    fontColor: string;
    translationColor?: string;
    highlightColor?: string;
    backgroundColor: string;
    position: "top" | "center" | "bottom";
    showEnglish: boolean;
    showChinese: boolean;
    visibleLanguages: SupportedLanguage[];
    primaryLanguage?: SupportedLanguage;
    showIndexAndTime: boolean;
    wordByWordHighlight: boolean;
}
