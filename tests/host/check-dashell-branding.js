const vaultPath = app.vault.adapter.getBasePath().replaceAll("\\", "/").toLowerCase();
if (vaultPath !== "f:/qiaomu-reader-english") throw new Error("Use the designated test vault");
const saved = window.__codexDashellRename;
if (!saved) throw new Error("Capture the pre-install state before running this check");
const reader = app.plugins.plugins["dashell-reader"];
const player = app.plugins.plugins.langplayer;
const checks = [];
const assert = (condition, name) => {
  if (!condition) throw new Error(name);
  checks.push(name);
};
const waitFor = async (read, name) => {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const result = read();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timeout: ${name}`);
};
const root = "__Codex-Dashell-Rename-20261001";
if (app.vault.getAbstractFileByPath(root)) throw new Error("Test fixture already exists");
const originalLookup = reader.openEnglishDictionary;
const originalCopy = player.settings.autoCopyWordOnLookup;
const originalPlayerTab = app.setting.pluginTabs.find(tab => tab.id === "langplayer");
const originalReaderTab = app.setting.pluginTabs.find(tab => tab.id === "dashell-reader");
const playerTabId = originalPlayerTab._activeTab;
const readerTabId = originalReaderTab._tab;

try {
  assert(reader.manifest.name === "Dashell Reader", "Reader manifest uses the new name");
  assert(player.manifest.name === "Dashell Player", "Player manifest uses the new name");
  assert(reader.learning.manifest.name === "Dashell Reader Learning", "Embedded learning module uses the new name");
  assert(originalReaderTab.name === "Dashell Reader" && originalPlayerTab.name === "Dashell Player", "Both settings navigation entries use the new names");
  for (const [id, command] of Object.entries(app.commands.commands)) {
    if (id.startsWith("dashell-reader:")) assert(command.name.startsWith("Dashell Reader:"), "Reader command uses the new prefix");
    if (id.startsWith("langplayer:")) assert(command.name.startsWith("Dashell Player:"), "Player command uses the new prefix");
  }

  const collectMenu = file => {
    const titles = [];
    const menu = new Proxy({
      addItem(build) {
        const item = new Proxy({}, { get: (_target, key) => (...args) => {
          if (key === "setTitle") titles.push(args[0]);
          return item;
        } });
        build(item);
        return menu;
      },
      addSeparator() { return menu; },
    }, { get: (target, key) => key in target ? target[key] : () => menu });
    app.workspace.trigger("file-menu", menu, file, "file-explorer");
    return titles;
  };
  const epub = app.vault.getFiles().find(file => file.extension === "epub");
  assert(collectMenu(epub).some(title => title.includes("Dashell Reader")), "Reader file menu uses the new name");

  app.setting.open();
  await app.setting.openTabById("dashell-reader");
  const readerScope = app.setting.activeTab.containerEl;
  const readerHeading = await waitFor(() => readerScope.querySelector(".qiaomu-reader-settings-head h2"), "Reader settings heading");
  assert(readerHeading.textContent === "Dashell Reader", "Rendered Reader settings heading uses the new name");
  const about = [...readerScope.querySelectorAll(".qiaomu-reader-set-tab")].find(button => /关于|About/.test(button.textContent));
  about.click();
  const aboutText = readerScope.querySelector(".qiaomu-reader-set-body").textContent;
  assert(aboutText.includes("Dashell Reader") && aboutText.includes("Qiaomu Reader") && aboutText.includes("dashell7"), "About shows the new name and preserves upstream attribution");

  await app.setting.openTabById("langplayer");
  const playerScope = app.setting.activeTab.containerEl;
  await waitFor(() => playerScope.querySelector(".lp-settings-tabs"), "Player settings");
  [...playerScope.querySelectorAll(".lp-settings-tab-btn")].find(button => /词汇|Vocabulary/.test(button.textContent)).click();
  const vocabText = playerScope.querySelector(".lp-settings-pane:not(.is-hidden)").textContent;
  assert(vocabText.includes("Dashell Player") && vocabText.includes("Dashell Reader"), "Player lookup settings show both new names");
  const labels = [...playerScope.querySelectorAll(".setting-item-name,.setting-item-description")].map(element => element.textContent);
  assert(labels.every(label => !/Qiaomu Reader English|LangPlayer/.test(label)), "Player settings labels contain no stale product names; stored paths remain intact");
  app.setting.close();

  await app.vault.createFolder(root);
  const wav = new ArrayBuffer(44 + 16000);
  const bytes = new Uint8Array(wav);
  const view = new DataView(wav);
  const ascii = (offset, value) => [...value].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0); });
  ascii(0, "RIFF"); view.setUint32(4, wav.byteLength - 8, true); ascii(8, "WAVE");
  ascii(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, "data"); view.setUint32(40, 16000, true);
  const media = await app.vault.createBinary(`${root}/sample.wav`, wav);
  await app.vault.create(`${root}/sample.srt`, "1\n00:00:00,000 --> 00:00:01,000\nDashell supports language learning.\n");
  assert(collectMenu(media).some(title => title.includes("Dashell Player")), "Player file menu uses the new name");
  player.settings.autoCopyWordOnLookup = false;
  let lookedUp = null;
  reader.openEnglishDictionary = (word, context) => { lookedUp = { word, context }; };
  await player.openMediaFile(media);
  const word = await waitFor(() => [...document.querySelectorAll(".lp-word")].find(element => element.textContent === "supports"), "Clickable subtitle word");
  word.click();
  await waitFor(() => lookedUp, "Player-to-Reader lookup");
  assert(lookedUp.word === "supports" && lookedUp.context.sentence === "Dashell supports language learning.", "Real subtitle click still calls Reader with the word and sentence");
} finally {
  reader.openEnglishDictionary = originalLookup;
  player.settings.autoCopyWordOnLookup = originalCopy;
  originalPlayerTab._activeTab = playerTabId;
  originalReaderTab._tab = readerTabId;
  app.setting.close();
  await app.workspace.changeLayout(saved.layout);
  const fixture = app.vault.getAbstractFileByPath(root);
  if (fixture) await app.vault.delete(fixture, true);
}

assert(JSON.stringify(reader.settings) === saved.readerSettings, "Reader settings are unchanged");
assert(JSON.stringify(reader.learning.settings) === saved.learningSettings, "Learning settings are unchanged");
assert(JSON.stringify(reader.progress) === saved.readerProgress, "Reading progress is unchanged");
assert(JSON.stringify(reader.highlights) === saved.readerHighlights, "Highlights are unchanged");
assert(JSON.stringify(player.settings) === saved.playerSettings, "Player settings are unchanged");
const notes = Object.fromEntries(await Promise.all(app.vault.getMarkdownFiles().map(async file => [
  file.path, require("crypto").createHash("sha256").update(await app.vault.read(file)).digest("hex"),
])));
assert(JSON.stringify(Object.entries(notes).sort()) === JSON.stringify(Object.entries(saved.notes).sort()), "Existing notes are byte-for-byte unchanged");
assert(!app.vault.getFiles().some(file => file.path.startsWith(root)), "No test files remain");
const expectedLayout = structuredClone(saved.layout);
const hiddenItems = expectedLayout["left-ribbon"].hiddenItems;
for (const [oldName, newName] of [
  ["qiaomu-reader-english:Qiaomu Reader English", "dashell-reader:Dashell Reader"],
  ["langplayer:LangPlayer", "langplayer:Dashell Player"],
]) {
  for (const [key, hidden] of Object.entries(hiddenItems)) {
    if (key.startsWith(oldName)) hiddenItems[key.replace(oldName, newName)] = hidden;
  }
}
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
};
assert(JSON.stringify(canonical(app.workspace.getLayout())) === JSON.stringify(canonical(expectedLayout)), "Workspace layout is restored with the renamed ribbon entries");
return { passed: true, checks, names: [reader.manifest.name, player.manifest.name], vault: vaultPath };
