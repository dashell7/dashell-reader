# Qiaomu Reader 4.7.9 selective integration

Checked on 2026-10-22. Dashell base: `c615520fd163b74ee00130b8fbc22fe03d8aef28`,
actual default branch `main`. Package and manifest remain **4.4.7**; this is
an unreleased source update.

## Evidence and changes

- [Formal upstream 4.7.9](https://github.com/joeseesun/qiaomu-reader/releases/tag/4.7.9),
  tag commit `44629881e783f7bdfa5270b6605bee538ba74567`.
- [4.7.8 to 4.7.9](https://github.com/joeseesun/qiaomu-reader/compare/4.7.8...4.7.9).
  The relevant fix is local EPUB metadata grouping for hosts without
  `Object.groupBy` or `Map.groupBy`. Release metadata and upstream-only
  distribution changes do not replace Dashell's versioning or workflow.
- Adapt `src/epub-grouping.js`, `scripts/foliate-elements.mjs` and EPUB fixtures
  and regressions from that tag under the existing GPL-3.0-only attribution.
  Both grouping helpers are scoped to the bundled loader; they install no
  shared globals. Null-prototype object groups handle reserved and symbol keys;
  Map groups preserve key identity and input order.
- Include the helper in the retained custom-element build identity. Preserve
  Dashell's LF/CRLF normalization and Windows file-URL imports. The build patch
  rejects unexpected upstream call-site drift rather than silently skipping it.

No settings/data migration, dependency change or learning-module replacement is
needed. Existing Markdown rendering, vocabulary markers, speech, RSS version
progress and prior engine/layout fixes remain in place.

## Verification and limits

- Before the fix, the updated EPUB regression reproduced
  `Object.groupBy is not a function` on the old implementation.
- 596 Node tests and 6 Python local-runtime tests pass. Regression coverage
  includes absent grouping APIs, EPUB 2/3 metadata/refinements, author and
  collection metadata, multilingual titles, unflagged UTF-8 ZIP names, encoded
  Chinese/spaced paths, TOC fragments and unchanged LF/CRLF engine identity.
- Eight-language checks, source ESLint with zero warnings, learning types,
  standard/community builds and release-asset verification pass.
- In the designated existing Windows vault, Obsidian window version 1.14.4,
  the actual rebuilt plugin opens both EPUB formats in four configurations:
  normal APIs, Object grouping absent, Map grouping absent, and both absent.
  Each checks real chapter rendering, title/author metadata, TOC navigation,
  CFI text-range round trips and close. No uncaught Reader errors were captured.
  The simulated missing APIs stay absent during the test and their exact
  descriptors are restored afterward.
- Backed up plugin assets/data and the layout before installation. Removed the
  clearly named QA books, restored existing data/layout and verified the one
  original Markdown note byte for byte. Reader retains the validated rebuilt
  assets at manifest version 4.4.7.

These Windows fixtures simulate missing APIs; they are not iOS 17 device or
full mobile Obsidian acceptance. macOS, cold startup, physical iOS devices,
new speech synthesis and real external account requests were not tested in
this increment. The upstream simulator report is not counted as Dashell host
acceptance. Local evidence is retained in the task's `dashell-upstream-20261022`
temporary evidence directory.
