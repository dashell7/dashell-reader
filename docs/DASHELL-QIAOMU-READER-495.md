# Reader 4.9.5 selective adaptation — verified integration, 2026-11-11

Source: Qiaomu Reader official tag `4.9.5`, commit
`fbf42809c8d91500d7275147ba7f865ad2baae54`, published
2026-11-09T10:19:58Z. Compared against official `4.9.4`
(`b857729a7e41eeaf5b04a1f58c65e60776872ea6`): 21 commits, 70 files.
Unreleased upstream main is not the adaptation source.

The candidate started at Dashell main `f298fd5` and now merges the completed
4.5.1 UX release, main `e3df393ba7dc92a67436056b2a3ffc29a21cc41a`.
Formal manifest/package remain **4.5.1**. The vocabulary, dictionary/save
feedback, keyboard panels, learning width and error recovery from that
release are preserved. This daily sync creates no tag or Release.

## Selected behavior

- Speech controls occupy a compact top slot, with speed/location/end actions
  under More at narrow widths. The Sound dialog owns a draft; browsing does
  not select a service or synthesize audio. An explicit successful audition
  of the exact draft is required before applying a changed voice. Preview
  restores the previous book position/rate paused and never auto-resumes it.
- Preserve migrated `secretId` references, the Dashell local-model storage
  application ID, and false-return save failures. Failed saves restore only
  the changed profile/provider/intro fields and credential when still owned
  by that operation; the draft remains retryable. Saving freezes the draft,
  prevents a second dialog or duplicate confirmation, aborts catalog work,
  and ignores late UI completion after close. Public key/documentation links
  and models returned by a voice catalog remain available. Mac catalog calls
  are explicitly guarded on Windows/mobile.
- One selection lifecycle watches host and section documents, defers the
  toolbar until native pointer/touch selection settles, dismisses stale
  ranges/menus, rejects callbacks from old menus/books, and disposes listeners
  on close. Foliate selection-handle drags no longer snap the page. Existing
  Dashell body/defaultView/connection guards, grouping compatibility and
  LF/CRLF-normalized engine revision remain intact.
- Retain Obsidian `MarkdownRenderer` for native Markdown snapshots and
  Dashell note-link/task handling. Sanitization now retains valid numeric
  image width/height. The isolated Marked fallback recognizes local image
  embeds and sizes without rewriting code, escapes or non-image embeds.
  Scripts, event attributes and active embeds remain stripped.
- Codex ACP always uses an isolated home. Parse the selected provider's TOML
  routing/HTTP authentication allowlist, excluding executable helpers, MCPs,
  notify/hooks and unrelated providers. When auth symlinking fails, copy the
  selected auth file rather than falling back to the real home. Prefer the
  child's CODEX_API_KEY then OPENAI_API_KEY environment value, then dedicated
  auth-file keys. Request-time API-key and ACP-auth errors are distinct from
  the existing CLI login-status probe. No real credentials were read in tests.
  Forward only source environment variables explicitly named by the selected
  provider's `env_key` or `env_http_headers`; synthetic child regressions
  reproduce upstream dropping those values and verify unrelated credentials
  are excluded. No new credential value is written into plugin settings.
  Process-control variables are excluded even if referenced by a provider;
  selected HTTP credentials cannot replace the isolated home or inject Node
  runtime options.
- Losslessly pack the existing local-model catalog through the already
  bundled Pako JSON codec. Dashell's own QR assets are retained. The new TOML
  parser is pinned to `smol-toml@1.9.1`; its full BSD-3-Clause license is
  retained in source and in the generated bundle, with a release-asset gate.

The inherited GPL and other third-party notices remain. Upstream website,
analytics/deployment, Qiaomu branding/listing/screenshots and version bumps
are excluded. Dashell learning, MarkdownRenderer, Gutenberg/book sources,
progress, credential migration and the RSS material handoff remain owned by
their existing modules. No second persistence or speech service is added.

## Local verification and remaining acceptance

Node regressions cover native/fallback image snapshots, native-handle page
snap, selection dismissal/lifecycle, voice drafts/audition/save failure,
migrated secrets, duplicate/late saves and platform guards. Synthetic ACP
children exercise provider routing/headers, stripped executable config,
symlink-denied auth copy, environment precedence, missing auth and malformed
TOML, preserving source config/auth bytes. They do not invoke a real model.

The local full Node suite, six Python TTS runtime tests, 1602-key language
check, learning TypeScript check, zero-warning source ESLint, standard and
community builds, syntax and asset gates pass. Exact final counts, asset
hashes and the independent LF-export rebuild result are recorded in the
external assessment directory named below. The bundle remains over decimal
5 MB; it is not represented as meeting a 5 MB distribution budget.

2026-11-10 diagnostic audit: production **3 high**, full dependency tree
**11 high / 12 moderate / 0 critical**. These existing Vue/server-renderer,
source-map and development-tool findings are not fixed by this adaptation.
Only the new TOML parser/root lock entry was added; existing package versions
were not upgraded. No audit threshold was reduced.

## November 11 integration acceptance

The 4.5.1 UX release task completed. The designated vault remains
`G:/qiaomu-reader-english`, registered `72af7e9296446625`; no other vault
was used. At the start of this run both installed plugins matched public
Reader 4.5.1 / RSS 2.7.5 assets byte for byte. The previously installed
VideoCaptioner candidate was no longer the current host installation; its
independent source was not modified.

After backing up the current host, the integrated three assets were
installed temporarily in Windows Obsidian 1.15.1. A synthetic Markdown
book rendered through the actual engine and Obsidian MarkdownRenderer;
a local image loaded with width=120 / height=80. Native mouse drag selected
text, displayed the toolbar without page movement, and Escape dismissed
it without stale reopening. The selection lifecycle was disposed after
closing. The inherited 4.5.1 TOC focus and vocabulary entry remained.
The Sound dialog retained its draft without settings writes. A controlled
controller completion unlocked only that draft; a false settings-save
result rolled back state and allowed a successful retry, which was read
back from disk. The controller was intercepted to avoid a real speech
or paid provider request. Top speech actions remained visible and within
the reading pane at 400px and 1280px; screenshots were inspected.

Final combined checks passed: **720 Node tests**, **6 Python tests**,
**1607 language keys**, learning types, source ESLint with zero warnings,
standard/community builds and release-asset gates. Independent LF-export
rebuild evidence is recorded externally against the final integration
commit. The main bundle remains greater than decimal 5 MB.

The host was restored to its original public 4.5.1 / 2.7.5 assets and layout.
All **26 original Markdown files and 63 plugin files** matched the fresh
backup byte for byte. QA source/image/companion were removed; the three
newly generated daily rescue files were retained outside the vault with
this run's evidence. Functional scripts captured no errors. Restoration
captured ResizeObserver notifications and one progress JSON verification
warning; the subsequent idle check found original bytes and memory settings
intact. The warning remains recorded; it is not presented as a clean log
or as a diagnosed candidate defect. No physical mobile/macOS, candidate
cold start, cross-device sync, real speech/model/ACP service was tested.

Evidence: `C:/Users/zhangbo/AppData/Local/Temp/dashell-upstream-20261111/`:
remote-state, combined test/build logs, host installation/functional/layout
and preservation JSON, screenshots, restoration diagnostics and independent
rebuild results. The November 10 assessment remains historical. The separate
missing-database and VideoCaptioner candidates were not edited.
