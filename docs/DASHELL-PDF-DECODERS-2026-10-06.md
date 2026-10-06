# Selective Qiaomu Reader 4.5.13 PDF integration

## Scope and provenance

Adapted from upstream commit `45dff3c551a1f06984520a63f3b09185d5346763`
([4.5.13 release](https://github.com/joeseesun/qiaomu-reader/releases/tag/4.5.13)).
This imports the offline PDF image/color decoder fix only. It does not merge
the upstream 4.5.x dictionary, vocabulary, Anki, UI or settings changes.

The active source is `C:/Users/zhangbo/Documents/qiaomu-reader`, branch
`codex/english-lookup-context-backlinks`, based on `046ea01`. Existing uncommitted
Dashell naming, reading color, speech toolbar and other work was preserved. The
GitHub default branch was not used to replace this newer local checkout.

## Implementation

- `scripts/generate-pdf-cmaps.mjs` generates a deterministic compressed archive
  of `jbig2.wasm`, `openjpeg.wasm` and `qcms_bg.wasm` alongside existing CMaps.
- `src/pdf-cmaps.js` serves those embedded resources using the existing JSZip
  dependency and returns fresh bytes for every document/worker transfer.
- `src/main.js` adds `PDF_CMAP_OPTIONS` to the cover-loading entry point; the
  main PDF-reading entry point already uses them. This is the only modification
  made to that file relative to the working copy captured before this task.
- `esbuild.config.mjs` retains all six PDF decoder copyright/license texts in
  the bundle banner. `scripts/verify-release.mjs` checks they are present.
- `src/pdf-wasm-data.js` is generated from the locked `pdfjs-dist` 6.2.108
  resources. No new dependency or external resource file is required at runtime.

QuickJS evaluation is not embedded; both PDF entry points retain
`isEvalSupported: false`. Image-only PDFs remain image-only: lookup, search and
text questions require an existing usable text layer. No OCR is added.

## Verification

The pre-fix regression reproduced `Unsupported embedded PDF resource kind:
wasmUrl`, failure to initialize JBIG2, and a missing decoded CCITT image.

- All 432 Node tests passed, including four new decoder/CMap tests.
- The tests compare all three embedded binaries with the locked npm resources,
  validate them as WASM, reject missing resources and QuickJS, and exercise
  independent buffers across concurrent requests and worker transfers.
- Learning typecheck, production build, i18n checks and installed-asset
  verification passed. Runtime/new-test ESLint and JavaScript syntax checks
  passed. Existing Sass legacy-API deprecation messages remain.
- The generic Obsidian ESLint configuration also flags Node imports/logging in
  developer build scripts. That configuration issue is outside this PDF fix;
  those scripts are not plugin runtime code. Generated bundle/license text has
  trailing whitespace, so an unrestricted `git diff --check` is not clean.

The upstream scan fixture decodes all-white gray pixels despite its black-scan
comment. Our adapted fixture explicitly adds `/Decode [1 0]`; the regression
asserts visible black pixels rather than merely checking that an image exists.

Desktop host: the registered `F:/qiaomu-reader-english` vault, Obsidian 1.12.4,
Electron 39.6.0, Windows. Dashell Reader, Dashell Player, Dashell RSS, Spaced
Repetition and BRAT remained enabled. The test invokes the actual registered
PDF cover method and Reader view:

- Cover: 200 x 25 pixels, 5,000 black pixels of 5,000.
- Reader scan page: 160 x 20 pixels, 3,200 black pixels of 3,200.
- The text PDF retains selectable text, document context and its English lookup
  controller. Dictionary/review/speech APIs remain loaded.
- No decoder warning or console error during the successful host check.
- Existing settings, learning settings, reading progress, highlights and all
  41 existing Markdown notes are unchanged. Root plugin data JSON files are
  byte-for-byte identical to the pre-install backup. Layout was restored and
  temporary fixture files removed.

The working source already contains `ttsBarVisibility: "playing"`, absent from
the earlier installed build. Reload adds this existing default in memory only;
the stored configuration remains byte-for-byte unchanged. The host check
accounts for that one unpersisted default when comparing user settings.

No mobile device, full JBIG2/JPEG 2000/ICC PDF rendering fixture, or official
release scan was run in this task. Binary integrity checks cover all three
decoder resources; actual host rendering covers CCITT and a text PDF.

## Installed Candidate and Recovery

Installed assets in `F:/qiaomu-reader-english/.obsidian/plugins/qiaomu-reader-english`:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `main.js` | 6,836,673 | `0bc5345cf3eb21afe37c98d96097a8646eac999185fda42f6545714e364c9f44` |
| `styles.css` | 3,779,595 | `1768fbfb9f8eec55b1990e675c72a84cf9fbc93fc2222dc002662dcb384b0f08` |
| `manifest.json` | 366 | `bfbd6ff94dbf8f3156a50ef869ebf46304b3a80bb2272d742c9913348dfb0935` |

The bundle stays below the existing 7,000,000-byte project budget with 163,327
bytes of headroom. A future release must recheck that budget after other changes.
Version remains 4.4.5 as a local candidate; no version bump, commit, push, PR,
remote merge or release was performed.

Pre-task source backup and host evidence are under
`tmp/pdf-decoders-20261006/`. The full previous installed plugin is backed up at
`tmp/pdf-decoders-20261006/host/reader-backup-1791271072643`. To roll back the
candidate, unload Reader, restore only `main.js`, `manifest.json` and
`styles.css` from that backup, then reload Reader. Do not overwrite current
notes, settings or learning records.

Host regression script: `tests/host/check-pdf-image-decoders.js`. Generate
external fixtures from `tests/fixtures/pdf-ccitt-scan.mjs` and
`tests/fixtures/pdf-footnotes.mjs`, set `window.__dashellPdfQaInput` with the
external `reportRoot` and `stage: "baseline"` before installing, then run with
`stage: "check"` after installing through the registered vault ID.
