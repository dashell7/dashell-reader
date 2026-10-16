export function readerPageDirection(event) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229
        || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
    const target = event.composedPath?.()[0] || event.target;
    if (target?.isContentEditable || target?.closest?.("input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=slider],[role=menu],[role=tablist]")) return null;
    // Space remains native activation for controls reached with Tab.
    if (event.key === " " && target?.closest?.("button,a[href],[role=button]")) return null;
    return ["ArrowRight", "ArrowDown", " ", "PageDown"].includes(event.key) ? "next"
        : ["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key) ? "prev" : null;
}

export function bindReaderPageKeys(doc, navigate, ownsEvent = () => true) {
    const keydown = (event) => {
        const direction = readerPageDirection(event);
        if (!direction || !ownsEvent(event)) return;
        event.preventDefault();
        navigate(direction);
    };
    doc.addEventListener("keydown", keydown);
    return () => doc.removeEventListener("keydown", keydown);
}
