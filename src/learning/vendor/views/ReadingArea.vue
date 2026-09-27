<template>
    <div id="qiaomu-english-reading" ref="reading" style="height: 100%">
        <NConfigProvider :theme="theme" :theme-overrides="themeConfig"
            style="height: 100%; display: flex; flex-direction: column">
            <!-- 功能区 -->
            <div class="function-area">
                <!-- 视频播放器（使用 Media Extended 渲染，可调整高度） -->
                <div v-if="isVideoSource" class="resizable-video-wrapper" :style="{ height: videoHeight + 'px' }">
                    <div ref="videoContainer" class="video-container"></div>
                    <!-- Media Extended 工具栏 -->
                    <div class="mx-toolbar">
                        <button class="mx-toolbar-btn" @click="showAddResourcesMenu" :disabled="!mediaExtendedAvailable"
                            :title="mediaExtendedAvailable ? 'Add text track' : 'Requires the Media Extended plugin (desktop only)'">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        </button>
                    </div>
                    <div class="resize-handle-bottom" @mousedown="startResize" @touchstart.prevent="startResizeTouch">
                        <div class="resize-icon">⋯</div>
                    </div>
                </div>
                <!-- 音频播放器（标准 HTML5 播放器） -->
                <audio ref="mainAudioRef" v-if="audioSource" :src="audioSource" controls 
                    @error="onAudioError" @loadstart="onAudioLoadStart" @canplay="onAudioCanPlay"
                    style="width: 100%; height: 40px; margin: 8px 0;" />
                <div class="reading-toolbar">
                    <button @click="activeNotes = true">{{ t("Notes") }}</button>
                    <button @click="adjustReadingFontSize(-1)" :title="t('Decrease font size')">A-</button>
                    <button @click="adjustReadingFontSize(1)" :title="t('Increase font size')">A+</button>
                    <div class="reading-toolbar-progress">
                        <CountBar v-if="plugin.settings.word_count" :unknown="unknown" :learn="learn"
                            :ignore="ignore" />
                    </div>
                    <button v-if="page * pageSize < totalLines" class="finish-reading" @click="confirmFinishReading">
                        {{ t("Finish and next page") }}
                    </button>
                    <button v-else class="finish-reading" @click="confirmFinishReading">
                        {{ t("Finish Reading") }}
                    </button>
                </div>
            </div>
            <!-- 阅读区 -->
            <div ref="textAreaRef" class="text-area" :class="readingWidthClass" :style="readingAreaStyle">
                <div v-if="!renderedText" class="langr-loading-skeleton">
                    <NSpin size="medium" />
                    <span style="margin-left: 8px; opacity: 0.6;">{{ t("Loading") }}</span>
                </div>
                <div v-else class="langr-article-body" v-html="renderedText" />
            </div>
            <!-- 底栏 -->
            <div class="pagination" style="
                    padding-top: 10px;
                    border-top: 1px solid var(--background-modifier-border);
                    display: flex;
                    flex-direction: column;
                ">
                <NPagination style="justify-content: center" v-model:page="page" v-model:page-size="pageSize"
                    :item-count="totalLines" show-size-picker :page-sizes="pageSizes" :page-slot="pageSlot" />
            </div>
            <NDrawer v-model:show="activeNotes" :placement="'bottom'" :close-on-esc="true" :auto-focus="true"
                :on-after-enter="afterNoteEnter" :on-after-leave="afterNoteLeave" to="#qiaomu-english-reading"
                :default-height="250" resizable>
                <NDrawerContent :title="t('Notes')">
                    <div class="note-area">
                        <NInput class="note-input" v-model:value="notes" type="textarea" :autosize="{ minRows: 5 }" />
                        <div class="note-rendered" @mouseover="onMouseOver" ref="renderedNote"></div>
                    </div>
                </NDrawerContent>
            </NDrawer>
        </NConfigProvider>
    </div>
</template>

<script setup lang="ts">
import {
    ref,
    Ref,
    getCurrentInstance,
    computed,
    watch,
    onMounted,
    onUnmounted,
    watchEffect,
    nextTick,
} from "vue";
import {
    NPagination,
    NConfigProvider,
    NSpin,
    darkTheme,
    NDrawer,
    NDrawerContent,
    NInput,
    GlobalThemeOverrides,
} from "naive-ui";
import { MarkdownRenderer, Platform, Notice, requestUrl, Modal, TFile } from "obsidian";
import Plugin, { processContent } from "@/plugin";
import { t } from "@/lang/helper";
import { useEvent } from "@/utils/use";
import store from "@/store";
import { logger } from "@/utils/logger";
import { ReadingView } from "./ReadingView";
import CountBar from "./CountBar.vue";
import { search as googleTranslate } from "@/dictionary/google/engine";

let vueThis = getCurrentInstance();
var view = vueThis.appContext.config.globalProperties.view as ReadingView;
let plugin = view.plugin as Plugin;
let contentEl = view.contentEl as HTMLElement;

// Media Extended is desktop-only; on mobile (or when not installed) the
// "add text track" action cannot work. Surface that on the toolbar button
// (disabled + explanatory title) instead of only erroring after a tap.
const mediaExtendedAvailable = computed(
    () => !!(plugin.app as any).plugins?.plugins?.["media-extended"],
);
const textAreaRef = ref<HTMLElement>();

// 切换明亮/黑暗模式
const theme = computed(() => {
    return store.dark ? darkTheme : null;
});

const themeConfig: GlobalThemeOverrides = {
    Drawer: {
        bodyPadding: "8px 12px",
        headerPadding: "4px 6px",
        titleFontWeight: "700",
    },
};

let frontMatter = plugin.app.metadataCache.getFileCache(view.file).frontmatter;

// 检查是否有视频字段
const videoSource = (frontMatter["langr-video"] || "") as string;
const isVideoSource = ref(false);
const videoContainer = ref<HTMLElement>();
const videoHeight = ref(400); // 默认高度

if (videoSource) {
    isVideoSource.value = true;
}

// 拖动调整高度
let isResizing = false;
let startY = 0;
let startHeight = 0;
let resizeTicking = false;

function startResize(e: MouseEvent) {
    isResizing = true;
    startY = e.clientY;
    startHeight = videoHeight.value;
    
    // 拖拽时禁止文本选择并显示调整光标
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';
    
    document.addEventListener('mousemove', onResize);
    document.addEventListener('mouseup', stopResize);
    e.preventDefault();
}

function onResize(e: MouseEvent) {
    if (!isResizing || resizeTicking) return;
    
    const clientY = e.clientY;
    resizeTicking = true;
    requestAnimationFrame(() => {
        const deltaY = clientY - startY;
        videoHeight.value = Math.max(150, Math.min(800, startHeight + deltaY));
        resizeTicking = false;
    });
}

function stopResize() {
    isResizing = false;
    resizeTicking = false;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    document.removeEventListener('mousemove', onResize);
    document.removeEventListener('mouseup', stopResize);
}

// ── Touch resize handlers ──────────────────────────────────────────────────
function startResizeTouch(e: TouchEvent) {
    isResizing = true;
    startY = e.touches[0].clientY;
    startHeight = videoHeight.value;
    document.addEventListener('touchmove', onResizeTouch, { passive: false });
    document.addEventListener('touchend', stopResizeTouch);
}

function onResizeTouch(e: TouchEvent) {
    if (!isResizing || resizeTicking) return;
    e.preventDefault();
    const clientY = e.touches[0].clientY;
    resizeTicking = true;
    requestAnimationFrame(() => {
        const deltaY = clientY - startY;
        videoHeight.value = Math.max(150, Math.min(800, startHeight + deltaY));
        resizeTicking = false;
    });
}

function stopResizeTouch() {
    isResizing = false;
    resizeTicking = false;
    document.removeEventListener('touchmove', onResizeTouch);
    document.removeEventListener('touchend', stopResizeTouch);
}

// 获取 Media Extended 的服务
function getMediaExtendedServices() {
    const mediaExtended = (plugin.app as any).plugins?.plugins?.['media-extended'];
    if (!mediaExtended) {
        return null;
    }
    
    // 尝试从 container.cradle 获取服务
    const cradle = mediaExtended.container?.cradle;
    if (cradle) {
        return {
            transcriptSaver: cradle.transcriptSaver,
            workspaceOpen: cradle.workspaceOpen,
            mediaNote: cradle.mediaNote
        };
    }
    
    return null;
}

// 构建媒体信息对象
function buildMediaInfo() {
    try {
        const url = new URL(videoSource);
        // 检测视频类型
        if (videoSource.includes('youtube.com') || videoSource.includes('youtu.be')) {
            // 提取 YouTube 视频 ID
            let vid = '';
            if (videoSource.includes('youtu.be')) {
                vid = url.pathname.slice(1);
            } else {
                vid = url.searchParams.get('v') || '';
            }
            return {
                type: 'youtube',
                vid: { type: 'youtube', vid },
                url
            };
        }
        // 其他托管视频
        return {
            type: 'url:hosted',
            url
        };
    } catch (err) {
        logger.error('[Language Learner] Failed to build media info:', err);
        return null;
    }
}

// 调用 Media Extended 的添加资源菜单
function showAddResourcesMenu(e: MouseEvent) {
    const { Menu, Notice } = require('obsidian');
    const menu = new Menu();
    
    // 获取 Media Extended 插件实例
    const mediaExtended = (plugin.app as any).plugins?.plugins?.['media-extended'];
    
    if (!mediaExtended) {
        new Notice('Media Extended plugin is not installed or enabled');
        return;
    }
    
    const services = getMediaExtendedServices();
    const mediaInfo = buildMediaInfo();
    
    if (!mediaInfo) {
        new Notice('Invalid video URL');
        return;
    }
    
    menu.addItem((item: any) => {
        item.setTitle('Add text track')
            .setIsLabel(true);
    });
    
    menu.addItem((item: any) => {
        item.setIcon('file-plus')
            .setTitle('from local file')
            .onClick(async () => {
                try {
                    if (services?.transcriptSaver) {
                        await services.transcriptSaver.importTranscriptFile(mediaInfo);
                        new Notice('Transcript imported successfully');
                    } else {
                        new Notice('Media Extended transcriptSaver not available');
                    }
                } catch (err) {
                    logger.error('[Language Learner] Failed to import transcript:', err);
                    new Notice('Failed to import transcript file: ' + (err as Error).message);
                }
            });
    });
    
    menu.addItem((item: any) => {
        item.setIcon('link')
            .setTitle('from remote URL')
            .onClick(async () => {
                try {
                    if (services?.transcriptSaver) {
                        await services.transcriptSaver.importTranscriptUrl(mediaInfo);
                        new Notice('Transcript linked successfully');
                    } else {
                        new Notice('Media Extended transcriptSaver not available');
                    }
                } catch (err) {
                    logger.error('[Language Learner] Failed to import transcript URL:', err);
                    new Notice('Failed to import transcript from URL: ' + (err as Error).message);
                }
            });
    });
    
    // 如果是 YouTube 视频，添加从 YouTube 获取字幕的选项
    if (videoSource.includes('youtube.com') || videoSource.includes('youtu.be')) {
        menu.addItem((item: any) => {
            item.setIcon('captions')
                .setTitle('from YouTube')
                .onClick(async () => {
                    try {
                        if (services?.transcriptSaver && mediaInfo.type === 'youtube') {
                            await services.transcriptSaver.importYouTubeSubtitles(
                                mediaInfo,
                                {
                                    onNotFound: () => new Notice('YouTube subtitles not found'),
                                    loadingText: 'Fetching YouTube subtitles...',
                                    errorText: 'Failed to load YouTube subtitles'
                                }
                            );
                        } else {
                            new Notice('Media Extended transcriptSaver not available or not a YouTube video');
                        }
                    } catch (err) {
                        logger.error('[Language Learner] Failed to import YouTube subtitles:', err);
                        new Notice('Failed to import YouTube subtitles: ' + (err as Error).message);
                    }
                });
        });
    }
    
    menu.addSeparator();
    
    menu.addItem((item: any) => {
        item.setIcon('external-link')
            .setTitle('Open in Media Extended')
            .onClick(async () => {
                try {
                    if (services?.workspaceOpen) {
                        await services.workspaceOpen.openMedia(
                            { info: { url: mediaInfo.url, type: 'url:hosted' } },
                            { newLeaf: 'tab' }
                        );
                    } else {
                        // 备用方案：使用命令
                        (plugin.app as any).commands.executeCommandById('media-extended:open-media-switcher');
                    }
                } catch (err) {
                    logger.error('[Language Learner] Failed to open in Media Extended:', err);
                    new Notice('Failed to open video in Media Extended');
                }
            });
    });
    
    menu.showAtMouseEvent(e);
}

// 使用 Media Extended 渲染视频
watchEffect(async (clean) => {
    if (!videoContainer.value || !videoSource) {
        return;
    }
    
    // 使用 Obsidian 的 MarkdownRenderer 渲染 Media Extended 语法
    // 格式：![](视频URL)
    // 尝试添加参数以隐藏 YouTube 顶部信息
    let processedSource = videoSource;
    if (videoSource.includes('youtube.com') || videoSource.includes('youtu.be')) {
        const separator = videoSource.includes('?') ? '&' : '?';
        if (!videoSource.includes('modestbranding')) {
            processedSource += `${separator}modestbranding=1&rel=0`;
        }
    }
    
    const markdown = `![](${processedSource})`;
    
    await MarkdownRenderer.renderMarkdown(
        markdown,
        videoContainer.value,
        view.file.path,
        plugin
    );
    
    // 优化：使用 MutationObserver 替代固定延迟，更快响应
    const fixMediaExtendedLayout = () => {
        if (!videoContainer.value) return;
        
        // 1. 处理外部容器 (.media-embed)
        const mediaEmbed = videoContainer.value.querySelector('.media-embed');
        if (mediaEmbed) {
            (mediaEmbed as HTMLElement).style.setProperty('height', '100%', 'important');
            (mediaEmbed as HTMLElement).style.setProperty('width', '100%', 'important');
            (mediaEmbed as HTMLElement).style.setProperty('padding-bottom', '0', 'important');
            (mediaEmbed as HTMLElement).style.setProperty('position', 'absolute', 'important');
        }

        // 2. 处理 Shadow DOM 内部
        const shadowHosts = videoContainer.value.querySelectorAll('.mx-player-shadow-root, .media-embed');
        
        shadowHosts.forEach(host => {
            const shadowRoot = (host as any).shadowRoot;
            if (shadowRoot && !shadowRoot.querySelector('.langr-injected-style')) {
                const style = document.createElement('style');
                style.className = 'langr-injected-style';
                style.textContent = `
                    video, iframe, .mx-video-player, .plyr {
                        width: 100% !important;
                        height: 100% !important;
                        max-height: none !important;
                        object-fit: contain !important;
                    }
                    .plyr__video-wrapper {
                        height: 100% !important;
                    }
                    .plyr__controls, .mx-controls, .mx-toolbar {
                        z-index: 10000 !important;
                        opacity: 1 !important;
                        visibility: visible !important;
                    }
                    .ytp-chrome-top, .ytp-title, .ytp-share-button {
                        display: none !important;
                        opacity: 0 !important;
                    }
                `;
                shadowRoot.appendChild(style);
            }
        });

        // 3. 确保菜单可见
        const toolbar = videoContainer.value.querySelector('.media-embed-toolbar');
        if (toolbar) {
             (toolbar as HTMLElement).style.setProperty('z-index', '10000', 'important');
             (toolbar as HTMLElement).style.setProperty('display', 'flex', 'important');
             (toolbar as HTMLElement).style.setProperty('visibility', 'visible', 'important');
        }
    };

    // Timer refs for cleanup
    let shadowCheckTimer: number | null = null;
    let shadowCheckTimeout: number | null = null;
    let observerTimeout: number | null = null;

    // 使用 MutationObserver 监听 DOM 变化，一旦 media-embed 出现就立即处理
    const observer = new MutationObserver((mutations, obs) => {
        const mediaEmbed = videoContainer.value?.querySelector('.media-embed');
        if (mediaEmbed) {
            fixMediaExtendedLayout();
            // 继续观察 Shadow DOM 的创建
            shadowCheckTimer = window.setInterval(() => {
                const shadowHost = videoContainer.value?.querySelector('.mx-player-shadow-root');
                if (shadowHost && (shadowHost as any).shadowRoot) {
                    fixMediaExtendedLayout();
                    if (shadowCheckTimer) { clearInterval(shadowCheckTimer); shadowCheckTimer = null; }
                }
            }, 100);
            // 5秒后停止检查
            shadowCheckTimeout = window.setTimeout(() => {
                if (shadowCheckTimer) { clearInterval(shadowCheckTimer); shadowCheckTimer = null; }
            }, 5000);
        }
    });

    observer.observe(videoContainer.value, { childList: true, subtree: true });

    // 3秒超时兜底
    observerTimeout = window.setTimeout(() => {
        observer.disconnect();
        fixMediaExtendedLayout();
    }, 3000);

    clean(() => {
        if (shadowCheckTimer) { clearInterval(shadowCheckTimer); shadowCheckTimer = null; }
        if (shadowCheckTimeout) { clearTimeout(shadowCheckTimeout); shadowCheckTimeout = null; }
        if (observerTimeout) { clearTimeout(observerTimeout); observerTimeout = null; }
        observer.disconnect();
        videoContainer.value?.empty();
    });
});

// 监听高度变化，确保 Media Extended 容器同步调整
watch(videoHeight, () => {
    if (!videoContainer.value) return;
    // 确保 Media Extended 容器填充父容器
    const mediaEmbed = videoContainer.value.querySelector('.media-embed');
    if (mediaEmbed) {
        (mediaEmbed as HTMLElement).style.height = '100%';
        (mediaEmbed as HTMLElement).style.width = '100%';
    }
});

function normalizeLangrAudio(raw: unknown): string {
    if (typeof raw !== "string") return "";
    let normalized = raw.trim();
    if (!normalized) return "";

    // Strip surrounding quotes from YAML values.
    normalized = normalized.replace(/^['"]|['"]$/g, "").trim();

    // Support wiki-link style: [[path/to/file.mp3]] or [[file.mp3|alias]].
    const wikiMatch = normalized.match(/^!?\[\[([^\]]+)\]\]$/);
    if (wikiMatch) {
        normalized = wikiMatch[1];
        if (normalized.includes("|")) normalized = normalized.split("|")[0];
        if (normalized.includes("#")) normalized = normalized.split("#")[0];
        normalized = normalized.trim();
    }

    return normalized;
}

function getLocalFileUrl(path: string): string {
    const prefix = Platform.isDesktopApp ? "app://local/" : "http://localhost/_capacitor_file_";
    return prefix + encodeURI(path.replace(/\\/g, "/"));
}

function resolveVaultAudioPath(path: string): string {
    const normalized = path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "").trim();
    if (!normalized) return "";

    const fromLink = plugin.app.metadataCache.getFirstLinkpathDest(normalized, view.file.path);
    if (fromLink instanceof TFile) return plugin.app.vault.getResourcePath(fromLink);

    const fromVault = plugin.app.vault.getAbstractFileByPath(normalized);
    if (fromVault instanceof TFile) return plugin.app.vault.getResourcePath(fromVault);

    // Fallback: match by filename across vault for values like "xxx.mp3".
    const lower = normalized.toLowerCase();
    const byName = plugin.app.vault.getFiles().find((file) => {
        return file.path.toLowerCase() === lower || file.name.toLowerCase() === lower;
    });
    if (byName instanceof TFile) return plugin.app.vault.getResourcePath(byName);

    return "";
}

// 处理音频字段
let audioSource = normalizeLangrAudio(frontMatter["langr-audio"]);

// 处理本地文件路径
if (audioSource) {
    // 检测是否为系统绝对路径（Windows: C:/, D:/ 等，Unix: /path/to/file）
    const isWindowsAbsolutePath = /^[A-Za-z]:[\\/]/.test(audioSource);
    const isUnixAbsolutePath = audioSource.startsWith("/") && !audioSource.startsWith("//");
    const isAbsolutePath = isWindowsAbsolutePath || isUnixAbsolutePath;

    if (audioSource.startsWith("~/")) {
        // ~/audio.mp3 -> vault 根目录下文件
        const relativePath = audioSource.slice(2).replace(/^[\\/]+/, "");
        const resolved = resolveVaultAudioPath(relativePath);
        audioSource = resolved || getLocalFileUrl(plugin.constants.basePath + "/" + relativePath);
    } else if (isAbsolutePath) {
        // 系统绝对路径（如 D:/music/file.mp3 或 /home/user/music/file.mp3）
        audioSource = getLocalFileUrl(audioSource);
    } else if (!audioSource.startsWith("http://") && !audioSource.startsWith("https://") && !audioSource.startsWith("app://")) {
        // Vault 内部相对路径（如 "03-Resources/aloud/audio.mp3"）
        const resolved = resolveVaultAudioPath(audioSource);
        if (resolved) {
            audioSource = resolved;
        } else {
            logger.warn("[Language Learner] langr-audio file not found:", audioSource);
            audioSource = "";
        }
    }
    // http:// 和 https:// 开头的 URL 直接使用，无需处理
}

// 验证音频 URL 是否有效
if (audioSource) {
    const audioExtensions = ['.mp3', '.wav', '.m4a', '.ogg', '.webm', '.flac'];
    const hasValidExtension = audioExtensions.some(ext => 
        audioSource.toLowerCase().includes(ext)
    );
    
    if (!hasValidExtension) {
        logger.warn("[Language Learner] Invalid audio URL - not an audio file:", audioSource);
        logger.warn("[Language Learner] langr-audio should point to an audio file (.mp3, .wav, etc.), not a web page");
        // 清空无效的音频源，避免显示无法播放的播放器
        audioSource = "";
    }
}

// 记笔记
let activeNotes = ref(false);
let notes = ref("");
async function afterNoteEnter() {
    notes.value = await view.readContent("notes", true);
}
async function afterNoteLeave() {
    view.writeContent("notes", notes.value);
}

let renderedNote = ref<HTMLElement>();
watchEffect(async (clean) => {
    if (!renderedNote.value) return;
    await MarkdownRenderer.renderMarkdown(
        notes.value,
        renderedNote.value,
        view.file.path,
        null
    );
    clean(() => {
        renderedNote.value?.empty();
    });
});

function onMouseOver(e: MouseEvent) {
    let target = e.target as HTMLElement;
    if (target.hasClass("internal-link")) {
        app.workspace.trigger("hover-link", {
            event: e,
            source: "preview",
            hoverParent: { hoverPopover: null },
            targetEl: target,
            linktext: target.getAttr("href"),
            soursePath: view.file.path,
        });
    }
}

// 拆分文本
let lines = view.text.split("\n");
let segments = view.divide(lines);
if (!segments["article"]) {
    segments["article"] = { start: 0, end: lines.length };
}

let article = lines.slice(segments["article"].start, segments["article"].end);
let totalLines = article.length;

// 计数
let unknown = ref(0);
let learn = ref(0);
let ignore = ref(0);
let countChange = ref(true);
let refreshCount = () => {
    countChange.value = !countChange.value;
};

if (plugin.settings.word_count) {
    watch(
        [countChange],
        async () => {
            [unknown.value, learn.value, ignore.value] =
                await plugin.parser.countWords(article.join("\n"));
        },
        { immediate: true }
    );

    // 数据库就绪后重新统计
    plugin.db.waitForReady().then(() => {
        if (unknown.value === 0 && learn.value === 0 && ignore.value === 0) {
            refreshCount();
        }
    });

}

// 追踪当前播放的音频
let currentAudio: HTMLAudioElement | null = null;
let currentAudioMarker: HTMLElement | null = null;

// Main audio controls
const mainAudioRef = ref<HTMLAudioElement | null>(null);
const isMainAudioPlaying = ref(false);

function toggleMainAudio() {
    if (!mainAudioRef.value) return;
    
    // If inline audio is playing, stop it
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    if (currentAudioMarker) {
        currentAudioMarker.classList.remove("playing");
        currentAudioMarker = null;
    }

    if (mainAudioRef.value.paused) {
        mainAudioRef.value.play().catch(err => {
            logger.error("Failed to play main audio:", err);
        });
    } else {
        mainAudioRef.value.pause();
    }
}

function onMainAudioPlay() {
    isMainAudioPlaying.value = true;
}

function onMainAudioPause() {
    isMainAudioPlaying.value = false;
}

function onMainAudioEnded() {
    isMainAudioPlaying.value = false;
}

function onAudioLoadStart() {
    // audio load started
}

function onAudioCanPlay() {
    // audio ready to play
}

function onAudioError(event: Event) {
    const audio = event.target as HTMLAudioElement;
    let errorMessage = "Unknown error";
    
    if (audio.error) {
        switch (audio.error.code) {
            case MediaError.MEDIA_ERR_ABORTED:
                errorMessage = "Audio loading aborted";
                break;
            case MediaError.MEDIA_ERR_NETWORK:
                errorMessage = "Network error while loading audio";
                break;
            case MediaError.MEDIA_ERR_DECODE:
                errorMessage = "Audio decoding failed - unsupported format";
                break;
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                errorMessage = "Audio source not supported or not found";
                break;
        }
    }
    
    logger.error("[Language Learner] Audio error:", errorMessage);
    logger.error("[Language Learner] Audio source:", audioSource);
    logger.error("[Language Learner] Error details:", audio.error);
    
    new Notice(`Audio playback error: ${errorMessage}`);
}

// 处理音频点击
function handleAudioClick(e: MouseEvent) {
    const target = (e.target as HTMLElement).closest(".langr-audio-inline-marker");
    if (target) {
        e.preventDefault();
        e.stopPropagation();
        const marker = target as HTMLElement;
        const src = marker.dataset.src;
        if (src) {
            // 如果点击的是当前正在播放的音频，则暂停
            if (currentAudio && currentAudioMarker === marker) {
                if (currentAudio.paused) {
                    // Stop main audio if playing
                    if (mainAudioRef.value && !mainAudioRef.value.paused) {
                        mainAudioRef.value.pause();
                    }
                    
                    currentAudio.play().catch(err => {
                        logger.error("Failed to play audio:", err);
                    });
                    marker.classList.add("playing");
                } else {
                    currentAudio.pause();
                    marker.classList.remove("playing");
                }
            } else {
                // 停止之前的音频并移除样式
                if (currentAudio) {
                    currentAudio.pause();
                    currentAudio = null;
                }
                
                // Stop main audio if playing
                if (mainAudioRef.value && !mainAudioRef.value.paused) {
                    mainAudioRef.value.pause();
                }

                if (currentAudioMarker) {
                    currentAudioMarker.classList.remove("playing");
                    currentAudioMarker = null;
                }
                
                // 播放新音频
                const audio = new Audio(src);
                currentAudio = audio;
                currentAudioMarker = marker;
                
                audio.play().catch(err => {
                    logger.error("Failed to play audio:", err);
                    currentAudio = null;
                    currentAudioMarker = null;
                });
                
                marker.classList.add("playing");
                
                // 音频结束时清除状态 (use { once: true } to auto-remove listener and prevent memory leaks)
                audio.addEventListener("ended", () => {
                    marker.classList.remove("playing");
                    if (currentAudio === audio) {
                        currentAudio = null;
                        currentAudioMarker = null;
                    }
                }, { once: true });
            }
        }
    }
}

// 普通鼠标点击之外，允许键盘用户通过 Enter/Space 查词。
function handleWordKeydown(e: KeyboardEvent) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = (e.target as HTMLElement | null)?.closest(".word, .phrase") as HTMLElement | null;
    if (!target) return;
    const word = target.textContent?.trim();
    if (!word) return;
    e.preventDefault();
    const rect = target.getBoundingClientRect();
    void plugin.queryWord(word, target, { x: rect.left + rect.width / 2, y: rect.top });
}

onMounted(() => {
    if (plugin.settings.word_count) {
        addEventListener("qiaomu-english-event-refresh", refreshCount);
    }
    if (contentEl) {
        // Inline audio must work even when the optional word-count bar is disabled.
        contentEl.addEventListener("click", handleAudioClick);
        contentEl.addEventListener("keydown", handleWordKeydown);
    }
});

onUnmounted(() => {
    if (plugin.settings.word_count) {
        removeEventListener("qiaomu-english-event-refresh", refreshCount);
    }
    if (contentEl) {
        contentEl.removeEventListener("click", handleAudioClick);
        contentEl.removeEventListener("keydown", handleWordKeydown);
    }
});

// 分页渲染文本

const pageSizes = [
    { label: `1 ${t("paragraph")} / ${t("page")}`, value: 2 },
    { label: `2 ${t("paragraph")} / ${t("page")}`, value: 4 },
    { label: `4 ${t("paragraph")} / ${t("page")}`, value: 8 },
    { label: `8 ${t("paragraph")} / ${t("page")}`, value: 16 },
    { label: `16 ${t("paragraph")} / ${t("page")}`, value: 32 },
    { label: `${t("All")}`, value: Number.MAX_VALUE },
];

const pageSlot = Platform.isMobileApp ? 5 : null;

let dp = plugin.settings.default_paragraphs;
let pageSize = dp === "all" ? ref(Number.MAX_VALUE) : ref(parseInt(dp));
let page = view.lastPos
    ? ref(Math.ceil(view.lastPos / pageSize.value))
    : ref(1);

let renderedText = ref("");
let psChange = ref(true); // 标志pageSize的改变

const readingWidthClass = computed(() => `reading-width-${store.readingWidthMode}`);
const readingAreaStyle = computed<Record<string, string>>(() => ({
    flex: "1",
    overflow: "auto",
    fontSize: store.fontSize,
    fontFamily: store.fontFamily,
    lineHeight: store.lineHeight,
    "--qiaomu-english-reading-side-spacing": `${store.readingSideSpacing}%`,
}));

// 内联字号调节(A- / A+):改 store 即时生效，并持久化到设置(与设置面板同款写法)。
function adjustReadingFontSize(delta: number) {
    const cur = parseInt(store.fontSize) || 16;
    const next = Math.max(10, Math.min(32, cur + delta));
    store.fontSize = next + "px";
    plugin.settings.font_size = store.fontSize;
    plugin.saveSettings();
}

// 键盘翻页:仅当本阅读视图为当前激活视图、且焦点不在输入框时，← / → 翻页。
function onReadingKeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (plugin.app.workspace.getActiveViewOfType(ReadingView) !== view) return;
    const el = e.target as HTMLElement;
    const tag = el?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
    if (e.key === "ArrowLeft" && page.value > 1) {
        page.value--;
        e.preventDefault();
    } else if (e.key === "ArrowRight" && page.value * pageSize.value < totalLines) {
        page.value++;
        e.preventDefault();
    }
}
onMounted(() => addEventListener("keydown", onReadingKeydown));
onUnmounted(() => removeEventListener("keydown", onReadingKeydown));
let refreshHandle = ref(true);
let renderToken = 0;
const hoverDelay = 180;
const hoverCache = new Map<string, { value: string; ts: number }>();
const hoverCacheTTL = 5 * 60 * 1000;
let hoverTimer: number | null = null;
let hoverTarget: HTMLElement | null = null;
let hoverTooltipEl: HTMLDivElement | null = null;
let hoverRequestId = 0;

function waitForIdle(): Promise<void> {
    return new Promise((resolve) => {
        if ("requestIdleCallback" in window) {
            (window as any).requestIdleCallback(() => resolve(), { timeout: 200 });
        } else {
            setTimeout(() => resolve(), 0);
        }
    });
}

// pageSize变化应该使page同时进行调整以尽量保持原阅读位置
// 同时page和pageSize的改变都应该引起langr-pos的改变，但应只修改一次
// 因此引入psChange这个变量
watch([pageSize], async ([ps], [prev_ps]) => {
    let oldPage = page.value;
    page.value = Math.ceil(((page.value - 1) * prev_ps + 1) / ps);
    if (oldPage === page.value) {
        psChange.value = !psChange.value;
    }
});

//监视 page、psChange 和 refreshHandle 的变化，并在变化时执行分页计算、解析文章片段、更新渲染的文本以及更新前置元数据。
watch(
    [page, psChange, refreshHandle],
    async ([p, pc], [prev_p, prev_pc]) => {
        const token = ++renderToken;
        let start = (p - 1) * pageSize.value;
        let end =
            start + pageSize.value > totalLines
                ? totalLines
                : start + pageSize.value;

        await waitForIdle();
        if (token !== renderToken) {
            return;
        }

        const html = await plugin.parser.parse(
            article.slice(start, end).join("\n")
        );
        if (token !== renderToken) {
            return;
        }
        renderedText.value = html;
        await nextTick();

        if (token !== renderToken) {
            return;
        }

        if (p !== prev_p || pc != prev_pc) {
            plugin.frontManager.setFrontMatter(
                view.file,
                "langr-pos",
                `${(p - 1) * pageSize.value + 1}`
            );
        }
        processContent();
    },
    { immediate: true }
);

watch(renderedText, () => {
    hideHoverTooltip();
});

// 设置阅读文字样式

let finishReadingInProgress = false;

class ConfirmFinishReadingModal extends Modal {
    private message: string;
    private onConfirm: () => void;

    constructor(app: any, message: string, onConfirm: () => void) {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        this.titleEl.setText(t("Confirm"));
        contentEl.createEl("p", { text: this.message });
        const btnRow = contentEl.createDiv({ cls: "ll-confirm-row" });
        btnRow.style.display = "flex";
        btnRow.style.justifyContent = "flex-end";
        btnRow.style.gap = "8px";
        btnRow.style.marginTop = "12px";

        const cancelBtn = btnRow.createEl("button", { text: t("Cancel") });
        cancelBtn.addEventListener("click", () => this.close());

        const okBtn = btnRow.createEl("button", { text: t("Confirm") });
        okBtn.addEventListener("click", () => {
            this.close();
            this.onConfirm();
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

function confirmFinishReading() {
    if (finishReadingInProgress) return;

    const hasNextPage = page.value * pageSize.value < totalLines;
    const message = hasNextPage
        ? t("Finish page and ignore new words")
        : t("Finish reading and ignore new words");

    const modal = new ConfirmFinishReadingModal(plugin.app, message, async () => {
        if (finishReadingInProgress) return;
        finishReadingInProgress = true;
        try {
            await addIgnores();
        } catch (e) {
            logger.error("[Language Learner] Finish reading failed", e);
        } finally {
            finishReadingInProgress = false;
        }
    });
    modal.open();
}

// 添加无视单词
async function addIgnores() {
    let ignores = contentEl.querySelectorAll(
        ".word.new"
    ) as unknown as HTMLElement[];
    let ignore_words: Set<string> = new Set();
    ignores.forEach((el) => {
        ignore_words.add(el.textContent.toLowerCase());
    });
    await plugin.db.postIgnoreWords([...ignore_words]);
    // this.setViewData(this.data)
    refreshHandle.value = !refreshHandle.value;
    dispatchEvent(new CustomEvent("qiaomu-english-event-refresh-stat"));

    if (page.value * pageSize.value < totalLines) {
        page.value++;
    } else {
        // 最后一页，标记学习完成 (Learning Hub 集成)
        await markLearningCompleted();
    }

    refreshCount();
    processContent();
}

// 标记学习完成 (Learning Hub 集成)
async function markLearningCompleted() {
    const activeFile = plugin.app.workspace.getActiveFile();
    if (!activeFile) return;
    
    try {
        const wordsCount = await plugin.getWordsCountForFile(activeFile.path);
        const today = new Date().toISOString().split('T')[0];
        
        await plugin.frontManager.setFrontMatter(activeFile, 'status', 'completed');
        await plugin.frontManager.setFrontMatter(activeFile, 'completed', today);
        await plugin.frontManager.setFrontMatter(activeFile, 'words_collected', String(wordsCount));
        
        new Notice(`✅ 学习完成！收集了 ${wordsCount} 个生词`);
    } catch (e) {
        logger.error('Failed to mark as completed:', e);
    }
}

// processContent 已统一使用 plugin.ts 的导出版本（DOM API 实现，无 innerHTML 注入）

let reading = ref(null);
let prevEl: HTMLElement = null;
const hoverScrollHandler = () => hideHoverTooltip();

function getHoverCache(word: string) {
    const cached = hoverCache.get(word);
    if (!cached) return null;
    if (Date.now() - cached.ts > hoverCacheTTL) {
        hoverCache.delete(word);
        return null;
    }
    return cached.value;
}

function setHoverCache(word: string, value: string) {
    // Evict oldest entries when cache exceeds 500 entries
    if (hoverCache.size >= 500) {
        const firstKey = hoverCache.keys().next().value;
        if (firstKey) hoverCache.delete(firstKey);
    }
    hoverCache.set(word, { value, ts: Date.now() });
}

function ensureHoverTooltip(): HTMLDivElement {
    if (hoverTooltipEl) return hoverTooltipEl;
    hoverTooltipEl = document.createElement("div");
    hoverTooltipEl.className = "ll-hover-tooltip";
    hoverTooltipEl.style.display = "none";
    document.body.appendChild(hoverTooltipEl);
    return hoverTooltipEl;
}

function clearHoverTimer() {
    if (hoverTimer !== null) {
        window.clearTimeout(hoverTimer);
        hoverTimer = null;
    }
}

function hideHoverTooltip() {
    clearHoverTimer();
    hoverTarget = null;
    hoverRequestId++;
    if (hoverTooltipEl) {
        hoverTooltipEl.style.display = "none";
        hoverTooltipEl.textContent = "";
    }
}

function isHoverCandidate(target: HTMLElement): HTMLElement | null {
    if (!plugin.settings.hover_definition_enabled) return null;
    const wordEl = target.closest("span.word, span.phrase") as HTMLElement | null;
    if (!wordEl) return null;
    const rawText = wordEl.textContent?.trim() || "";
    if (!rawText || !/[A-Za-z]/.test(rawText)) return null;
    return wordEl;
}

function positionHoverTooltip(targetEl: HTMLElement, tooltipEl: HTMLDivElement) {
    const rect = targetEl.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();
    const spacing = 6;
    let top = rect.top - tooltipRect.height - spacing;
    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
    if (top < 8) {
        top = rect.bottom + spacing;
        tooltipEl.classList.add("ll-hover-tooltip--below");
    } else {
        tooltipEl.classList.remove("ll-hover-tooltip--below");
    }
    left = Math.min(Math.max(left, 8), window.innerWidth - tooltipRect.width - 8);
    tooltipEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
}

const hoverTranslationTimeoutMs = 4000;

function decodeHoverHtmlEntities(input: string): string {
    if (!input) return '';
    const textarea = document.createElement("textarea");
    let value = input;
    for (let i = 0; i < 3; i++) {
        textarea.innerHTML = value;
        const decoded = textarea.value;
        if (decoded === value) {
            break;
        }
        value = decoded;
    }
    return value;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
    let timeoutId: number | null = null;
    const timeoutPromise = new Promise<null>((resolve) => {
        timeoutId = window.setTimeout(() => resolve(null), timeoutMs);
    });
    const result = await Promise.race([promise, timeoutPromise]);
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    return result as T | null;
}

async function translateWithGoogle(word: string, targetLang: string): Promise<string | null> {
    const result = await googleTranslate(word, { native: targetLang });
    const translated = result?.result?.tgt?.trim();
    if (!translated || translated.toLowerCase() === word.toLowerCase()) return null;
    return decodeHoverHtmlEntities(translated);
}

async function translateWithMyMemory(word: string, targetLang: string): Promise<string | null> {
    try {
        const langPair = `en|${targetLang}`;
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=${encodeURIComponent(langPair)}`;
        const response = await withTimeout(requestUrl({ url, method: "GET" }), hoverTranslationTimeoutMs);
        if (!response) return null;
        const data = response.json;
        const translated = data?.responseData?.translatedText?.trim?.();
        if (!translated || translated.toLowerCase() === word.toLowerCase()) return null;
        return decodeHoverHtmlEntities(translated);
    } catch (e) {
        logger.warn('[ReadingArea] translateWithMyMemory failed:', e);
        return null;
    }
}

async function translateWithBing(word: string): Promise<string | null> {
    try {
        const url = `https://cn.bing.com/dict/search?q=${encodeURIComponent(word)}&mkt=zh-cn`;
        const response = await withTimeout(requestUrl({ url, method: "GET" }), hoverTranslationTimeoutMs);
        if (!response) return null;
        // Use DOMParser for robust HTML parsing instead of regex
        const parser = new DOMParser();
        const doc = parser.parseFromString(response.text, 'text/html');
        const items = doc.querySelectorAll('.qdef ul > li');
        if (!items.length) return null;
        const defs: string[] = [];
        items.forEach(li => {
            const pos = li.querySelector('.pos')?.textContent?.trim() || '';
            const def = li.querySelector('.def')?.textContent?.trim() || '';
            if (def && pos !== 'web' && !pos.includes('网络')) {
                defs.push(pos ? `${pos} ${def}` : def);
            }
        });
        return defs.length > 0 ? defs.join('  ') : null;
    } catch (e) {
        logger.warn('[ReadingArea] translateWithBing failed:', e);
        return null;
    }
}

async function translateWithYoudao(word: string): Promise<string | null> {
    try {
        const url = `https://dict.youdao.com/jsonapi_s?doctype=json&jsonversion=4&le=en&q=${encodeURIComponent(word)}`;
        const response = await withTimeout(requestUrl({ url, method: "GET" }), hoverTranslationTimeoutMs);
        if (!response) return null;
        const data = response.json;
        const ec = data?.ec?.word?.[0]?.trs;
        if (!ec || ec.length === 0) return null;
        const defs: string[] = [];
        for (const tr of ec) {
            const pos = tr.pos || '';
            const tran = tr.tran || '';
            if (tran) defs.push(pos ? `${pos} ${tran}` : tran);
        }
        return defs.length > 0 ? defs.join('  ') : null;
    } catch (e) {
        logger.warn('[ReadingArea] translateWithYoudao failed:', e);
        return null;
    }
}

async function getHoverDefinition(word: string): Promise<string | null> {
    const cached = getHoverCache(word);
    if (cached) return cached;
    const hoverLang = (plugin.settings.hover_definition_lang || "").trim() || "zh";
    const nativeLang = (plugin.settings.native || "").trim();
    const useNative = nativeLang && hoverLang.toLowerCase() === nativeLang.toLowerCase();

    try {
        await plugin.db.waitForReady();
    } catch (err) {
        logger.warn("[Language Learner] DB not ready for hover definition", err);
    }

    if (useNative) {
        try {
            const expr = await plugin.db.getExpression(word);
            if (expr?.meaning?.trim()) {
                const meaning = expr.meaning.trim();
                setHoverCache(word, meaning);
                return meaning;
            }
        } catch (err) {
            logger.warn("[Language Learner] Hover definition DB lookup failed", err);
        }
    }

    try {
        const provider = (plugin.settings.hover_definition_provider || "auto").toLowerCase();
        const googlePromise = () => withTimeout(translateWithGoogle(word, hoverLang), hoverTranslationTimeoutMs);
        const myMemoryPromise = () => withTimeout(translateWithMyMemory(word, hoverLang), hoverTranslationTimeoutMs);
        const bingPromise = () => withTimeout(translateWithBing(word), hoverTranslationTimeoutMs);
        const youdaoPromise = () => withTimeout(translateWithYoudao(word), hoverTranslationTimeoutMs);

        let translated: string | null = null;

        if (provider === "bing") {
            translated = await bingPromise();
        } else if (provider === "youdao") {
            translated = await youdaoPromise();
        } else if (provider === "auto") {
            translated = (await googlePromise()) || (await myMemoryPromise());
        } else if (provider === "google") {
            translated = await googlePromise();
        } else if (provider === "mymemory") {
            translated = await myMemoryPromise();
        } else {
            translated = await googlePromise();
        }

        if (translated) {
            setHoverCache(word, translated);
            return translated;
        }
    } catch (err) {
        logger.warn("[Language Learner] Hover definition translation failed", err);
    }

    return null;
}

// showHoverTooltip is disabled: SubtitlePopup (global hover) now handles
// all word lookups for both subtitles (.lf-word) and reading mode (.word/.phrase)
async function showHoverTooltip(_wordEl: HTMLElement) {
    return;
}

function scheduleHover(wordEl: HTMLElement) {
    if (hoverTarget !== wordEl) {
        hideHoverTooltip();
        hoverTarget = wordEl;
    }
    clearHoverTimer();
    hoverTimer = window.setTimeout(() => {
        showHoverTooltip(wordEl);
    }, hoverDelay);
}

function handleHoverPointerOver(e: PointerEvent) {
    const target = e.target as HTMLElement;
    const wordEl = isHoverCandidate(target);
    if (!wordEl) return;
    scheduleHover(wordEl);
}

function handleHoverPointerOut(e: PointerEvent) {
    if (!hoverTarget) return;
    const target = e.target as HTMLElement;
    if (target !== hoverTarget) return;
    const related = e.relatedTarget as Node | null;
    if (related && hoverTarget.contains(related)) {
        return;
    }
    hideHoverTooltip();
}
//用户选择单词的事件
if (plugin.constants.platform === "mobile") {
    useEvent(reading, "click", (e) => {
        let target = e.target as HTMLElement;
        if (target.hasClass("word") || target.hasClass("phrase")) {
            e.preventDefault();
            e.stopPropagation();
            if (prevEl) {
                let selectSpan = view.wrapSelect(prevEl, target);
                if (selectSpan) {
                    plugin.queryWord(
                        selectSpan.textContent,
                        selectSpan,
                        { x: e.pageX, y: e.pageY }
                    );
                }
                prevEl = null;
            } else {
                prevEl = target;
            }
        } else {
            view.removeSelect();
            prevEl = null;
        }

    });
} else {
    useEvent(reading, "pointerover", handleHoverPointerOver);
    useEvent(reading, "pointerout", handleHoverPointerOut);
    useEvent(reading, "pointerdown", (e) => {
        let target = e.target as HTMLElement;
        if (target.hasClass("word") || target.hasClass("phrase") || target.hasClass("select")) {
            prevEl = target;
        }
    });
    useEvent(reading, "pointerup", (e) => {
        let target = e.target as HTMLElement;
        if (target.hasClass("word") || target.hasClass("phrase") || target.hasClass("select")) {
            e.preventDefault();
            e.stopPropagation();
            if (prevEl) {
                let selectSpan = view.wrapSelect(prevEl, target);
                if (selectSpan) {
                    plugin.queryWord(
                        selectSpan.textContent,
                        selectSpan,
                        { x: e.pageX, y: e.pageY }
                    );
                }
                prevEl = null;
            }
        } else {
            view.removeSelect();
        }
    });
}

onMounted(() => {
    if (textAreaRef.value) {
        textAreaRef.value.addEventListener("scroll", hoverScrollHandler, { passive: true });
    }
});

onUnmounted(() => {
    // 清理滚动事件监听器
    if (textAreaRef.value) {
        textAreaRef.value.removeEventListener("scroll", hoverScrollHandler);
    }
    // 清理悬浮提示元素
    if (hoverTooltipEl) {
        hoverTooltipEl.remove();
        hoverTooltipEl = null;
    }
    // 清理拖动调整大小的事件监听器（鼠标 + 触屏）
    document.removeEventListener('mousemove', onResize);
    document.removeEventListener('mouseup', stopResize);
    document.removeEventListener('touchmove', onResizeTouch);
    document.removeEventListener('touchend', stopResizeTouch);
    // 清理当前播放的音频
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    if (currentAudioMarker) {
        currentAudioMarker.classList.remove("playing");
        currentAudioMarker = null;
    }
});
</script>

<style lang="scss">
#qiaomu-english-reading {
    user-select: none;

    .function-area {
        padding: 10px 18px 12px;
        border-bottom: 1px solid var(--background-modifier-border);
        background: var(--background-primary);

        button {
            width: auto;
        }
    }

    .reading-toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 38px;
    }

    .reading-toolbar-progress {
        display: flex;
        flex: 1;
        align-items: center;
        justify-content: center;
        min-width: 0;
        padding: 0 12px;
    }

    .reading-toolbar .finish-reading {
        flex: 0 0 auto;
        margin-left: auto;
    }

    .text-area {
        /* pan-y: allow native vertical scroll; taps still fire click events for word selection */
        touch-action: pan-y;
        box-sizing: border-box;
        padding-inline: max(16px, 5%);

        &.reading-width-full {
            padding-inline: 0;
        }

        &.reading-width-manual {
            padding-inline: var(--qiaomu-english-reading-side-spacing, 5%);
        }

        .langr-article-body {
            width: min(100%, 72ch);
            max-width: 72ch;
            margin-inline: auto;
        }

        &.reading-width-full .langr-article-body,
        &.reading-width-manual .langr-article-body {
            width: 100%;
            max-width: none;
        }

        span.word {
            user-select: contain;
            cursor: pointer;
            border-radius: 3px;
            transition: color 0.14s ease, background-color 0.14s ease, border-color 0.14s ease;
            padding: 1px 0;
        }

        span.phrase {
            background-color: transparent;
            padding: 2px 0;
            cursor: pointer;
            border-radius: 3px;
            transition: color 0.14s ease, background-color 0.14s ease, border-color 0.14s ease;
        }

        span.stns {
            border: 1px solid transparent;
        }

        /* 单词状态颜色由主题 CSS 变量控制，见 plugin.ts applyWordColorTheme() */
        span {
            &.new       { color: var(--langr-new-color);      background: var(--langr-new-bg);      border-bottom: var(--langr-new-border); }
            &.learning  { color: var(--langr-learning-color);  background: var(--langr-learning-bg);  border-bottom: var(--langr-learning-border); }
            &.familiar  { color: var(--langr-familiar-color);  background: var(--langr-familiar-bg);  border-bottom: var(--langr-familiar-border); }
            &.known     { color: var(--langr-known-color);     background: var(--langr-known-bg);     border-bottom: var(--langr-known-border); }
            &.learned   { color: var(--langr-learned-color);   background: var(--langr-learned-bg);   border-bottom: var(--langr-learned-border); }

            &.new:hover       { color: var(--langr-new-hover-color, var(--langr-new-color));           background: var(--langr-new-hover-bg, var(--langr-new-bg)); }
            &.learning:hover  { color: var(--langr-learning-hover-color, var(--langr-learning-color)); background: var(--langr-learning-hover-bg, var(--langr-learning-bg)); }
            &.familiar:hover  { color: var(--langr-familiar-hover-color, var(--langr-familiar-color)); background: var(--langr-familiar-hover-bg, var(--langr-familiar-bg)); }
            &.known:hover     { color: var(--langr-known-hover-color, var(--langr-known-color));       background: var(--langr-known-hover-bg, var(--langr-known-bg)); }
            &.learned:hover   { color: var(--langr-learned-hover-color, var(--langr-learned-color));   background: var(--langr-learned-hover-bg, var(--langr-learned-bg)); }
        }

        .select {
            background-color: var(--text-selection, rgba(96, 165, 250, 0.22));
            border-color: var(--interactive-accent);

            &:hover {
                background-color: var(--text-selection, rgba(96, 165, 250, 0.28));
            }
        }
    }
}

@media (max-width: 600px) {
    #qiaomu-english-reading .text-area.reading-width-full,
    #qiaomu-english-reading .text-area.reading-width-manual {
        padding-inline: max(12px, var(--qiaomu-english-reading-side-spacing, 5%));
    }
}

#qiaomu-english-reading {
    .text-area {
        span.other {
            user-select: text;
        }

        .select {
            background-color: var(--text-selection, rgba(96, 165, 250, 0.22));
            padding: 2px 0;
            cursor: pointer;
            border: 1px solid var(--interactive-accent);
            border-radius: 3px;
            transition: background-color 0.14s ease, border-color 0.14s ease;

            &:hover {
                background-color: var(--text-selection, rgba(96, 165, 250, 0.28));
            }
        }
    }

    .note-area {
        display: flex;
        height: 100%;
        width: 100%;

        .note-input {
            flex: 1;
        }

        .note-rendered {
            border: 1px solid gray;
            border-radius: 3px;
            flex: 1;
            padding: 5px;
            margin-left: 2px;
            overflow: auto;
        }
    }
}

.is-mobile #qiaomu-english-reading {
    .pagination {
        padding-bottom: 48px;
    }
}

.ll-hover-tooltip {
    position: fixed;
    top: 0;
    left: 0;
    transform: translate3d(0, 0, 0);
    z-index: 10050;
    max-width: min(320px, 70vw);
    padding: 6px 10px;
    background: var(--background-secondary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s, 6px);
    font-size: 12px;
    line-height: 1.4;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    pointer-events: none;
    white-space: pre-wrap;
}

.ll-hover-tooltip--below {
    box-shadow: 0 -6px 18px rgba(0, 0, 0, 0.15);
}

/* 视频播放器可调整高度样式 */
.resizable-video-wrapper {
    position: relative;
    width: 100%;
    margin: 0 auto 20px;
    display: flex;
    flex-direction: column;
}

.video-container {
    flex: 1;
    width: 100%;
    min-height: 0; /* 关键：允许 flex 子项收缩 */
    border: 2px solid var(--background-modifier-border);
    border-radius: 8px;
    overflow: visible; /* 必须 visible 才能显示菜单 */
    background: var(--background-primary);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    position: relative;
    z-index: 1;
}

/* Media Extended 工具栏样式 */
.mx-toolbar {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 4px;
    z-index: 100;
    opacity: 0;
    transition: opacity 0.2s ease;
}

.resizable-video-wrapper:hover .mx-toolbar {
    opacity: 1;
}

.mx-toolbar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: var(--background-primary);
    color: var(--text-normal);
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transition: all 0.2s ease;
}

.mx-toolbar-btn:hover {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    transform: scale(1.05);
}

.mx-toolbar-btn:active {
    transform: scale(0.95);
}

.mx-toolbar-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.mx-toolbar-btn:disabled:hover {
    background: var(--background-primary);
    color: var(--text-normal);
    transform: none;
}

/* 正文行宽：宽屏下限制阅读列宽并居中，避免一行过长（~舒适阅读measure） */
.langr-article-body {
    width: min(100%, 72ch);
    max-width: 72ch;
    margin-inline: auto;
    padding: 18px 0 36px;
}

.langr-audio-missing {
    display: inline-flex;
    align-items: center;
    margin: 0 4px;
    padding: 1px 5px;
    border-bottom: 1px dashed var(--text-faint);
    color: var(--text-muted);
    font-size: 0.75em;
    opacity: 0.8;
    vertical-align: baseline;
}

.mx-toolbar-btn svg {
    width: 18px;
    height: 18px;
}

/* 拖动手柄样式 */
.resize-handle-bottom {
    height: 12px;
    background: transparent;
    cursor: ns-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.3s ease;
    z-index: 10;
    flex-shrink: 0;
}

/* 移除小蓝条视觉效果，保留拖动功能 */
.resize-handle-bottom::before {
    content: none;
}

/* 强力覆盖 Media Extended 外部样式 */
.video-container .media-embed, 
.video-container .mx-video-view {
    width: 100% !important;
    height: 100% !important;
    padding-bottom: 0 !important;
    position: absolute !important;
    top: 0;
    left: 0;
    /* 确保不遮挡菜单 */
    z-index: 1 !important;
}

/* 确保菜单可见 - 针对 Shadow DOM 外部的工具栏 */
.video-container .media-embed-toolbar,
.video-container .block-language-preview .menu-icon,
.video-container .clickable-icon {
    z-index: 10000 !important; /* 极高的 z-index */
    opacity: 1 !important;
    visibility: visible !important;
    display: flex !important;
    position: absolute !important;
    top: 8px !important;
    right: 8px !important;
    background: var(--background-primary) !important; /* 使用主题背景色 */
    border: 1px solid var(--background-modifier-border) !important;
    border-radius: 6px !important;
    padding: 4px !important;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2) !important;
    pointer-events: auto !important; /* 确保可点击 */
}

/* 工具栏内的图标间距 */
.video-container .media-embed-toolbar .clickable-icon {
    margin: 0 2px !important;
    position: static !important; /* 内部图标不需要绝对定位 */
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
}

.resizable-video-wrapper:hover .resize-handle-bottom {
    opacity: 0.6;
}

.resize-handle-bottom:hover {
    opacity: 1 !important;
}

.resize-icon {
    display: none;
}

/* 自定义音频播放器样式 */

/* 内联音频播放器（文本中的音频图标） */
.langr-audio-inline-marker {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    vertical-align: middle;
    width: 1.8em;
    height: 1.8em;
    margin: 0 0.2em;
    border-radius: 50%;
    background-color: var(--interactive-accent);
    color: var(--text-on-accent);
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    position: relative;
    
    /* 默认显示播放图标，隐藏暂停图标 */
    .play-icon {
        display: block;
        width: 70%;
        height: 70%;
    }
    
    .pause-icon {
        display: none;
        width: 70%;
        height: 70%;
    }
    
    &:hover {
        transform: scale(1.1);
        filter: brightness(1.1);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }

    &:active {
        transform: scale(0.95);
    }
    
    /* 播放状态 */
    &.playing {
        animation: audio-pulse 1.5s ease-in-out infinite;
        background-color: var(--interactive-accent-hover);
        box-shadow: 0 0 0 0.3em rgba(var(--interactive-accent-rgb), 0.3);
        
        /* 播放时显示暂停图标，隐藏播放图标 */
        .play-icon {
            display: none;
        }
        
        .pause-icon {
            display: block;
        }
    }
}

/* AI 语音 - 紫色 */
.langr-audio-ai {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    
    &:hover {
        background: linear-gradient(135deg, #7c8ff0 0%, #8b5bb8 100%);
    }
    
    &.playing {
        background: linear-gradient(135deg, #7c8ff0 0%, #8b5bb8 100%);
        box-shadow: 0 0 0 0.3em rgba(102, 126, 234, 0.3);
    }
}

/* 真人录音 - 橙红色 */
.langr-audio-human {
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    
    &:hover {
        background: linear-gradient(135deg, #f5a3ff 0%, #ff6b7e 100%);
    }
    
    &.playing {
        background: linear-gradient(135deg, #f5a3ff 0%, #ff6b7e 100%);
        box-shadow: 0 0 0 0.3em rgba(245, 87, 108, 0.3);
    }
}

@keyframes audio-pulse {
    0%, 100% {
        box-shadow: 0 0 0 0 rgba(var(--interactive-accent-rgb), 0.4);
    }
    50% {
        box-shadow: 0 0 0 0.5em rgba(var(--interactive-accent-rgb), 0);
    }
}

.langr-audio-block-wrapper {
    width: 100%;
    margin: 0.5em 0;

    audio {
        width: 100%;
        height: 2.5em; /* 随字体大小调整高度 */
        border-radius: 8px;
        outline: none;
    }
}

/* ── Mobile overrides ──────────────────────────────────────────────────── */

/* Video toolbar always visible on touch screens (no hover state) */
.is-mobile .mx-toolbar {
    opacity: 1 !important;
}

/* Resize handle: taller touch target, blocks scroll while dragging */
.is-mobile .resize-handle-bottom {
    height: 24px;
    touch-action: none;
}

/* Function area buttons: minimum 44px touch target per accessibility guidelines */
.is-mobile #qiaomu-english-reading {
    .function-area button {
        min-height: 44px;
        padding: 0 16px;
        font-size: 0.9375rem;
    }

    .reading-toolbar {
        flex-wrap: wrap;
    }

    .reading-toolbar-progress {
        order: 3;
        flex-basis: 100%;
        padding: 4px 0 0;
    }
}

/* Phone landscape: compact layout to maximise reading area */
@media (orientation: landscape) and (max-height: 500px) {
    .is-mobile #qiaomu-english-reading {
        .function-area {
            padding-bottom: 6px;
        }
        .pagination {
            padding-bottom: 8px;
        }
    }
    .is-mobile .resizable-video-wrapper {
        max-height: 40vh;
    }
}

</style>
