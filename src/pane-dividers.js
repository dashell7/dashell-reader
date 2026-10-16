const SERVICE = /* @__PURE__ */ Symbol.for("qiaomu.pane-dividers.v1");
const HANDLE = ".workspace-leaf-resize-handle";
const VIEWS = /* @__PURE__ */ new Set(["qiaomu-reader-english", "qiaomu-reader-english-ai-chat"]);
const STRUCTURE = ".workspace-leaf,.workspace-split,.workspace-tabs,.workspace-leaf-resize-handle";
const PROPS = ["--qiaomu-divider-color", "--qiaomu-divider-hover", "--qiaomu-divider-start", "--qiaomu-divider-end", "--qiaomu-divider-direction"];
function channels(color) {
  if (/^#[\da-f]{6}$/i.test(color)) return [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16));
  const srgb = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(color);
  if (srgb && srgb[4] !== "0") return srgb.slice(1, 4).map((value) => Number(value) * 255);
  const match = /^rgba?\(([^)]+)\)$/.exec(color);
  if (!match) return null;
  const parts = match[1]?.split(/[\s,/]+/).filter(Boolean).map(Number) ?? [];
  if (parts.length < 3 || parts.some((value) => !Number.isFinite(value)) || parts[3] === 0) return null;
  return parts.slice(0, 3);
}
function isElement(node) {
  return node.nodeType === 1 && "style" in node;
}
function palette(root, win) {
  const style = win.getComputedStyle(root);
  let background = style.backgroundColor;
  let foreground = style.color;
  if (root.classList.contains("qh-has-photo")) {
    background = style.getPropertyValue("--qh-photo-color").trim() || "#16161a";
    foreground = style.getPropertyValue("--qh-text").trim() || foreground;
  }
  if (!channels(background)) background = style.getPropertyValue("--background-primary").trim();
  const rgb = channels(background);
  const dark = !!rgb && (rgb[0] ?? 0) * 0.2126 + (rgb[1] ?? 0) * 0.7152 + (rgb[2] ?? 0) * 0.0722 < 128;
  return { background, foreground, dark };
}
function createService(doc) {
  const win = doc.defaultView;
  const workspace = doc.querySelector(".workspace");
  if (!win || !workspace || !doc.body) return;
  const saved = /* @__PURE__ */ new Map();
  let frame = 0;
  let stopped = false;
  const restore = (handle, previous) => {
    PROPS.forEach((key, i) => {
      if (handle.style.getPropertyValue(key) !== previous.applied[i]) return;
      const original = previous.original[i];
      if (original?.[0]) handle.style.setProperty(key, original[0], original[1]);
      else handle.style.removeProperty(key);
    });
    if (!previous.hadClass) handle.classList.remove("qiaomu-pane-divider");
    saved.delete(handle);
  };
  const repaint = () => {
    frame = 0;
    if (stopped) return;
    const panes = [];
    for (const leaf of workspace.querySelectorAll(".workspace-leaf")) {
      const content = leaf.querySelector(".workspace-leaf-content");
      if (!content || !VIEWS.has(content.dataset.type || "")) continue;
      const rect = leaf.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const root = content.querySelector(".view-content");
      if (!root) continue;
      const surface = root.querySelector(".qiaomu-radio__shell") || root;
      panes.push({ rect, content: root.getBoundingClientRect(), palette: palette(surface, win) });
    }
    const active = /* @__PURE__ */ new Set();
    for (const handle of workspace.querySelectorAll(HANDLE)) {
      const rect = handle.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const vertical = rect.height > rect.width;
      const adjacent = panes.filter((pane) => {
        const overlap = vertical ? Math.min(rect.bottom, pane.rect.bottom) - Math.max(rect.top, pane.rect.top) : Math.min(rect.right, pane.rect.right) - Math.max(rect.left, pane.rect.left);
        const distance = vertical ? Math.min(Math.abs(rect.left - pane.rect.right), Math.abs(rect.right - pane.rect.left)) : Math.min(Math.abs(rect.top - pane.rect.bottom), Math.abs(rect.bottom - pane.rect.top));
        return overlap > 0 && distance <= 12;
      });
      const selected = adjacent.find((pane) => pane.palette.dark) || adjacent[0];
      if (!selected || !channels(selected.palette.background) || !channels(selected.palette.foreground)) continue;
      active.add(handle);
      let previous = saved.get(handle);
      if (!previous) {
        previous = { original: PROPS.map((key) => [handle.style.getPropertyValue(key), handle.style.getPropertyPriority(key)]), applied: [], hadClass: handle.classList.contains("qiaomu-pane-divider") };
        saved.set(handle, previous);
      }
      const { background, foreground } = selected.palette;
      const values = [12, 24].map((amount) => `color-mix(in srgb, ${foreground} ${amount}%, ${background})`);
      const start = vertical ? selected.content.top - rect.top : selected.content.left - rect.left;
      const end = vertical ? selected.content.bottom - rect.top : selected.content.right - rect.left;
      const length = vertical ? rect.height : rect.width;
      values.push(`${Math.max(0, Math.min(length, start))}px`, `${Math.max(0, Math.min(length, end))}px`, vertical ? "to bottom" : "to right");
      values.forEach((value, i) => {
        const key = PROPS[i];
        if (key && handle.style.getPropertyValue(key) !== value) handle.style.setProperty(key, value);
      });
      previous.applied = PROPS.map((key) => handle.style.getPropertyValue(key));
      handle.classList.add("qiaomu-pane-divider");
    }
    for (const [handle, previous] of saved) if (!active.has(handle)) restore(handle, previous);
  };
  const refresh = () => {
    if (!stopped && !frame) frame = win.requestAnimationFrame(repaint);
  };
  const observer = new win.MutationObserver((records) => {
    if (records.some((record) => {
      const target = record.target;
      if (!isElement(target) || target.matches(HANDLE)) return false;
      if (record.type === "attributes") return target === doc.body || target.matches(`${STRUCTURE},.view-content,.qiaomu-radio,.qiaomu-radio__shell`);
      return [...record.addedNodes, ...record.removedNodes].some((node) => isElement(node) && (node.matches(STRUCTURE) || !!node.querySelector(STRUCTURE)));
    })) refresh();
  });
  observer.observe(workspace, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "data-qa-theme", "data-qrs-theme", "data-theme"] });
  observer.observe(doc.body, { attributes: true, attributeFilter: ["class", "style"] });
  win.addEventListener("resize", refresh);
  refresh();
  return { users: 0, refresh, stop: () => {
    stopped = true;
    observer.disconnect();
    win.removeEventListener("resize", refresh);
    if (frame) win.cancelAnimationFrame(frame);
    for (const [handle, previous] of saved) restore(handle, previous);
    delete doc[SERVICE];
  } };
}
function watchPaneDividers(plugin) {
  const docs = /* @__PURE__ */ new Map();
  let stopped = false;
  const attach = (doc) => {
    if (stopped) return;
    let service = docs.get(doc);
    if (!service) {
      service = doc[SERVICE] || createService(doc);
      if (!service) return;
      doc[SERVICE] = service;
      service.users++;
      docs.set(doc, service);
    }
    service.refresh();
  };
  const detach = (doc) => {
    const service = docs.get(doc);
    if (!service) return;
    docs.delete(doc);
    if (--service.users === 0) service.stop();
  };
  const refresh = () => {
    attach(document);
    plugin.app.workspace.iterateAllLeaves((leaf) => attach(leaf.view.containerEl.ownerDocument));
  };
  plugin.registerEvent(plugin.app.workspace.on("layout-change", refresh));
  plugin.registerEvent(plugin.app.workspace.on("css-change", refresh));
  plugin.registerEvent(plugin.app.workspace.on("window-open", (_workspace, win) => attach(win.document)));
  plugin.registerEvent(plugin.app.workspace.on("window-close", (_workspace, win) => detach(win.document)));
  plugin.app.workspace.onLayoutReady(refresh);
  plugin.register(() => {
    stopped = true;
    for (const doc of docs.keys()) detach(doc);
  });
}
export {
  watchPaneDividers
};
