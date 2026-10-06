const plugin = app.plugins.plugins["dashell-reader"];
const bookPath = "Books/示例书库/Alice in Wonderland.epub";
const file = app.vault.getAbstractFileByPath(bookPath);
if (!plugin || !file) throw new Error("English reader or Alice fixture is unavailable");
const view = await plugin.openFile(file);
const attached = view.lookupController.attachments.find(item => item.doc?.querySelectorAll("p").length > 1);
if (!attached) throw new Error("No readable EPUB section is attached");
const doc = attached.doc;
const paragraph = [...doc.querySelectorAll("p")].find(item => item.textContent?.startsWith("Alice was beginning"));
if (!paragraph?.firstChild) throw new Error("Alice sentence is unavailable");
const range = doc.createRange();
range.setStart(paragraph.firstChild, 0);
range.setEnd(paragraph.firstChild, 5);
const rect = range.getBoundingClientRect();
const result = new Promise((resolve, reject) => {
  const timer = window.setTimeout(() => {
    window.removeEventListener("qiaomu-english-event-search", receive);
    reject(new Error("Click lookup did not dispatch a search"));
  }, 5000);
  const receive = event => {
    window.clearTimeout(timer);
    window.removeEventListener("qiaomu-english-event-search", receive);
    resolve(event.detail);
  };
  window.addEventListener("qiaomu-english-event-search", receive);
});
paragraph.dispatchEvent(new doc.defaultView.MouseEvent("click", {
  bubbles: true, cancelable: true, clientX: rect.left + 2, clientY: rect.top + rect.height / 2,
}));
const detail = await result;
const link = new URL(detail.readerLink);
if (detail.selection.toLowerCase() !== "alice" || detail.bookTitle !== "Alice in Wonderland"
    || !detail.sentence?.startsWith("Alice was beginning")
    || link.searchParams.get("book") !== bookPath || !link.searchParams.get("cfi")) {
  throw new Error("Reader lookup lost its word, sentence, title, or CFI");
}
let button = null;
for (let attempt = 0; attempt < 30; attempt++) {
  button = app.workspace.getLeavesOfType("qiaomu-english-learn-panel")
    .map(leaf => leaf.view.containerEl.querySelector(".reader-backlink"))
    .find(Boolean);
  if (button) break;
  await new Promise(resolve => window.setTimeout(resolve, 50));
}
if (!button || button.textContent?.trim() !== "回到书中") throw new Error("Learning panel has no return link");
const originalOpenBookAt = plugin.openBookAt;
let opened = null;
plugin.openBookAt = async (...args) => { opened = args; };
try { button.click(); await Promise.resolve(); }
finally { plugin.openBookAt = originalOpenBookAt; }
if (opened?.[0] !== bookPath || opened?.[4] !== link.searchParams.get("cfi")) {
  throw new Error("Learning panel did not open its captured EPUB location");
}
return { vault: app.vault.getName(), version: plugin.manifest.version, book: detail.bookTitle,
  word: detail.selection, sentence: detail.sentence, cfi: link.searchParams.get("cfi"),
  returnButton: button.textContent.trim() };
