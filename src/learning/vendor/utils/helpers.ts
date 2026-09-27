export function playAudio(src: string) {
    new Audio(src).play().catch(() => {
        // 静默处理播放失败（如移动端自动播放限制、无效URL等）
    });
}