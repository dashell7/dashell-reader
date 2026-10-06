const LEARNING_HIGHLIGHT = "qiaomu-reader-vocabulary-learning";
const FAMILIAR_HIGHLIGHT = "qiaomu-reader-vocabulary-familiar";
const REBUILD_DELAY = 80;
const NODE_BUDGET = 900;
const WORD_PATTERN = /^[a-z]+(?:['’-][a-z]+)*$/i;
const WORD_TOKEN_PATTERN = /[a-z]+(?:['’-][a-z]+)*/gi;
const SKIP_TEXT_SELECTOR = "script,style,noscript,template,textarea,input,select,option,button,svg,code,pre,[contenteditable],.qiaomu-reader-hl-popup,.qiaomu-reader-dict-popup,.langr-subtitle-popup";

const HIGHLIGHT_STYLES = `
::highlight(${LEARNING_HIGHLIGHT}) {
  background-color: rgba(205, 150, 65, 0.14);
  text-decoration-line: underline;
  text-decoration-style: solid;
  text-decoration-color: #c18b39;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.16em;
}
::highlight(${FAMILIAR_HIGHLIGHT}) {
  background-color: rgba(56, 145, 124, 0.11);
  text-decoration-line: underline;
  text-decoration-style: dashed;
  text-decoration-color: #438b7b;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.16em;
}
`;

export function normalizeVocabularyWord(value) {
  return String(value || "").replace(/[’‘]/g, "'").trim().toLowerCase();
}

export function createVocabularyStatusIndex(records) {
  const index = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || record.t !== "WORD" || !Number.isInteger(record.status)
      || record.status < 0 || record.status > 4) continue;
    const expression = normalizeVocabularyWord(record.expression);
    if (!WORD_PATTERN.test(expression)) continue;
    const status = record.status === 1 || record.status === 2 ? record.status : null;
    for (const word of [expression, ...(Array.isArray(record.aliases) ? record.aliases.map(normalizeVocabularyWord) : [])]) {
      if (!WORD_PATTERN.test(word)) continue;
      if (status === null) index.delete(word);
      else index.set(word, status);
    }
  }
  return index;
}

function highlightName(status) {
  return status === 1 ? LEARNING_HIGHLIGHT : status === 2 ? FAMILIAR_HIGHLIGHT : "";
}

function containsLatinText(node) {
  if (node.nodeType === 3) return /[a-z]/i.test(node.nodeValue || "");
  return node.nodeType === 1 && /[a-z]/i.test(node.textContent || "");
}

function supportedDocument(doc) {
  const win = doc?.defaultView;
  return !!(win?.CSS?.highlights && typeof win.Highlight === "function");
}

function ensureStyles(doc) {
  if (doc.getElementById("qiaomu-reader-english-vocabulary-styles")) return;
  const style = doc.createElement("style");
  style.id = "qiaomu-reader-english-vocabulary-styles";
  style.textContent = HIGHLIGHT_STYLES;
  (doc.head || doc.documentElement).appendChild(style);
}

function setRanges(registry, name, Highlight, ranges) {
  if (!ranges.length) {
    registry.delete(name);
    return;
  }
  const highlight = new Highlight();
  for (const range of ranges) highlight.add(range);
  registry.set(name, highlight);
}

export class EnglishVocabularyDocumentMarker {
  constructor(doc) {
    this.doc = doc;
    this.win = doc.defaultView;
    this.scopes = new Map();
    this.statusIndex = new Map();
    this.generation = 0;
    this.frame = null;
    this.cancelFrame = null;
    this.timer = null;
    this.finishPending = null;
    ensureStyles(doc);
  }

  addScope(scope) {
    if (!scope || this.scopes.has(scope)) return this.rebuild();
    ensureStyles(this.doc);
    const Observer = this.win?.MutationObserver;
    const observer = Observer ? new Observer((mutations) => {
      if (mutations.some((mutation) => mutation.type === "characterData"
        ? /[a-z]/i.test(mutation.oldValue || "") || /[a-z]/i.test(mutation.target.nodeValue || "")
        : [...mutation.addedNodes, ...mutation.removedNodes].some(containsLatinText))) {
        this.scheduleRebuild();
      }
    }) : null;
    observer?.observe(scope, { childList: true, characterData: true, characterDataOldValue: true, subtree: true });
    const onPageHide = () => { void this.removeScope(scope); };
    this.win?.addEventListener("pagehide", onPageHide, { once: true });
    this.scopes.set(scope, { observer, onPageHide });
    return this.rebuild();
  }

  removeScope(scope) {
    const resources = this.scopes.get(scope);
    if (!resources) return Promise.resolve(false);
    resources.observer?.disconnect();
    this.win?.removeEventListener("pagehide", resources.onPageHide);
    this.scopes.delete(scope);
    if (this.scopes.size) return this.rebuild();
    this.dispose();
    return Promise.resolve(true);
  }

  updateIndex(index) {
    this.statusIndex = index instanceof Map ? index : new Map();
    return this.rebuild();
  }

  scheduleRebuild() {
    if (this.timer != null) this.win.clearTimeout(this.timer);
    this.timer = this.win.setTimeout(() => {
      this.timer = null;
      void this.rebuild();
    }, REBUILD_DELAY);
  }

  cancelRebuild() {
    this.generation++;
    this.cancelFrame?.();
    this.frame = null;
    this.cancelFrame = null;
    if (this.finishPending) {
      this.finishPending(false);
      this.finishPending = null;
    }
  }

  rebuild() {
    this.cancelRebuild();
    if (this.timer != null) this.win.clearTimeout(this.timer);
    this.timer = null;
    if (!supportedDocument(this.doc)) return Promise.resolve(false);

    const generation = this.generation;
    const learningRanges = [];
    const familiarRanges = [];
    const scopes = [...this.scopes.keys()].filter((scope) => scope.isConnected);
    let scopeIndex = 0;
    let walker = null;

    return new Promise((resolve) => {
      this.finishPending = resolve;
      const finish = (success) => {
        if (generation !== this.generation) return;
        this.frame = null;
        this.cancelFrame = null;
        this.finishPending = null;
        if (success) {
          const registry = this.win.CSS.highlights;
          setRanges(registry, LEARNING_HIGHLIGHT, this.win.Highlight, learningRanges);
          setRanges(registry, FAMILIAR_HIGHLIGHT, this.win.Highlight, familiarRanges);
        }
        resolve(success);
      };
      const nextScope = () => {
        while (scopeIndex < scopes.length) {
          const scope = scopes[scopeIndex++];
          if (!scope.isConnected) continue;
          walker = this.doc.createTreeWalker(scope, this.win.NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => node.parentElement?.closest(SKIP_TEXT_SELECTOR)
              ? this.win.NodeFilter.FILTER_REJECT : this.win.NodeFilter.FILTER_ACCEPT,
          });
          return true;
        }
        walker = null;
        return false;
      };
      const scan = () => {
        if (generation !== this.generation) return;
        let nodesThisFrame = 0;
        let node = null;
        while (nodesThisFrame < NODE_BUDGET) {
          if (!walker && !nextScope()) {
            finish(true);
            return;
          }
          node = walker.nextNode();
          if (!node) {
            walker = null;
            continue;
          }
          nodesThisFrame++;
          const text = node.nodeValue || "";
          WORD_TOKEN_PATTERN.lastIndex = 0;
          let match;
          while ((match = WORD_TOKEN_PATTERN.exec(text))) {
            const status = this.statusIndex.get(normalizeVocabularyWord(match[0]));
            const name = highlightName(status);
            if (!name) continue;
            try {
              const range = this.doc.createRange();
              range.setStart(node, match.index);
              range.setEnd(node, match.index + match[0].length);
              (status === 1 ? learningRanges : familiarRanges).push(range);
            } catch { /* A concurrently replaced text node is picked up on the next rebuild. */ }
          }
        }
        if (this.win.requestAnimationFrame) {
          this.frame = this.win.requestAnimationFrame(scan);
          this.cancelFrame = () => this.win.cancelAnimationFrame?.(this.frame);
        } else {
          this.frame = this.win.setTimeout(scan, 16);
          this.cancelFrame = () => this.win.clearTimeout(this.frame);
        }
      };
      if (!scopes.length || !this.statusIndex.size) {
        finish(true);
        return;
      }
      scan();
    });
  }

  dispose() {
    this.cancelRebuild();
    if (this.timer != null) this.win.clearTimeout(this.timer);
    this.timer = null;
    for (const { observer, onPageHide } of this.scopes.values()) {
      observer?.disconnect();
      this.win?.removeEventListener("pagehide", onPageHide);
    }
    this.scopes.clear();
    const registry = this.win?.CSS?.highlights;
    registry?.delete(LEARNING_HIGHLIGHT);
    registry?.delete(FAMILIAR_HIGHLIGHT);
    this.doc.getElementById("qiaomu-reader-english-vocabulary-styles")?.remove();
  }
}

export class EnglishVocabularyMarkerService {
  constructor(db, eventTarget = window) {
    this.db = db;
    this.eventTarget = eventTarget;
    this.documents = new Map();
    this.index = null;
    this.loadPromise = null;
    this.loadGeneration = 0;
    this.refreshTimer = null;
    this.disposed = false;
    this.onVocabularyRefresh = () => this.scheduleRefresh();
    this.eventTarget.addEventListener("qiaomu-english-event-refresh", this.onVocabularyRefresh);
  }

  attach(scope) {
    const doc = scope?.ownerDocument;
    if (!doc || this.disposed) return () => {};
    let marker = this.documents.get(doc);
    if (!marker) {
      marker = new EnglishVocabularyDocumentMarker(doc);
      this.documents.set(doc, marker);
    }
    void marker.addScope(scope);
    if (this.index) void marker.updateIndex(this.index);
    else void this.ensureIndex();
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      if (!this.documents.has(doc)) return;
      void marker.removeScope(scope).then(() => {
        if (marker.scopes.size === 0 && this.documents.get(doc) === marker) this.documents.delete(doc);
      });
    };
  }

  scheduleRefresh() {
    if (this.disposed) return;
    const win = this.eventTarget.defaultView || this.eventTarget;
    if (this.refreshTimer != null) win.clearTimeout(this.refreshTimer);
    this.refreshTimer = win.setTimeout(() => {
      this.refreshTimer = null;
      this.index = null;
      this.loadPromise = null;
      void this.ensureIndex(true);
    }, REBUILD_DELAY);
  }

  invalidateIndex() {
    if (this.disposed) return;
    this.loadGeneration++;
    this.index = null;
    this.loadPromise = null;
  }

  ensureIndex(force = false) {
    if (this.disposed) return Promise.resolve(null);
    if (!force && this.index) return Promise.resolve(this.index);
    if (!force && this.loadPromise) return this.loadPromise;
    const generation = ++this.loadGeneration;
    this.loadPromise = (async () => {
      await this.db.waitForReady();
      const records = await this.db.getAllExpressionSimple(true);
      const index = createVocabularyStatusIndex(records);
      if (this.disposed || generation !== this.loadGeneration) return null;
      this.index = index;
      await Promise.all([...this.documents.values()].map((marker) => marker.updateIndex(index)));
      return index;
    })().catch((error) => {
      if (!this.disposed && generation === this.loadGeneration) {
        console.warn("Dashell Reader: could not refresh vocabulary marks", error);
      }
      return null;
    });
    return this.loadPromise;
  }

  refreshNow() {
    this.index = null;
    this.loadPromise = null;
    return this.ensureIndex(true);
  }

  dispose() {
    this.disposed = true;
    this.loadGeneration++;
    this.eventTarget.removeEventListener("qiaomu-english-event-refresh", this.onVocabularyRefresh);
    const win = this.eventTarget.defaultView || this.eventTarget;
    if (this.refreshTimer != null) win.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    for (const marker of this.documents.values()) marker.dispose();
    this.documents.clear();
    this.index = null;
    this.loadPromise = null;
  }
}
