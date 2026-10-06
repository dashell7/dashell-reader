// Paste into Obsidian's developer console only in the designated test vault.
// This exercises modal registration and cleanup without disabling the plugin,
// changing settings, or creating notes in the user's vault.
const expectedVault = "f:/qiaomu-reader-english";
const vaultPath = app.vault.adapter?.getBasePath?.().replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
if (vaultPath !== expectedVault) throw Error(`Test vault only: ${expectedVault}`);

const id = "dashell-reader";
const plugin = app.plugins.plugins[id];
if (!plugin) throw Error("Enable Dashell Reader before this test");
if (!plugin.settings.onboarded) throw Error("Finish the existing first-run guide before this test");

const originalModals = new Set(plugin._announcementModals || []);
const openedByTest = () => [...(plugin._announcementModals || [])].filter(modal => !originalModals.has(modal));
const pause = () => new Promise(resolve => setTimeout(resolve, 120));
const checks = [];
const assert = (ok, message) => {
  if (!ok) throw Error(message);
  checks.push(message);
};

try {
  const command = `${id}:show-onboarding`;
  app.commands.executeCommandById(command);
  await pause();
  const [modal] = openedByTest();
  assert(!!modal, "Guide opens and is tracked by this plugin");
  const guide = modal.modalEl;
  assert(getComputedStyle(guide.querySelector(".qiaomu-reader-onb-nav")).display === "flex", "Guide navigation has horizontal layout");
  assert(getComputedStyle(guide.querySelector(".qiaomu-reader-onb-dot")).width === "10px", "Guide dots use compact styling");
  guide.querySelector(".qiaomu-reader-onb-next").click();
  assert(guide.querySelector(".qiaomu-reader-onb-counter").textContent === "2 / 5", "Next step works");
  modal.close();
  assert(openedByTest().length === 0, "Closing releases the guide instance");

  for (let index = 0; index < 5; index++) {
    app.commands.executeCommandById(command);
    const [next] = openedByTest();
    assert(!!next, "Reopened guide is tracked");
    next.close();
  }
  assert(openedByTest().length === 0, "Repeated guides leave no retained instances");
  console.info("Qiaomu Reader English guide checks passed", checks);
} finally {
  for (const modal of openedByTest()) modal.close();
}
