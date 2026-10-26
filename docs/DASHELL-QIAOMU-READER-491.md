# Qiaomu Reader 4.9.1 selective adaptation

Assessed on 2026-10-26, from formal upstream 4.8.3
(`e1f8a0c3636f09d5b0641dc99a5755ee29b43376`) through 4.8.4, 4.9.0 and
4.9.1 (`3b49727c4835dde7c5b714331575c928dcc777fa`). The Dashell base is
`3f33284a1011baf03d07f2d80d920b532b66d56d` on the actual default `main`.
Public manifest/package version remains **4.4.7**; this is not a release.

## Adopted behavior

- Production builds share keys and losslessly compress all nine static UI
  dictionaries and embedded PDF CMaps. The codec is the already locked Pako
  1.0.11, now declared directly; the dependency tree is otherwise unchanged.
  Both build profiles decode ordinary data locally, without Node globals or
  remote executable code. Editable dictionaries, fallback and CMap bytes stay
  equivalent. Full Pako and inherited licenses are retained; the complete GPL
  text accompanies the JavaScript in styles.css.
- The complete Dashell bundle is 5,362,472 bytes versus the 6,469,040-byte
  base (about 17.1% smaller). Its local asset budget tightens from 7,000,000 to
  5,600,000 bytes. It still exceeds decimal 5 MB; this is not a claim of
  compliance with a 5 MB Sync limit or upstream's 4.8 MB engineering budget.
- Existing plugin data stores a bounded metadata whitelist for new imports:
  title, author, year, language, ISBN, publisher and source identity. Metadata
  extraction does not open a reader or modify book bytes. Unsupported/invalid
  metadata remains optional. Calibre supplies author through its existing
  import record. Historical missing metadata is not invented or bulk scanned.
- Bookshelf cards display title/author. Bookshelf and Home searches include
  metadata. Sorting offers recently read (the preserved default), recently
  added and title, with stable locale/pinyin and path tie breakers. Book rename
  and deletion update the path mapping through existing vault listeners.
- Import dialogs share one plugin queue. SHA-256 identifies identical bytes,
  checking listed books and existing plugin import records, including records
  outside the current library folder. Equal-size distinct content remains
  separate; cached hashes expire when size/mtime changes. Ordinary unrelated
  vault Markdown is not scanned. Identical content reuses its existing file,
  preserving the filename, progress and learning identity.
- A failed metadata save reports failure while retaining the book. A retry
  reuses the existing bytes instead of writing another copy. Queued work checks
  unloading before starting a new write; an already-started write is not a
  transactional rollback promise.

## Deliberately separate changes

No Kindle converter/SSH workflow, activated ebook service or upstream branding
is added. The upstream `Book records` Markdown schema, download receipts and
out-of-order synchronization listeners would create another state owner beside
Dashell's companion notes and learning state. They need a separate recovery,
rename and sync contract; this adaptation retains current plugin storage and
does not claim cross-device metadata recovery.

Upstream's thumbnail-file migration and virtual card window change the existing
cover/Home persistence and keyboard/reading controls. They are deferred until
measured library/cover size and a Dashell-specific migration/focus plan justify
that change. There is no claim that those performance features were ported.
Existing download locations, filenames, public discovery and direct Calibre
entry are preserved. No second cache, record format, player or account workflow
is introduced. These boundaries are assessed decisions, not recurring failed
merge tasks.

## Verification

- 615 Node tests and six Python local-TTS tests passed. Regressions cover
  dictionary/CMap byte equivalence in both profiles, browser-only decode,
  Unicode/empty/own-property keys, metadata filtering/search/order, hash cache
  invalidation, overlapping imports and save-failure retry. Existing learning,
  EPUB compatibility and discovery race regressions remain green.
- Source ESLint has zero warnings; language checks, learning TypeScript,
  standard/community builds and release-asset validation passed. The build and
  verifier both enforce the tightened budget and full license presence.
- Freshly attached `F:/qiaomu-reader-english`, Windows Obsidian window title
  **1.15.0** (UA still reports installer 1.12.4): final candidate actual import,
  duplicate reuse, two distinct EPUB editions, author/ISBN search, sorting,
  rename/delete metadata maintenance, reload and controlled save-failure retry
  passed. Original fixture EPUB 2/3 metadata and an EPUB chapter with encoded
  Chinese paths rendered; a one-page PDF rendered its text. CMap equivalence is
  additionally verified byte-for-byte in the unit bundle, not inferred from an
  ASCII PDF. These are controlled local fixtures, not a new online download or
  real disk-failure test.
- Actual 400px dark and 1280px light windows and screenshots show visible
  sorting/search controls without horizontal overflow. The first narrow check
  inspected a sidebar-covered pane; collapsing the sidebars and revealing the
  library corrected the fixture, without a production UI workaround.
- The first host import check exposed duplicate records outside the configured
  library folder. A failing regression was added, the record-aware lookup was
  fixed, and the complete final host import/read/reload checks passed.
- QA files/automatic companion notes are removed. Layout, bounds/theme and
  non-asset plugin files are restored against backups; the original RSS
  VideoCaptioner assets are retained. The final Reader candidate remains
  installed. Evidence is in `dashell-upstream-20261026` outside the vault.

Reader's diagnostic production audit still reports three existing high findings
in its pinned Vue/source-map tree. No audit gate is weakened and a clean Reader
audit is not claimed. RSS production audit is clean; RSS code and lockfile are
unchanged. RSS formal 0.32.7 (`6c313c50bf29f4bf4a4e5eb58b79d96ee4a3b4b7`) was
assessed separately: administrator server moves, private copies of remote
bundles and resumable server translation depend on the excluded Qiaomu backend
and its article identity, so they are not transplanted into Dashell shards and
`feedId:guid` learning/user state. Public-release promotion gates are outside
this daily no-release change.

No macOS, physical mobile, cold startup, real two-device sync, Kindle, activated
library account, new speech synthesis or live external subscription acceptance
is claimed. CI and source rebuild results are recorded in the task baseline.
