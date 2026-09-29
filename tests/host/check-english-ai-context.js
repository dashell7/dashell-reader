const plugin = app.plugins.plugins["qiaomu-reader-english"];
if (!plugin?.learning) throw new Error("English learning is unavailable");
const learning = plugin.learning;
const ai = learning.settings.dictionaries.ai;
const previousEnabled = ai.enable;
const previousComplete = plugin.completeEnglishLearningAi;
const calls = [];
const waitForCalls = async count => {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (calls.length >= count) return;
    await new Promise(resolve => window.setTimeout(resolve, 50));
  }
  throw new Error(`Expected ${count} AI lookup calls, saw ${calls.length}`);
};
try {
  plugin.completeEnglishLearningAi = async (kind, word, prompt, context) => {
    calls.push({ kind, word, context: { ...context } });
    return "QA definition";
  };
  ai.enable = true;
  learning.store.dictsChange = !learning.store.dictsChange;
  await learning.activateView("qiaomu-english-search-panel", "left");
  const send = (sentence, bookTitle) => window.dispatchEvent(new CustomEvent("qiaomu-english-event-search", {
    detail: { selection: "bill", sentence, bookTitle },
  }));
  send("The Rabbit Sends in a Little Bill.", "Alice in Wonderland");
  await waitForCalls(1);
  send("Please pay the bill.", "Another book");
  await waitForCalls(2);
  const panel = app.workspace.getLeavesOfType("qiaomu-english-search-panel")[0]?.view.containerEl;
  const input = panel?.querySelector(".search-input");
  const button = panel?.querySelector(".search-submit-btn");
  if (!input || !button) throw new Error("Search controls are unavailable");
  input.value = "bill";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  button.click();
  await waitForCalls(3);
  if (calls[0].context.sentence !== "The Rabbit Sends in a Little Bill."
      || calls[0].context.bookTitle !== "Alice in Wonderland"
      || calls[1].context.sentence !== "Please pay the bill."
      || calls[1].context.bookTitle !== "Another book"
      || calls[2].context.sentence || calls[2].context.bookTitle) {
    throw new Error("AI lookup did not follow the current search context");
  }
  return { calls };
} finally {
  ai.enable = previousEnabled;
  learning.store.dictsChange = !learning.store.dictsChange;
  plugin.completeEnglishLearningAi = previousComplete;
}
