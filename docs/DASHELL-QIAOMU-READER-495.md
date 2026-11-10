# Reader 4.9.5 selective adaptation — local candidate, 2026-11-10

Source: Qiaomu Reader official tag `4.9.5`, commit
`fbf42809c8d91500d7275147ba7f865ad2baae54`, published
2026-11-09T10:19:58Z. Compared against official `4.9.4`
(`b857729a7e41eeaf5b04a1f58c65e60776872ea6`): 21 commits, 70 files.
Unreleased upstream main is not the adaptation source.

Based on Dashell's actual remote default `main` at
`f298fd5dc4e132ba08ed4dba8b2834b6fdc0e6b8`. Formal manifest/package
remain **4.5.0**. This is an unmerged local candidate on
`codex/reader-495-sync`, not a new public Release or an installed host build.
The completed November 5 publication of 4.5.0 is not reopened.

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

**Host acceptance is pending exclusive access.** On November 10 the user
confirmed that the designated vault moved from F: to
`G:/qiaomu-reader-english`, registered as `72af7e9296446625`. This supersedes
the old F: path and ID. Another user task is actively preparing the Reader
UX release using that vault and its installed candidate. Do not replace
those assets or restore its data/layout while that task is active. The
earlier missing-F observation remains historical evidence, not a current
path-authorization blocker. This task has not changed notes/settings/layout.
Desktop UI, physical mobile/macOS, actual speech/model providers, candidate
cold start and synchronization are unverified. No installation, remote
merge/push, new CI, PR, Issue, tag, Release or directory submission occurred.

Original dirty Reader 494 UX work and the separate missing-database/VideoCaptioner
candidates were not edited. Resume this candidate on G: after the active
release task finishes; recheck actual default HEAD, formal version and any
released UX changes before integrating this candidate. Recheck current
assets/data and concurrent work, back up current data, run host acceptance,
then recheck remote HEAD/protection and use normal checks. Do not downgrade
the default manifest if the concurrent release has advanced it.

Evidence: `C:/Users/zhangbo/AppData/Local/Temp/dashell-upstream-20261110/`:
`remote-state.json`, `reader-compare.json`, test/build/audit logs,
`host-unavailable.json`, final assessment and reproducibility records.
