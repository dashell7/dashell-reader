import { requestUrl, setIcon } from "obsidian";

const DEFAULT_DELAY = 200;
const DEFAULT_CLOSE_DELAY = 320;
const DEFAULT_TIMEOUT = 5000;
const CACHE_LIMIT = 120;

/** Keep lookup input deliberately small and English-only. */
export function normalizeEnglishLookup(value) {
  const text = String(value || "").replace(/[\u2018\u2019]/g, "'").trim();
  if (!text || text.length > 80 || !/[A-Za-z]/.test(text)) return "";
  const cleaned = text.replace(/^[^A-Za-z]+|[^A-Za-z' -]+$/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 80 || !/^[A-Za-z][A-Za-z' -]*$/.test(cleaned)) return "";
  return cleaned;
}

function wordSpanAtOffset(text, offset) {
  const source = String(text || "");
  const at = Math.max(0, Math.min(source.length, Number(offset) || 0));
  const isWord = (char) => /[A-Za-z'-]/.test(char || "");
  let start = at;
  let end = at;
  if (start === source.length || !isWord(source[start])) {
    if (start > 0 && isWord(source[start - 1])) start -= 1;
    else return null;
  }
  while (start > 0 && isWord(source[start - 1])) start -= 1;
  while (end < source.length && isWord(source[end])) end += 1;
  const word = normalizeEnglishLookup(source.slice(start, end));
  return word ? { word, start, end } : null;
}

export function wordFromTextAtOffset(text, offset) {
  return wordSpanAtOffset(text, offset)?.word || "";
}

/** Resolve the word under a pointer without changing the reader DOM. */
export function wordAtPoint(doc, x, y, fallbackTarget = null) {
  let node = null;
  let offset = 0;
  try {
    const range = doc.caretRangeFromPoint?.(x, y);
    node = range?.startContainer || null;
    offset = range?.startOffset || 0;
  } catch { /* WebKit may reject points outside the viewport. */ }
  if (!node) {
    try {
      const position = doc.caretPositionFromPoint?.(x, y);
      node = position?.offsetNode || null;
      offset = position?.offset || 0;
    } catch { /* optional browser API */ }
  }
  if (node?.nodeType === 3) {
    const span = wordSpanAtOffset(node.nodeValue, offset);
    if (!span) return "";
    const range = doc.createRange?.();
    if (range?.getClientRects) {
      range.setStart(node, span.start);
      range.setEnd(node, span.end);
      const boxes = [...range.getClientRects()];
      if (boxes.length && !boxes.some((box) => x >= box.left - 2 && x <= box.right + 2 && y >= box.top - 2 && y <= box.bottom + 2)) return "";
    }
    return span.word;
  }
  if (fallbackTarget?.firstChild?.nodeType === 3 && fallbackTarget.childNodes.length === 1) {
    const text = fallbackTarget.firstChild.nodeValue || "";
    if (text.split(/\s+/).length === 1) return normalizeEnglishLookup(text);
  }
  return "";
}

export function parseYoudaoResult(data) {
  const entry = Array.isArray(data?.ec?.word) ? data.ec.word[0] : data?.ec?.word;
  const rows = entry?.trs;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => String(row?.tran || "").trim()).filter(Boolean).slice(0, 4);
}

function parseYoudaoDetails(data) {
  const entry = Array.isArray(data?.ec?.word) ? data.ec.word[0] : data?.ec?.word;
  const examples = (Array.isArray(data?.blng_sents_part?.["sentence-pair"]) ? data.blng_sents_part["sentence-pair"] : [])
    .slice(0, 2)
    .map((item) => ({
      text: String(item?.sentence || "").trim().slice(0, 240),
      translation: String(item?.["sentence-translation"] || "").trim().slice(0, 240),
    }))
    .filter((item) => item.text);
  return { phonetic: String(entry?.usphone || entry?.ukphone || "").trim(), examples };
}

export function parseGoogleResult(data) {
  const out = [];
  for (const group of Array.isArray(data?.[1]) ? data[1] : []) {
    for (const item of Array.isArray(group?.[1]) ? group[1] : []) {
      const value = String(item || "").trim();
      if (value && !out.includes(value)) out.push(value);
    }
  }
  if (!out.length && Array.isArray(data?.[0])) {
    for (const item of data[0]) {
      const value = String(item?.[0] || "").trim();
      if (value && !out.includes(value)) out.push(value);
    }
  }
  return out.slice(0, 4);
}

export function parseFreeDictionaryResult(data) {
  const meanings = [];
  const examples = [];
  let phonetic = "";
  let audio = "";
  for (const entry of Array.isArray(data) ? data : []) {
    if (!phonetic) phonetic = String(entry?.phonetic || "").trim();
    for (const item of Array.isArray(entry?.phonetics) ? entry.phonetics : []) {
      if (!phonetic && item?.text) phonetic = String(item.text).trim();
      if (!audio && item?.audio) audio = String(item.audio).trim();
    }
    for (const meaning of Array.isArray(entry?.meanings) ? entry.meanings : []) {
      const part = String(meaning?.partOfSpeech || "").trim();
      for (const definition of Array.isArray(meaning?.definitions) ? meaning.definitions : []) {
        const value = String(definition?.definition || "").trim();
        if (value) meanings.push(part ? `${part} · ${value}` : value);
        if (definition?.example && examples.length < 2) examples.push({ text: String(definition.example).trim().slice(0, 240), translation: "" });
        if (meanings.length >= 4) break;
      }
      if (meanings.length >= 4) break;
    }
    if (meanings.length >= 4) break;
  }
  return { meanings, phonetic, audio, examples };
}

function withTimeout(promise, ms, signal, document) {
  let timer;
  let onAbort;
  const host = document?.defaultView || window;
  const timeout = new Promise((_, reject) => {
    timer = host.setTimeout(() => reject(new Error("lookup-timeout")), ms);
  });
  const abort = signal ? new Promise((_, reject) => {
    onAbort = () => reject(Object.assign(new Error("lookup-aborted"), { name: "AbortError" }));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }) : null;
  return Promise.race([promise, timeout, abort].filter(Boolean)).finally(() => {
    if (timer) host.clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  });
}

async function fetchYoudao(word, options) {
  const response = await withTimeout(options.request({
    url: `https://dict.youdao.com/jsonapi_s?doctype=json&jsonversion=4&le=en&q=${encodeURIComponent(word)}`,
    method: "GET",
  }), options.timeout, options.signal, options.document);
  return { meanings: parseYoudaoResult(response?.json), audio: "", ...parseYoudaoDetails(response?.json) };
}

async function fetchGoogle(word, language, options) {
  const target = language === "en" ? "en" : (language || "zh-CN");
  const response = await withTimeout(options.request({
    url: `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(target)}&dt=t&dt=bd&q=${encodeURIComponent(word)}`,
    method: "GET",
  }), options.timeout, options.signal, options.document);
  return { meanings: parseGoogleResult(response?.json), phonetic: "", audio: "" };
}

async function fetchFreeDictionary(word, options) {
  const response = await withTimeout(options.request({
    url: `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
    method: "GET",
  }), options.timeout, options.signal, options.document);
  return parseFreeDictionaryResult(response?.json);
}

/** Query the same offline-friendly public services used by Language Learner. */
export async function lookupEnglishWord(word, settings = {}, options = {}) {
  const clean = normalizeEnglishLookup(word);
  if (!clean) return { word: "", meanings: [], phonetic: "", audio: "", examples: [], status: "empty" };
  const request = options.request || requestUrl;
  const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : DEFAULT_TIMEOUT;
  const provider = String(settings.englishLookupProvider || "auto").toLowerCase();
  const language = String(settings.englishLookupLanguage || "zh");
  const common = { request, timeout, signal: options.signal };
  let failure = "";
  const tryOne = async (fn) => {
    try { return await fn(); } catch (error) {
      if (error?.name === "AbortError") throw error;
      failure = error?.message === "lookup-timeout" ? "timeout" : "error";
      return { meanings: [], phonetic: "", audio: "" };
    }
  };
  let result;
  if (language === "en") {
    result = await tryOne(() => fetchFreeDictionary(clean, common));
    if (!result.meanings.length) result = await tryOne(() => fetchGoogle(clean, "en", common));
  } else if (provider === "youdao") {
    result = await tryOne(() => fetchYoudao(clean, common));
  } else if (provider === "google") {
    result = await tryOne(() => fetchGoogle(clean, language, common));
  } else {
    result = await tryOne(() => fetchYoudao(clean, common));
    if (!result.meanings.length) result = await tryOne(() => fetchGoogle(clean, language, common));
  }
  return { word: clean, meanings: result?.meanings || [], phonetic: result?.phonetic || "", audio: result?.audio || "", examples: result?.examples || [], status: result?.meanings?.length ? "ready" : (failure || "empty") };
}

class LruCache {
  constructor(limit = CACHE_LIMIT) { this.limit = limit; this.map = new Map(); }
  get(key) {
    if (!this.map.has(key)) return null;
    const value = this.map.get(key); this.map.delete(key); this.map.set(key, value); return value;
  }
  set(key, value) {
    this.map.delete(key); this.map.set(key, value);
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value);
  }
  clear() { this.map.clear(); }
}

function pointFromEvent(event, frame) {
  const rect = frame?.getBoundingClientRect?.();
  return {
    x: event.clientX + (rect?.left || 0),
    y: event.clientY + (rect?.top || 0),
  };
}

function sentenceFromTarget(target) {
  return target?.closest?.("p,li,blockquote,.qiaomu-reader-pdf-text-layer span")
    ?.textContent?.replace(/\s+/g, " ").trim().slice(0, 500) || "";
}

/** Language Learner-style hover popup, scoped to one reader/document. */
export class EnglishLookupController {
  constructor(options = {}) {
    this.settings = options.settings || (() => ({}));
    this.hostDocument = options.hostDocument || document;
    this.onAddReview = options.onAddReview || (() => Promise.resolve(false));
    this.onOpenDictionary = options.onOpenDictionary || (() => {});
    this.request = options.request || requestUrl;
    this.cache = new LruCache();
    this.attachments = [];
    this.popup = null;
    this.timer = null;
    this.closeTimer = null;
    this.sequence = 0;
    this.active = null;
  }

  attach(doc, options = {}) {
    if (options.replace !== false) this.detachAttachments();
    if (!doc?.addEventListener) return;
    for (const entry of this.attachments.filter((item) => item.frame && (!item.frame.isConnected || item.frame.contentDocument !== item.doc))) {
      entry.stop();
      this.attachments.splice(this.attachments.indexOf(entry), 1);
    }
    if (this.attachments.some((entry) => entry.doc === doc)) return;
    const scope = options.scope || doc.body || doc.documentElement;
    const frame = options.frame || null;
    const inside = (target) => target && (target === scope || scope.contains?.(target));
    const eligible = (target) => inside(target) && !target.closest?.("a,button,input,textarea,select,code,pre,[contenteditable],.qiaomu-reader-hl-popup");
    const onMove = (event) => {
      if (!this.settings().englishLookupEnabled || !eligible(event.target)) {
        this.clearHoverTimer();
        if (this.active?.doc === doc) this.scheduleClose();
        return;
      }
      const selection = doc.getSelection?.();
      if (selection && !selection.isCollapsed) { this.hide(); return; }
      const point = pointFromEvent(event, frame);
      const word = wordAtPoint(doc, event.clientX, event.clientY, event.target);
      if (!word) {
        this.clearHoverTimer();
        if (this.active?.doc === doc) this.scheduleClose();
        return;
      }
      if (this.active?.doc === doc && this.active?.word === word) return;
      this.clearHoverTimer();
      if (this.closeTimer) this.hostDocument.defaultView.clearTimeout(this.closeTimer);
      this.closeTimer = null;
      const sentence = sentenceFromTarget(event.target);
      this.active = { doc, scope, frame, target: event.target, word, point, sentence };
      this.timer = doc.defaultView.setTimeout(() => {
        this.timer = null;
        const current = this.active;
        if (!current || current.word !== word || current.doc !== doc) return;
        void this.show(word, point, current);
      }, Number(this.settings().englishHoverDelay) || DEFAULT_DELAY);
    };
    const onOut = (event) => {
      if (!inside(event.target)) return;
      const next = event.relatedTarget;
      if (next && (inside(next) || this.popup?.contains(next))) return;
      this.clearHoverTimer();
      this.scheduleClose();
    };
    const onClick = (event) => {
      if (!eligible(event.target) || this.popup?.contains(event.target)) return;
      const coarse = this.settings().englishClickLookup || this.hostDocument.defaultView?.matchMedia?.("(pointer: coarse)")?.matches;
      if (!coarse) return;
      const selection = doc.getSelection?.();
      if (selection && !selection.isCollapsed) return;
      const word = wordAtPoint(doc, event.clientX, event.clientY, event.target);
      if (!word) return;
      event.preventDefault();
      event.stopPropagation();
      this.clearHoverTimer();
      const sentence = sentenceFromTarget(event.target);
      this.hide();
      this.onOpenDictionary(word, { sentence });
    };
    const onScroll = () => this.hide();
    doc.addEventListener("mousemove", onMove);
    doc.addEventListener("mouseout", onOut);
    doc.addEventListener("click", onClick, true);
    doc.addEventListener("scroll", onScroll, true);
    const stop = () => {
      doc.removeEventListener("mousemove", onMove);
      doc.removeEventListener("mouseout", onOut);
      doc.removeEventListener("click", onClick, true);
      doc.removeEventListener("scroll", onScroll, true);
    };
    this.attachments.push({ doc, frame, stop });
  }

  detachAttachments() {
    this.clearHoverTimer();
    for (const entry of this.attachments.splice(0)) entry.stop();
  }

  clearHoverTimer() { if (this.timer) this.hostDocument.defaultView.clearTimeout(this.timer); this.timer = null; }
  scheduleClose() {
    if (this.closeTimer) return;
    this.closeTimer = this.hostDocument.defaultView.setTimeout(() => {
      this.closeTimer = null;
      if (!this.popup?.matches(":hover")) this.hide();
    }, DEFAULT_CLOSE_DELAY);
  }

  ensurePopup() {
    if (this.popup?.isConnected) return this.popup;
    const popup = this.hostDocument.createElement("div");
    popup.className = "qiaomu-reader-dict-popup";
    popup.setAttribute("role", "dialog");
    popup.addEventListener("mouseenter", () => { if (this.closeTimer) this.hostDocument.defaultView.clearTimeout(this.closeTimer); this.closeTimer = null; });
    popup.addEventListener("mouseleave", () => this.scheduleClose());
    popup.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); this.hide(); }
    });
    this.hostDocument.body.appendChild(popup);
    this.popup = popup;
    return popup;
  }

  labels() {
    return String(this.settings().language || "zh").startsWith("zh")
      ? { loading: "正在查词…", empty: "没有找到释义", error: "查询失败，请重试", timeout: "查询超时，请重试", speak: "发音", review: "加入复习", added: "已加入复习", addFailed: "加入失败", details: "完整释义" }
      : { loading: "Looking up…", empty: "No definition found", error: "Lookup failed. Try again.", timeout: "Lookup timed out. Try again.", speak: "Pronounce", review: "Add to review", added: "Added", addFailed: "Could not add", details: "Full definition" };
  }

  action(parent, icon, label, handler) {
    const button = this.hostDocument.createElement("button");
    button.type = "button";
    const mark = this.hostDocument.createElement("span"); mark.className = "qiaomu-reader-dict-action-icon"; setIcon(mark, icon);
    const name = this.hostDocument.createElement("span"); name.className = "qiaomu-reader-dict-action-name"; name.textContent = label;
    button.append(mark, name);
    button.addEventListener("click", handler);
    parent.appendChild(button);
    return button;
  }

  async show(word, point, context = {}) {
    const popup = this.ensurePopup();
    const requestId = ++this.sequence;
    this._abort?.abort();
    this._abort = new AbortController();
    while (popup.firstChild) popup.removeChild(popup.firstChild);
    const labels = this.labels();
    const body = this.hostDocument.createElement("div"); body.className = "qiaomu-reader-dict-body"; popup.appendChild(body);
    const state = this.hostDocument.createElement("div"); state.className = "qiaomu-reader-dict-state"; state.textContent = labels.loading; body.appendChild(state);
    const actions = this.hostDocument.createElement("div"); actions.className = "qiaomu-reader-dict-actions"; body.appendChild(actions);
    const speak = this.action(actions, "volume-2", labels.speak, () => this.speak(result?.audio, word));
    speak.classList.add("qiaomu-reader-dict-speak");
    const review = this.action(actions, "bookmark", labels.review, async () => {
      review.disabled = true;
      try {
        const added = await this.onAddReview({ word, meanings: result?.meanings || [], sentence: context.sentence || "" });
        review.lastChild.textContent = added === false ? labels.addFailed : labels.added;
        if (added === false) review.disabled = false;
      } catch {
        review.lastChild.textContent = labels.addFailed;
        review.disabled = false;
      }
    });
    review.classList.add("qiaomu-reader-dict-review");
    const details = this.action(actions, "book-open", labels.details, () => {
      this.hide();
      this.onOpenDictionary(word, { sentence: context.sentence || "", initialResult: result });
    });
    details.classList.add("qiaomu-reader-dict-details");
    this.position(point);
    const key = `${String(this.settings().englishLookupLanguage || "zh")}|${String(this.settings().englishLookupProvider || "auto")}|${word.toLowerCase()}`;
    let result = this.cache.get(key);
    try {
      if (!result) {
        result = await lookupEnglishWord(word, this.settings(), { request: this.request, signal: this._abort.signal, document: this.hostDocument });
        if (result.meanings.length) this.cache.set(key, result);
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      result = { word, meanings: [], phonetic: "", audio: "", status: "error" };
    }
    if (requestId !== this.sequence || !this.popup?.isConnected) return;
    state.remove();
    if (!result.meanings.length) {
      const empty = this.hostDocument.createElement("div"); empty.className = "qiaomu-reader-dict-state";
      empty.textContent = labels[result.status] || labels.empty;
      body.insertBefore(empty, actions);
    } else {
      result.meanings.slice(0, 3).forEach((meaning) => {
        const row = this.hostDocument.createElement("div"); row.className = "qiaomu-reader-dict-meaning"; row.textContent = meaning; body.insertBefore(row, actions);
      });
    }
    this.position(point);
  }

  position(point) {
    if (!this.popup) return;
    Object.assign(this.popup.style, { left: "-10000px", top: "-10000px" });
    const rect = this.popup.getBoundingClientRect();
    const view = this.hostDocument.defaultView || window;
    const gap = 10;
    let left = Number(point?.x) || 0;
    let top = (Number(point?.y) || 0) - rect.height - gap;
    if (top < 8) top = (Number(point?.y) || 0) + gap;
    left = Math.max(8, Math.min(left - rect.width / 2, view.innerWidth - rect.width - 8));
    top = Math.max(8, Math.min(top, view.innerHeight - rect.height - 8));
    Object.assign(this.popup.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
    this.popup.classList.add("qiaomu-reader-dict-popup-on");
  }

  speak(audio, word) {
    const url = audio || `https://dict.youdao.com/dictvoice?type=2&audio=${encodeURIComponent(word)}`;
    try { const player = new (this.hostDocument.defaultView?.Audio || Audio)(url); void player.play?.(); }
    catch { /* audio is optional */ }
  }

  lookupText(text, rect, context = {}) {
    const word = normalizeEnglishLookup(text);
    if (!word) return false;
    this.active = { word, point: { x: rect?.left || 0, y: rect?.top || 0 }, ...context };
    void this.show(word, this.active.point, this.active);
    return true;
  }

  hide() {
    this.clearHoverTimer();
    if (this.closeTimer) this.hostDocument.defaultView.clearTimeout(this.closeTimer);
    this.closeTimer = null;
    this._abort?.abort(); this.sequence++;
    if (this.popup) this.popup.classList.remove("qiaomu-reader-dict-popup-on");
    this.active = null;
  }

  destroy() {
    this.detachAttachments();
    if (this.closeTimer) this.hostDocument.defaultView.clearTimeout(this.closeTimer);
    this._abort?.abort(); this.popup?.remove(); this.popup = null; this.cache.clear();
  }
}
