import { highlightBacklink } from "./highlight-navigation.js";
import { READER_BLOCK_SELECTOR } from "./pdf-page-mode.js";

/** Capture a location from the actual clicked word or selection, not the visible page. */
export function readerLookupContext(view, range, sectionIndex, expectedBookPath) {
  const file = view?.file;
  if (!file?.path || file.path !== expectedBookPath) return {};
  const result = { bookTitle: file.basename || file.name || "" };
  if (!range?.startContainer) return result;
  let anchor = null;
  if (view.engine) {
    if (!Number.isInteger(sectionIndex) || sectionIndex < 0) return result;
    try {
      const cfi = view.engine.cfiFromRange(sectionIndex, range);
      if (typeof cfi === "string" && cfi.startsWith("epubcfi(")) anchor = { cfi };
    } catch { /* A section may have been replaced during pagination. */ }
  } else {
    const flow = view.pager?.flow;
    const node = range.startContainer;
    if (!flow?.contains(node)) return result;
    const element = node.nodeType === 3 ? node.parentElement : node;
    const block = element?.closest?.(READER_BLOCK_SELECTOR);
    if (!block || !flow.contains(block)) return result;
    if (String(file.extension || "").toLowerCase() === "pdf") {
      const page = Number(block.closest("[data-pdf-page-no]")?.getAttribute("data-pdf-page-no"));
      if (Number.isInteger(page) && page > 0) anchor = { page };
    } else {
      const index = [...flow.querySelectorAll(READER_BLOCK_SELECTOR)].indexOf(block);
      if (index >= 0) anchor = { block: index };
    }
  }
  if (anchor) {
    const uri = highlightBacklink(view.plugin.app.vault.getName(), file.path, anchor);
    if (uri) result.readerLink = uri;
  }
  return result;
}
