# Qiaomu Reader 4.8.3 selective adaptation

Assessed on 2026-10-25 against the formal release `4.8.3`, commit
`e1f8a0c3636f09d5b0641dc99a5755ee29b43376`. The previous assessed upstream
tag is `4.7.9` (`44629881e783f7bdfa5270b6605bee538ba74567`); the comparison
contains 13 commits. Dashell starts from actual default branch `main` at
`68e8828373df795e96af627f70ae3485b6ac3286`. Manifest and public Release stay
at 4.4.7. This is an unreleased integration, not a new distribution version.

## Selected changes

- Suppress Gutenberg download counts incorrectly presented as the author.
- Show preparation, download and import stages in the existing download
  button, with busy state. Byte validation remains before vault import.
  Successful buttons stay disabled; failed downloads/imports remain retryable.
  These are workflow stages, not measured download percentages.
- Track open discovery modals and close them during unload. A download belongs
  to its modal/search generation, so responses from a closed or superseded
  search cannot begin an import or update the current window.
- Use a plugin-local in-flight book registry to prevent simultaneous downloads
  of one ID. Recheck vault files immediately before import. Once an import has
  started committing, closing/reopening keeps that book reserved until the
  import settles. An already-started import is allowed to finish once; closing
  a dialog does not roll back an existing vault write.

These adapt the public-discovery parts of upstream `734cc03`, `e975168` and
`3ad0f5f` within the existing Dashell UI/importer. Upstream attribution and
GPL-3.0-only licensing remain intact. No settings/data migration, storage
format, runtime dependency, player, or build budget changes are introduced.

## Assessed boundaries

The Kindle wireless feature adds SSH/SFTP, one-time USB authorization,
KOReader device setup and a new `ssh2` dependency. It is a separate hardware
workflow without an available paired device for acceptance here, so this
increment does not import it. It is not an unfinished merge or a daily retry.

The activated Qiaomu ebook service adds a separate account/server workflow.
Dashell retains public discovery. The dependent cover/version comparison UI
and upstream donation/About redesign are not transplanted; Dashell keeps its
current source links, branding and About page.

RSS was also assessed through formal `0.32.6`, commit
`122b8c70a2150a8cd6888ec2a6558090bbe94a62`, from `0.32.1`. The new curated
podcast/duplicate-selection behavior belongs to the excluded Qiaomu catalogue.
Dashell already has bundled offline What's New notes, automatic version
selection and manual About access; the upstream modal, cross-plugin timer
queue and extra preferences file would duplicate it. The 0.32.6 dependency
patch is only `zod` 4.5.4 to 4.6.6, which Dashell does not depend on. RSS code,
lockfile and default branch remain at `27b32f3b088feb8f37f682ad0b30526c167a5919`.

## Verification

- Added regressions first and observed failures for author identification,
  completion state, old response isolation, unload and commit-time duplication.
  Final suite: 607 Node tests and 6 Python tests pass.
- Source ESLint has zero warnings. Language checks, learning TypeScript,
  standard/community builds, syntax and release asset checks pass. The
  community profile is a separate output; the installed candidate is standard.
- In the designated F: test vault on Windows, the actual installed plugin
  opened its library/discovery UI, submitted a real Gutenberg query and
  received titles/authors. The two browser-search destinations were recorded
  with a temporary `window.open` stub; no external browser windows were opened.
  The requestUrl transport and Gutenberg responses were real.
- A real 189,249-byte Alice EPUB was imported once despite repeated clicks,
  then rendered through Reader TOC navigation to Chapter I. It survived actual
  plugin unload/reload. Close/reopen and a new search suppressed old imports.
  A controlled importer failure was retryable. The final build also passed a
  commit-wait fixture: close/reopen blocked a second import while the first
  waited, then the real importer wrote exactly one file after release.
- Actual 400px/1280px windows, dark/light themes and screenshots show no
  discovery-content horizontal overflow. Window bounds/theme/layout are
  restored. During a later repeated search, Gutenberg returned a transient
  search failure; it was reported in the UI. A known book's real acquisition
  still succeeded for the final commit-wait check. This is not a claim of
  continuous Gutenberg availability.
- Backups cover RSS's original VideoCaptioner assets, all Reader files, layout
  and original Markdown hashes. QA EPUBs and their generated companion notes
  are removed. Original plugin data, settings, learning records and RSS assets
  are restored; only Reader's three candidate assets are retained. A cover
  generated for the original note during layout restoration was drained and
  restored in both memory and the cache file before final hash verification.
- Window title reports Obsidian 1.15.0; its user agent still reports the older
  1.12.4 installer. No uncaught errors were observed during the fixtures.
  Existing dev:errors entries contain four earlier ResizeObserver notices;
  an empty historical error log is not claimed.

Diagnostic dependency audits did not change either lockfile. RSS production
audit is clean, with seven moderate development findings and no high/critical
findings. Reader's existing locked tree reports three high production-labelled
findings (`vue`/`@vue/server-renderer`, `source-map-js`), and 15 high/two moderate
findings with development dependencies included. Reader CI currently has no
audit gate. This adaptation does not fix or suppress those findings and does
not claim a clean Reader dependency audit; upgrading its pinned Vue/toolchain
requires its own compatibility assessment.

No macOS, physical phone, cold startup, sync, Kindle, activated ebook account
or new speech synthesis acceptance is claimed. Local evidence and reversible
backups are in the task's `dashell-upstream-20261025` evidence directory.
