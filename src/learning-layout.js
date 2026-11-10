const READER = 'qiaomu-reader-english';
const STUDY_VIEWS = [READER, 'qiaomu-reader-vocabulary', 'qiaomu-reader-english-library'];
const LEARNING = new Set(['qiaomu-english-search-panel', 'qiaomu-english-learn-panel']);
const LIMIT = '--qbr-learning-dock-limit';

// Keep the host's saved sidebar widths. The temporary cap applies only while
// this plugin owns the visible sidebar and a study view is visible in that window.
export function watchLearningLayout(plugin) {
  const workspace = plugin.app.workspace;
  const managed = new Set();
  let frame = 0, stopped = false;
  const win = plugin.app.workspace.containerEl?.ownerDocument?.defaultView || window;
  const clear = (el) => {
    el.classList.remove('qbr-learning-dock');
    el.style.removeProperty(LIMIT);
    managed.delete(el);
  };
  const refresh = () => {
    frame = 0;
    if (stopped) return;
    const active = new Set();
    const readers = STUDY_VIEWS.flatMap(type => workspace.getLeavesOfType(type)).filter(l => l.view.containerEl?.isShown());
    for (const reader of readers) {
      const doc = reader.view.containerEl.ownerDocument;
      if (doc.body.classList.contains('is-mobile')) continue;
      const root = reader.view.containerEl.closest('.workspace');
      if (!root) continue;
      const docks = [...root.querySelectorAll('.workspace-split.mod-sidedock')].filter(dock => {
        const leaves = [...dock.querySelectorAll('.workspace-leaf-content')].filter(el => el.isShown());
        return leaves.length > 0 && leaves.every(el => LEARNING.has(el.dataset.type));
      });
      const total = root.getBoundingClientRect().width;
      // 480px for the book, plus the host ribbon and resize handles.
      const limit = Math.max(220, Math.min(340, Math.floor((total - 544) / Math.max(1, docks.length))));
      for (const dock of docks) {
        if (total >= 1600) continue;
        active.add(dock);
        managed.add(dock);
        dock.classList.add('qbr-learning-dock');
        if (dock.style.getPropertyValue(LIMIT) !== `${limit}px`) dock.style.setProperty(LIMIT, `${limit}px`);
      }
    }
    for (const dock of managed) if (!active.has(dock)) clear(dock);
  };
  const schedule = () => { if (!stopped && !frame) frame = win.requestAnimationFrame(refresh); };
  plugin.registerEvent(workspace.on('layout-change', schedule));
  plugin.registerEvent(workspace.on('active-leaf-change', schedule));
  plugin.registerEvent(workspace.on('resize', schedule));
  workspace.onLayoutReady(schedule);
  win.addEventListener('resize', schedule);
  plugin.register(() => {
    stopped = true;
    if (frame) win.cancelAnimationFrame(frame);
    win.removeEventListener('resize', schedule);
    for (const dock of managed) clear(dock);
  });
}

export function bookNoteOpenMode(workspace, requested) {
  if (requested !== 'split') return requested;
  const reader = workspace.getLeavesOfType(READER).find(leaf => leaf.view.containerEl?.isShown());
  const width = reader?.view.containerEl.getBoundingClientRect().width;
  return width && width < 860 ? 'tab' : requested;
}
