# Qiaomu Reader 4.9.3 selective adaptation

Assessed on 2026-11-02 from formal upstream 4.9.2
(`fc620a4521c8b34ce390fcf1388a190f91ebb182`) to formal 4.9.3
(`ffbc3056b4d9e3a551098e18a65bc46428aeecfe`), published
2026-11-01 at 16:49:33 UTC. All three commits and thirteen changed files were
reviewed. The integration used Dashell default `main` at
`305630fa98b09639af55dbae0445cef6950a706c` as its base and was later pushed as
`e5324ca83e20194727783c1c2e446d10a5df3cba` to the actual default branch. The
latest public Release remains **4.4.8**; a separate 4.4.9 release candidate is
being prepared. This adaptation record itself does not publish a Release.

## Behavior and scope

The existing AI companion now shares one editable library between its quick
buttons and slash menu. Users can rename buttons, edit their full prompt, add
or delete up to twenty prompts, and restore the translated defaults. Drafts
remain local until saved. An empty library keeps its management button;
restoring defaults stores `null` so future language changes still apply.
The manager is also available under the existing advanced AI preferences.
Prompt text is editable data, including Markdown and HTML-looking strings.

This adapts upstream `src/ai-prompts.js`, composer/settings integration and
scoped styling under the existing GPL license. Dashell keeps its host Markdown
renderer, learning workflows, settings writer and provider configuration.
There are no new dependencies, requests, credentials, storage files or save
queues. Upstream version changes, branding, generated bundle and unrelated
documentation are not imported.

Dashell additionally owns a single editor, closes it on unload, blocks a second
editor while an accepted write settles, restores previous settings after a
failed write and retains the draft for retry. Late completion does not refresh
detached UI. Successful saves close stale slash menus and update both sidebar
and modal companions. Editor fields use their owning document. Focus styling
stays scoped to the editor; a theme-specific input shadow was reproduced and
removed without global overrides or `!important`.

## Validation

- **637 Node tests**, **6 Python local-TTS tests**, Simplified Chinese plus
  seven bundled language checks, learning TypeScript, source ESLint with zero
  warnings, standard/community builds and asset verification passed. New
  regressions cover prompt filtering, exact text, inert markup, editing,
  cancellation, validation, failure/retry, bounds, shared editor ownership and
  late-save/unload behavior. Dependency and lockfile bytes are unchanged.
- Actual Windows Obsidian **1.15.0** (installer UA **1.12.4**) in the designated
  **F:/qiaomu-reader-english**, registered ID `f3d4f84f4640589d`: actual UI
  editing, delete/add, cancel, single-editor draft retention, real settings
  persistence, quick button/slash consistency, existing input draft retention,
  failed persistence with retry, empty/default libraries and twenty-row limit
  passed. The send boundary was intercepted and restored; there were no real
  model or paid API calls. A controlled failed save returned `false` through
  the real UI without changing vault permissions.
- Actual plugin disable/enable preserves saved prompts; a pending accepted
  save prevents reopening and late completion cannot reopen UI. Unload closes
  its owned editor. Actual advanced settings navigation opens the same editor.
- Actual 400px dark and 1280px light desktop windows have visible controls and
  no horizontal editor overflow. Screenshots and computed focus styles were
  checked. A real popout move and native mouse click open the editor in that
  window; save refreshes the same companion without leaving an orphan editor.
  A controlled desktop `app.isMobile` override exercises the actual companion
  modal and verifies its prompt refresh; the property and Agent hook were
  restored. These are desktop checks, not physical mobile acceptance.
- Fixture corrections: await deferred leaves; select the actual advanced AI
  settings; reset persisted QA prompts before a defaults-specific test; wait
  for native popout creation and use an actual input event so Obsidian updates
  its active window. No production changes bypass these host behaviors.
- During restoration, the renderer exited while reloading the original local
  candidate and CLI calls timed out. Original plugin bytes had already been
  restored. The app was closed and the same registered vault reopened; a fresh
  guarded session confirmed the original candidate loaded, then its original
  in-memory settings/progress/cache and disk bytes were reconciled. This
  recovery incident is retained as evidence rather than claiming an
  uninterrupted restore. QA diagnostics before restoration and diagnostics in
  the fresh restored session both report `No errors captured`; they do not
  explain or erase the renderer exit.
- Final restoration verifies all **9 original Markdown files**, **30 Reader
  files** and **14 RSS files** byte for byte against fresh backups, including
  all three original assets. Original layout and window bounds are restored;
  no QA notes, extra plugin files, modals or popouts remain. Reader keeps the
  separate missing-database candidate; RSS keeps its independent VideoCaptioner
  2.7.3 candidate. Neither installed copy is this default-branch candidate.

The earlier feature integration's evidence directory,
`C:/Users/zhangbo/AppData/Local/Temp/dashell-upstream-20261102`, was not present
during the 4.4.9 release work. Its host results above are historical and were
not remeasured as part of release candidate testing.

## 4.4.9 release candidate verification (2026-11-02)

- On a fresh dependency install, 637 Node tests, 6 Python TTS tests, i18n
  checks for 1,566 keys across eight language packs, learning typecheck,
  zero-warning source ESLint, standard/community builds, and release asset
  verification passed. A second standard build reproduced the committed
  `main.js`, `manifest.json`, and `styles.css` byte for byte.
- Standard `main.js` is **5,366,716 bytes**, SHA256
  `04b57112ab4405eadea0fd24ccaedb0ee379a600321cb60d2996cc290b653f06`;
  `manifest.json` is **336 bytes**, SHA256
  `dbf836af0b6ad8bad240ab19eaef104a5365909688dbc581dd24755d1bce2620`;
  `styles.css` is **3,854,965 bytes**, SHA256
  `a1acb217ca704d2bacccbdcca3166393ff22e311acbcc267bde88a8407ec6567`.
  `main.js` remains above decimal 5 MB.
- Actual Windows Obsidian in `F:/qiaomu-reader-english`, attached through
  registered vault ID `f3d4f84f4640589d`, loaded the candidate as 4.4.9. The
  4.4.8-to-4.4.9 update modal displayed the new note. From the actual AI
  settings, a controlled prompt was added, saved, and verified after plugin
  reload. No model request was made and no update note was created. The
  settings window title showed Obsidian 1.15.0; renderer UA reported 1.12.4.
- Restoration returned all **33 Reader plugin files** and both workspace
  layout files byte for byte to their pre-test backups; the original 4.4.8
  plugin was reloaded. The host error buffer showed three
  `ResizeObserver loop completed with undelivered notifications` entries after
  the test; no `host_eval` operation captured an error. A pre-test error-buffer
  baseline was not recorded, so those notices are not attributed to this run.
- Current release candidate evidence and private backups are at
  `C:/Users/zhangbo/AppData/Local/Temp/dashell-release-reader-449-20261102`.

RSS remains formal upstream **0.32.11**
(`b510cce2993c2c681be7c2339fc757d88f4296b2`), actual Dashell default
`codex/dashell-rss-upstream-sync` at
`c6833dbcce871059a02721f3c214c7c0e3ad4cfc`, formal version **2.7.4**.
Its November 1 assessment still applies; this run does not build, install,
change or audit RSS. Its matching CI `41213275577` was re-queried as successful.

The production dependency audit reports **3 high** findings in Vue /
`@vue/server-renderer` and `source-map-js`; full-tree audit reports **8 high**
and **22 moderate**. Dependencies and lockfile did not change, and the release
does not claim a clean dependency audit.
No macOS, physical phone/iOS, cold-start candidate, synchronization, real
external account/model or new speech synthesis acceptance is claimed. The
original missing-database checkout and unrelated VideoCaptioner source are
untouched. No Release, Issue, directory submission or rules change was part of
the upstream adaptation; the separate 4.4.9 release remains subject to its
official pre-scan and publication gates.
