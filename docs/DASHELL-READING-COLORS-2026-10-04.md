# Reading emphasis colors - 2026-10-04

The reported Australia RSS article contains ordinary Markdown bold text, with
no embedded font color. In the selected Reader night palette its paragraph was
`rgb(217, 215, 209)`, but Obsidian's `b, strong { color: var(--bold-color) }`
resolved to Velocity's dark `oklch(0.24 0.0005 281)`. The host was using its light
theme while Reader used its independently selected night palette.

Scoped Reader flow styles now make `strong`, `b`, `em` and `i` inherit the parent
text color. Bold weight and italic formatting remain. No note rewriting or
global Obsidian/theme override is needed; existing saved articles benefit too.
This round changes only the emphasis rule, its generated stylesheet and changelog.

Validation:

- Reader's 422 existing tests passed; build, learning typecheck and release-asset
  verification passed. Sass emitted its existing legacy-API deprecation warnings.
- Installed in `F:/qiaomu-reader-english` using the guarded Reader installer.
  `main.js` and manifest hashes remained identical to the prior installed build.
- Actual Reader theme buttons were clicked for paper, warm and night. The reported
  bold paragraph matched normal text in each palette: `rgb(36, 35, 31)`,
  `rgb(48, 41, 31)` and `rgb(217, 215, 209)` respectively. Bold weight remained 700.
  Temporary hidden `b`, `em` and `i` elements also matched the text color.
- Host `--bold-color` was unchanged. Article content, original settings, reading
  position, progress backups and workspace layout were preserved/restored.
- Desktop screenshot was inspected: the formerly dark paragraph is legible.
  No new diagnostic error appeared; the buffer retained earlier media and
  ResizeObserver entries from preceding work.

Host script: `scripts/check-dashell-reader-colors.mjs` in the Dashell RSS checkout.
Local evidence and backup under the existing `dashell-rss-host-20261004` session:
`reader-color-baseline.json`, `reader-color-report.json`,
`reader-night-color-fixed.png` and `reader-backup-1791057227564`.
Installed stylesheet SHA-256:
`98af172bc7dfcd4e147f313cfaba70e2a691d1aea82261293b495972fe63c7b0`.

Only desktop Markdown reading was exercised. No mobile device or EPUB/PDF matrix
was tested for this scoped CSS fix. No commit, push or release was performed.
