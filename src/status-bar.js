/** Track English-owned active views in one host window without touching the original plugin. */
export function watchReaderStatusBar(workspace, document) {
  let stopped = false;
  let queued = false;
  const types = new Set([
    "qiaomu-reader-english",
    "qiaomu-reader-english-library",
    "qiaomu-reader-english-ai-chat",
    "qiaomu-reader-english-dictionary",
    "qiaomu-reader-english-review",
    "qiaomu-english-search-panel",
    "qiaomu-english-learn-panel",
    "qiaomu-english-reading",
  ]);
  const update = () => {
    queued = false;
    if (stopped) return;
    const active = document.querySelector(".workspace-leaf.mod-active > .workspace-leaf-content");
    document.body.classList.toggle("qiaomu-reader-english-active-view", types.has(active?.getAttribute("data-type")));
  };
  const schedule = () => {
    if (stopped || queued) return;
    queued = true;
    queueMicrotask(update);
  };
  const refs = [workspace.on("active-leaf-change", schedule), workspace.on("layout-change", schedule)];
  update();
  return () => {
    stopped = true;
    refs.forEach(ref => workspace.offref(ref));
    document.body.classList.remove("qiaomu-reader-english-active-view");
  };
}
