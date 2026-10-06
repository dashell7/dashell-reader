(async () => {
  const vault = app.vault.adapter.getBasePath().replaceAll("\\", "/").toLowerCase();
  if (vault !== "f:/qiaomu-reader-english") throw new Error("Use the designated Reader test vault");
  const input = window.__dashellPdfQaInput;
  if (!input?.reportRoot) throw new Error("Set the external report directory and test stage first");
  const fs = require("fs");
  const path = require("path");
  const hash = value => require("crypto").createHash("sha256").update(value).digest("hex");
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  };
  const digest = value => hash(JSON.stringify(canonical(value)));
  const plugin = app.plugins.getPlugin("dashell-reader");
  if (!plugin?.learning) throw new Error("Reader learning module is unavailable");
  const notes = async () => Object.fromEntries(await Promise.all(app.vault.getMarkdownFiles().map(async file => [file.path, hash(await app.vault.read(file))])));
  const snapshot = async () => {
    const settings = { ...plugin.settings };
    const stored = await plugin.loadData();
    // The working checkout already has an unpersisted toolbar default, absent
    // from the older installed build. Compare existing user values across reload.
    if (!Object.hasOwn(stored.settings, "ttsBarVisibility") && settings.ttsBarVisibility === "playing") delete settings.ttsBarVisibility;
    return {
      settings: digest(settings), learningSettings: digest(plugin.learning.settings),
      progress: digest(plugin.progress), highlights: digest(plugin.highlights),
      notes: digest(await notes()),
    };
  };
  if (input.stage === "baseline") {
    if (window.__dashellPdfQaBaseline) throw new Error("Baseline already exists");
    window.__dashellPdfQaBaseline = { layout: app.workspace.getLayout(), state: await snapshot() };
    return { baselineCaptured: true, vault, userAgent: navigator.userAgent };
  }
  if (input.stage !== "check") throw new Error("Unknown test stage");
  const baseline = window.__dashellPdfQaBaseline;
  if (!baseline) throw new Error("Capture baseline before installing");
  if (digest(await snapshot()) !== digest(baseline.state)) throw new Error("Reload changed existing settings, progress, highlights or notes");
  const root = "__Codex-PDF-Decoders-20261006";
  if (app.vault.getAbstractFileByPath(root)) throw new Error("Test fixture directory already exists");
  const readerTypes = ["qiaomu-reader-english", "qiaomu-reader-english-library", "qiaomu-reader-english-ai-chat"];
  const existingLeaves = new Set(readerTypes.flatMap(type => app.workspace.getLeavesOfType(type)));
  const originalProgress = plugin.saveProgress;
  const originalCompanion = plugin._showCompanionForBook;
  const warnings = [], errors = [], checks = [];
  const originalWarn = console.warn, originalError = console.error;
  console.warn = (...args) => { warnings.push(args.map(String).join(" ")); originalWarn(...args); };
  console.error = (...args) => { errors.push(args.map(String).join(" ")); originalError(...args); };
  const assert = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };
  const waitFor = async (read, label) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const result = read();
      if (result) return result;
      await new Promise(resolve => window.setTimeout(resolve, 40));
    }
    throw new Error(`Timeout: ${label}`);
  };
  const pixels = async src => {
    const image = new Image(); image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let black = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 32 && data[i + 1] < 32 && data[i + 2] < 32) black++;
    return { width: canvas.width, height: canvas.height, black, total: data.length / 4 };
  };
  const rawBytes = file => Uint8Array.from(fs.readFileSync(path.join(input.reportRoot, file))).buffer;
  let coverLeaf, coverView, readerPrototype, originalPrompt, result;
  try {
    plugin.saveProgress = function (book, ...args) {
      return book.startsWith(`${root}/`) ? Promise.resolve() : originalProgress.call(this, book, ...args);
    };
    plugin._showCompanionForBook = () => Promise.resolve();
    await app.vault.createFolder(root);
    const scan = await app.vault.createBinary(`${root}/CCITT-scan.pdf`, rawBytes("ccitt-scan.pdf"));
    const text = await app.vault.createBinary(`${root}/Text-regression.pdf`, rawBytes("text-regression.pdf"));

    // Exercise the actual registered cover method without scanning the user's library.
    coverLeaf = app.workspace.getLeaf("tab");
    coverView = app.viewRegistry.viewByType["qiaomu-reader-english-library"](coverLeaf);
    const cover = await pixels(await coverView.makePdfThumb(scan));
    assert(cover.black > cover.total * 0.9, "Scanned PDF cover contains black decoded pixels");

    const readerFactory = app.viewRegistry.viewByType["qiaomu-reader-english"];
    const probe = readerFactory(coverLeaf);
    readerPrototype = Object.getPrototypeOf(probe);
    originalPrompt = readerPrototype._maybePromptBookNote;
    readerPrototype._maybePromptBookNote = function (file) {
      if (!file.path.startsWith(`${root}/`)) return originalPrompt.call(this, file);
    };
    probe.unload();
    const reader = await plugin.openFile(scan);
    assert(reader.containerEl.isConnected && !!reader.pager?.flow, "Reader opens the PDF in a live view");
    const image = await waitFor(() => reader.pager.flow.querySelector('img[data-pdf-page="1"][src]'), "Scan page image");
    await image.decode();
    const scanPixels = await pixels(image.src);
    assert(scanPixels.black > scanPixels.total * 0.9, "Scanned PDF page contains black decoded pixels");
    assert(!reader.pdfDocumentContext?.text && !reader.pager.flow.querySelector(".qiaomu-reader-pdf-text-layer"), "Image-only PDF remains correctly unavailable for text lookup");

    await reader.openFile(text);
    await waitFor(() => reader.pager.flow.querySelector(".qiaomu-reader-pdf-text-layer")?.textContent.includes("Text before"), "Selectable text page");
    assert(reader.pdfDocumentContext.text.includes("Text before"), "Text PDF preserves its AI and lookup text layer");
    assert(!!reader.lookupController, "English lookup controller remains attached");
    assert(typeof plugin.openEnglishDictionary === "function" && typeof plugin.addEnglishReviewCard === "function" && !!plugin.selectionSpeech, "Dictionary, vocabulary review and speech APIs remain available");
    assert(!warnings.some(item => /Unable to decode|instantiateWasm|failed to initialize/i.test(item)), "No PDF decoder initialization warnings");
    assert(errors.length === 0, "No console errors during PDF reading");
    result = { passed: true, checks, cover, scan: scanPixels, warnings, errors, vault, userAgent: navigator.userAgent };
  } finally {
    if (readerPrototype && originalPrompt) readerPrototype._maybePromptBookNote = originalPrompt;
    for (const type of readerTypes) {
      for (const leaf of app.workspace.getLeavesOfType(type)) if (!existingLeaves.has(leaf)) leaf.detach();
    }
    coverView?.unload(); coverLeaf?.detach();
    const fixture = app.vault.getAbstractFileByPath(root);
    if (fixture) await app.vault.delete(fixture, true);
    plugin.saveProgress = originalProgress;
    plugin._showCompanionForBook = originalCompanion;
    await app.workspace.changeLayout(baseline.layout);
    console.warn = originalWarn; console.error = originalError;
  }
  assert(digest(await snapshot()) === digest(baseline.state), "Existing settings, learning settings, progress, highlights and notes are unchanged");
  assert(!app.vault.getAbstractFileByPath(root), "Test fixtures have been removed");
  fs.writeFileSync(path.join(input.reportRoot, "host-pdf-report.json"), JSON.stringify(result, null, 2));
  return result;
})()
